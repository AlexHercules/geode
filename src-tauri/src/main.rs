// Geode — Tauri 2 backend. Filesystem commands for the vault.
// Command contract mirrors src/core/vault.ts (TauriVaultAdapter).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Node {
    File {
        path: String,
        name: String,
        basename: String,
        extension: String,
    },
    Folder {
        path: String,
        name: String,
        children: Vec<Node>,
    },
}

#[derive(Serialize)]
struct PluginFile {
    name: String,
    content: String,
}

/// An installed Obsidian community plugin under `<vault>/.obsidian/plugins/<dir>/`.
/// Mirrors `ObsidianPluginSource` in src/core/vault.ts (serde camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianPluginSource {
    dir: String,
    manifest_json: String,
    main_js: String,
    styles_css: Option<String>,
    data_json: Option<String>,
}

/// A directory entry under `<vault>/.obsidian/<path>`.
/// Mirrors `ConfigDirEntry` in src/core/vault.ts (serde camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigDirEntry {
    name: String,
    is_dir: bool,
}

/// Active vault filesystem watcher. Replacing the inner watcher drops the old
/// one, which disconnects its mpsc channel and lets its debounce thread exit.
struct WatcherState(Mutex<Option<RecommendedWatcher>>);

type CmdResult<T> = Result<T, String>;

/// Join a vault-relative path onto the vault root, rejecting traversal.
fn safe_join(vault: &str, rel: &str) -> CmdResult<PathBuf> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("absolute paths are not allowed".into());
    }
    for comp in rel_path.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("illegal path component in '{rel}'")),
        }
    }
    Ok(Path::new(vault).join(rel_path))
}

/// Join a path relative to `<vault>/.obsidian` onto that config root, with the
/// same traversal rejection as `safe_join`. Config IO is confined to `.obsidian/`.
fn safe_join_obsidian(vault: &str, rel: &str) -> CmdResult<PathBuf> {
    let config_root = Path::new(vault).join(".obsidian");
    safe_join(&config_root.to_string_lossy(), rel)
}

fn node_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn read_dir_recursive(abs: &Path, rel: &str) -> CmdResult<Vec<Node>> {
    let mut children = Vec::new();
    let entries = fs::read_dir(abs).map_err(|e| format!("read_dir {}: {e}", abs.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // hide dotfiles and common noise directories
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let path = entry.path();
        let ftype = entry.file_type().map_err(|e| e.to_string())?;
        if ftype.is_dir() {
            children.push(Node::Folder {
                path: child_rel.clone(),
                name,
                children: read_dir_recursive(&path, &child_rel)?,
            });
        } else if ftype.is_file() {
            let basename = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| name.clone());
            let extension = path
                .extension()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            children.push(Node::File { path: child_rel, name, basename, extension });
        }
    }
    Ok(children)
}

/// Vault folder passed on the command line (`geode.exe <folder>`), if any.
#[tauri::command]
fn initial_vault() -> Option<String> {
    std::env::args()
        .nth(1)
        .filter(|p| Path::new(p).is_dir())
        .map(|p| {
            fs::canonicalize(&p)
                .map(|c| c.to_string_lossy().trim_start_matches(r"\\?\").to_string())
                .unwrap_or(p)
        })
}

#[tauri::command]
fn vault_list(vault: String) -> CmdResult<Node> {
    let root = Path::new(&vault);
    if !root.is_dir() {
        return Err(format!("vault folder not found: {vault}"));
    }
    Ok(Node::Folder {
        path: String::new(),
        name: node_name(root),
        children: read_dir_recursive(root, "")?,
    })
}

#[tauri::command]
fn vault_read(vault: String, path: String) -> CmdResult<String> {
    let abs = safe_join(&vault, &path)?;
    fs::read_to_string(&abs).map_err(|e| format!("read {path}: {e}"))
}

// async — file IO must stay off the main thread (R6 lesson); images can be MBs
#[tauri::command(async)]
fn vault_read_binary(vault: String, path: String) -> CmdResult<String> {
    use base64::Engine as _;
    let abs = safe_join(&vault, &path)?;
    let bytes = fs::read(&abs).map_err(|e| format!("read {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// async — file IO off the main thread (R6 lesson); pasted images can be MBs.
// Mirror of vault_read_binary; NEW files only (ingestion path never overwrites).
#[tauri::command(async)]
fn vault_write_binary(vault: String, path: String, data: String) -> CmdResult<()> {
    use base64::Engine as _;
    use std::io::Write as _;
    let abs = safe_join(&vault, &path)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir parents for {path}: {e}"))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("decode {path}: {e}"))?;
    // R17 (review fix): create_new is the exclusivity authority. The earlier
    // exists()-check + shared tmp + rename was check-then-act: two concurrent
    // imports of the same name passed the check together, clobbered each
    // other's tmp, and Windows rename REPLACES the target — silently losing
    // the first file. create_new reserves the destination atomically (also on
    // case-insensitive filesystems); a crash mid-write can only truncate this
    // brand-new attachment, never existing user data.
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&abs)
        .map_err(|e| format!("create {path}: {e}"))?;
    if let Err(e) = f.write_all(&bytes).and_then(|_| f.sync_all()) {
        drop(f);
        let _ = fs::remove_file(&abs);
        return Err(format!("write {path}: {e}"));
    }
    Ok(())
}

/// Monotonic sequence for unique temp-file names (R122 review). Combined with the process
/// id it guarantees every writer gets a PRIVATE temp even for the same target path.
static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Atomically write `data` to `abs` (create-or-overwrite): write a PRIVATE sibling temp then
/// rename it over the target. R16: a mid-write crash never truncates the target — only the
/// throwaway temp can be lost. R122 review fix: the temp name is UNIQUE per writer
/// (`.{name}.{pid}.{seq}.geode-tmp`), so two concurrent writers to the SAME path never share a
/// temp — each renames its OWN complete file (last-writer-wins), never a torn half-A-half-B mix
/// (the shared-temp clobber that was R17's root cause, here on the overwrite path). The temp is
/// dot-prefixed so the watcher's noise filter (to_vault_relative drops dotfile segments) never
/// surfaces its create/rename events to the frontend.
fn atomic_write(abs: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut tmp_name = std::ffi::OsString::from(".");
    tmp_name.push(abs.file_name().map(|n| n.to_os_string()).unwrap_or_default());
    tmp_name.push(format!(".{}.{}.geode-tmp", std::process::id(), seq));
    let tmp = abs.with_file_name(tmp_name);
    fs::write(&tmp, data).and_then(|_| fs::rename(&tmp, abs)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e
    })
}

// async — binary overwrite off the main thread (R6); the bytes can be MBs. Unlike
// vault_write_binary (create-only, exclusivity via create_new), this REPLACES an existing
// binary file (Obsidian modifyBinary, R120) via the atomic create-or-overwrite helper.
#[tauri::command(async)]
fn vault_modify_binary(vault: String, path: String, data: String) -> CmdResult<()> {
    use base64::Engine as _;
    let abs = safe_join(&vault, &path)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir parents for {path}: {e}"))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("decode {path}: {e}"))?;
    atomic_write(&abs, &bytes).map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command]
fn vault_write(vault: String, path: String, content: String) -> CmdResult<()> {
    let abs = safe_join(&vault, &path)?;
    atomic_write(&abs, content.as_bytes()).map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command]
fn vault_create(vault: String, path: String, content: String) -> CmdResult<()> {
    use std::io::Write as _;
    let abs = safe_join(&vault, &path)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir parents for {path}: {e}"))?;
    }
    // R43 (review fix): create_new is the exclusivity authority — the SAME root
    // cause R17 hardened for vault_write_binary, missed here. The old exists()-check
    // + fs::write was check-then-act: between the check and the write an external
    // process (sync client, another instance) could land a same-named note that
    // fs::write would TRUNCATE, silently losing user content. openOrCreateDailyNote
    // (Mod+D / calendar click) puts this on the hot path. create_new reserves the
    // path atomically (also on case-insensitive filesystems) and returns EEXIST
    // instead of clobbering; a failed write rolls back so a crash mid-write can only
    // truncate this brand-new stub, never existing user data.
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&abs)
        .map_err(|e| format!("create {path}: {e}"))?;
    if let Err(e) = f.write_all(content.as_bytes()).and_then(|_| f.sync_all()) {
        drop(f);
        let _ = fs::remove_file(&abs);
        return Err(format!("write {path}: {e}"));
    }
    Ok(())
}

#[tauri::command]
fn vault_mkdir(vault: String, path: String) -> CmdResult<()> {
    let abs = safe_join(&vault, &path)?;
    fs::create_dir_all(&abs).map_err(|e| format!("mkdir {path}: {e}"))
}

#[tauri::command]
fn vault_rename(vault: String, old_path: String, new_path: String) -> CmdResult<()> {
    let from = safe_join(&vault, &old_path)?;
    let to = safe_join(&vault, &new_path)?;
    if to.exists() {
        return Err(format!("target already exists: {new_path}"));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| format!("rename {old_path} -> {new_path}: {e}"))
}

#[tauri::command]
fn vault_delete(vault: String, path: String) -> CmdResult<()> {
    let abs = safe_join(&vault, &path)?;
    if abs.is_dir() {
        fs::remove_dir_all(&abs).map_err(|e| format!("delete folder {path}: {e}"))
    } else {
        fs::remove_file(&abs).map_err(|e| format!("delete {path}: {e}"))
    }
}

#[tauri::command]
fn vault_trash(vault: String, path: String) -> CmdResult<String> {
    // R42 review: never trash the vault root itself (empty / "." resolves to root).
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == "./" {
        return Err("cannot trash the vault root".into());
    }
    let abs = safe_join(&vault, &path)?;
    let trash_dir = Path::new(&vault).join(".trash");
    fs::create_dir_all(&trash_dir).map_err(|e| format!("mkdir .trash: {e}"))?;
    let base = abs
        .file_name()
        .ok_or_else(|| format!("no file name in '{path}'"))?
        .to_string_lossy()
        .to_string();
    // collision-safe name under .trash: append " <n>" before the extension
    let (stem, ext) = match base.rfind('.') {
        Some(i) if i > 0 => (base[..i].to_string(), base[i..].to_string()),
        _ => (base.clone(), String::new()),
    };
    let mut name = base.clone();
    let mut n = 1;
    while trash_dir.join(&name).exists() {
        name = format!("{stem} {n}{ext}");
        n += 1;
    }
    let dest = trash_dir.join(&name);
    fs::rename(&abs, &dest).map_err(|e| format!("trash {path}: {e}"))?;
    Ok(format!(".trash/{name}"))
}

#[tauri::command]
fn vault_list_trash(vault: String) -> CmdResult<Vec<String>> {
    let trash_dir = Path::new(&vault).join(".trash");
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&trash_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            out.push(format!(".trash/{name}"));
        }
    }
    Ok(out)
}

/// Strip the Windows verbatim prefix that `canonicalize` adds.
fn strip_verbatim(s: &str) -> &str {
    s.trim_start_matches(r"\\?\")
}

/// Best-effort removal of orphaned atomic-write temp files
/// (".{name}.geode-tmp"). Skips the same noise directories as vault_list, but
/// deliberately looks INSIDE dot-prefixed file names (the temps are dotfiles
/// by design so the watcher ignores them). Depth-capped, never fatal.
fn sweep_geode_tmp(dir: &Path, depth: u32) {
    if depth > 32 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            sweep_geode_tmp(&path, depth + 1);
        } else if name.starts_with('.') && name.ends_with(".geode-tmp") {
            if let Err(e) = fs::remove_file(&path) {
                eprintln!("[geode] failed to sweep temp file {}: {e}", path.display());
            }
        }
    }
}

/// Convert an absolute event path into a vault-relative, forward-slash path.
/// Returns None for paths outside the vault, the vault root itself, or paths
/// containing noise segments (dotfiles, node_modules, target) — same filter
/// as `vault_list`.
fn to_vault_relative(root: &str, abs: &Path) -> Option<String> {
    let abs_str = abs.to_string_lossy();
    let abs_str = strip_verbatim(&abs_str);
    let rest = abs_str.strip_prefix(root)?;
    let rel = rest.trim_start_matches(['\\', '/']).replace('\\', "/");
    if rel.is_empty() {
        return None;
    }
    let noisy = rel
        .split('/')
        .any(|seg| seg.starts_with('.') || seg == "node_modules" || seg == "target");
    if noisy {
        return None;
    }
    Some(rel)
}

/// Start (or replace) a recursive watcher on the vault. File events are
/// debounced for ~400ms, then emitted as one `vault:fs-change` Tauri event
/// carrying the distinct vault-relative changed paths.
#[tauri::command]
fn vault_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatcherState>,
    vault: String,
) -> CmdResult<()> {
    let root_path = Path::new(&vault);
    if !root_path.is_dir() {
        return Err(format!("vault folder not found: {vault}"));
    }
    let canonical = fs::canonicalize(root_path).map_err(|e| format!("canonicalize {vault}: {e}"))?;
    let root = strip_verbatim(&canonical.to_string_lossy()).to_string();

    // R16: best-effort sweep of atomic-write temp residue (".{name}.geode-tmp"
    // left by a crash between write and rename). Once per vault open — the
    // naming pattern is app-exclusive, so deletion is safe; errors are logged
    // and never fatal. Runs before the watcher is installed.
    sweep_geode_tmp(&canonical, 0);

    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
    let mut watcher = notify::recommended_watcher(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if !event.paths.is_empty() {
                    let _ = tx.send(event.paths);
                }
            }
        },
    )
    .map_err(|e| format!("create watcher: {e}"))?;
    watcher
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {vault}: {e}"))?;

    let emit_app = app.clone();
    std::thread::spawn(move || {
        loop {
            // Block until the first event of a burst (exit when the watcher
            // is dropped and the channel disconnects).
            let mut raw: Vec<PathBuf> = match rx.recv() {
                Ok(paths) => paths,
                Err(_) => break,
            };
            // Debounce: keep collecting for ~400ms after the first event.
            let deadline = Instant::now() + Duration::from_millis(400);
            let mut disconnected = false;
            loop {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match rx.recv_timeout(deadline - now) {
                    Ok(mut paths) => raw.append(&mut paths),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => {
                        disconnected = true;
                        break;
                    }
                }
            }
            if disconnected {
                break; // watcher replaced/dropped — stale thread stays silent
            }
            let mut rels: Vec<String> = raw
                .iter()
                .filter_map(|p| to_vault_relative(&root, p))
                .collect();
            rels.sort();
            rels.dedup();
            if !rels.is_empty() {
                let _ = emit_app.emit("vault:fs-change", rels);
            }
        }
    });

    // Replace any previous watcher; dropping it stops its thread (see above).
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

/// List `<vault>/.geode/plugins/*.js` as {name, content}, sorted by name.
/// A missing plugins directory is not an error — returns an empty list.
#[tauri::command]
fn vault_plugin_files(vault: String) -> CmdResult<Vec<PluginFile>> {
    let dir = Path::new(&vault).join(".geode").join("plugins");
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() || path.extension().map_or(true, |ext| ext != "js") {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let content =
            fs::read_to_string(&path).map_err(|e| format!("read plugin {name}: {e}"))?;
        files.push(PluginFile { name, content });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Read an optional UTF-8 file. Ok(None) when missing, Err(reason) on a real
/// read failure (permissions, invalid UTF-8, ...).
fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

/// List installed Obsidian community plugins under `<vault>/.obsidian/plugins/*/`.
/// A directory is included only when BOTH manifest.json and main.js exist and
/// read as UTF-8; unreadable/incomplete dirs are skipped (logged), never fatal.
/// A missing plugins directory is not an error — returns an empty list.
#[tauri::command]
fn vault_obsidian_plugins(vault: String) -> CmdResult<Vec<ObsidianPluginSource>> {
    let plugins_dir = Path::new(&vault).join(".obsidian").join("plugins");
    if !plugins_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut sources = Vec::new();
    let entries = fs::read_dir(&plugins_dir)
        .map_err(|e| format!("read_dir {}: {e}", plugins_dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir = entry.file_name().to_string_lossy().into_owned();
        let manifest_json = match fs::read_to_string(path.join("manifest.json")) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[obsidian-plugins] skipping {dir}: manifest.json: {e}");
                continue;
            }
        };
        let main_js = match fs::read_to_string(path.join("main.js")) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[obsidian-plugins] skipping {dir}: main.js: {e}");
                continue;
            }
        };
        // optional companions — a read error here also just degrades to None
        let styles_css = read_optional(&path.join("styles.css")).unwrap_or_else(|e| {
            eprintln!("[obsidian-plugins] {dir}: {e}");
            None
        });
        let data_json = read_optional(&path.join("data.json")).unwrap_or_else(|e| {
            eprintln!("[obsidian-plugins] {dir}: {e}");
            None
        });
        sources.push(ObsidianPluginSource { dir, manifest_json, main_js, styles_css, data_json });
    }
    sources.sort_by(|a, b| a.dir.cmp(&b.dir));
    Ok(sources)
}

/// Max bytes accepted from an `http_request` response body (anti-abuse cap).
const HTTP_BODY_LIMIT: u64 = 10 * 1024 * 1024;

/// HTTP request from the frontend transport (src/core/net.ts, serde camelCase).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body_base64: Option<String>,
}

/// HTTP response back to the frontend (serde camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body_base64: String,
}

/// CORS-free HTTP for the frontend, backing the compat layer's `requestUrl`.
/// GET by default, 30s timeout, redirects followed (ureq default). HTTP error
/// statuses (4xx/5xx) are NOT command errors — `ureq::Error::Status` maps to a
/// normal response; only transport failures (DNS, TLS, timeout, ...) are Err.
/// `(async)`: blocking ureq I/O must run off the main thread — a plain sync
/// command executes ON the main thread in Tauri 2 and would stall the event
/// loop (and every queued vault_* command) for up to the full 30s timeout.
#[tauri::command(async)]
fn http_request(req: HttpRequest) -> CmdResult<HttpResponse> {
    if !(req.url.starts_with("http://") || req.url.starts_with("https://")) {
        return Err(format!(
            "http_request: only http/https URLs are allowed, got '{}'",
            req.url
        ));
    }
    let body = match &req.body_base64 {
        Some(b64) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("http_request: invalid base64 body: {e}"))?,
        ),
        None => None,
    };

    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();
    let method = req.method.as_deref().unwrap_or("GET").to_uppercase();
    // ureq validates headers (no CR/LF) but writes the method into the request
    // line unchecked — reject anything that could smuggle CRLF
    if method.is_empty() || !method.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(format!(
            "http_request: invalid HTTP method '{}'",
            method.escape_default()
        ));
    }
    let mut request = agent.request(&method, &req.url);
    if let Some(headers) = &req.headers {
        for (name, value) in headers {
            request = request.set(name, value);
        }
    }

    let response = match body {
        Some(bytes) => request.send_bytes(&bytes),
        None => request.call(),
    };
    let response = match response {
        Ok(r) => r,
        // 4xx/5xx — a real response the caller decides what to do with
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("http_request: {e}")),
    };

    let status = response.status();
    let mut headers = HashMap::new();
    for name in response.headers_names() {
        // duplicate response headers (e.g. Set-Cookie) join with ", "
        let joined = response.all(&name).join(", ");
        headers.insert(name, joined);
    }

    let mut bytes: Vec<u8> = Vec::new();
    response
        .into_reader()
        .take(HTTP_BODY_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("http_request: read body: {e}"))?;
    if bytes.len() as u64 > HTTP_BODY_LIMIT {
        return Err(format!(
            "http_request: response body exceeds the {HTTP_BODY_LIMIT}-byte limit"
        ));
    }

    Ok(HttpResponse {
        status,
        headers,
        body_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// Write exported note content (UTF-8) to an ABSOLUTE path returned by the
/// native save dialog. No safe_join on purpose — exporting outside the vault
/// is the point; the path always comes from a user-driven dialog, which also
/// guarantees the parent directory exists. Relative paths are rejected.
/// `(async)`: file IO runs off the main thread (R6 lesson).
#[tauri::command(async)]
fn export_write(path: String, content: String) -> CmdResult<()> {
    let abs = Path::new(&path);
    if !abs.is_absolute() {
        return Err(format!("export_write: path must be absolute, got '{path}'"));
    }
    // sibling temp file + rename: a mid-write failure (disk full, kill) must
    // never leave a user-chosen existing file truncated
    let mut tmp_name = abs.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".geode-export.tmp");
    let tmp = abs.with_file_name(tmp_name);
    fs::write(&tmp, content)
        .and_then(|_| fs::rename(&tmp, abs))
        .map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("export_write {path}: {e}")
        })
}

/// Read a config file under `<vault>/.obsidian/`. Ok(None) when missing.
#[tauri::command]
fn vault_read_config(vault: String, path: String) -> CmdResult<Option<String>> {
    let abs = safe_join_obsidian(&vault, &path)?;
    read_optional(&abs)
}

/// List entries directly under `<vault>/.obsidian/<path>` (non-recursive).
/// A missing directory is not an error — returns an empty list.
#[tauri::command]
fn vault_list_config_dir(vault: String, path: String) -> CmdResult<Vec<ConfigDirEntry>> {
    let abs = safe_join_obsidian(&vault, &path)?;
    if !abs.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let entries = fs::read_dir(&abs).map_err(|e| format!("read_dir {}: {e}", abs.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.path().is_dir();
        out.push(ConfigDirEntry { name, is_dir });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Write a config file under `<vault>/.obsidian/`, creating parent directories.
#[tauri::command]
fn vault_write_config(vault: String, path: String, content: String) -> CmdResult<()> {
    let abs = safe_join_obsidian(&vault, &path)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir parents for {path}: {e}"))?;
    }
    fs::write(&abs, content).map_err(|e| format!("write config {path}: {e}"))
}

/// R218: reveal a vault file in the OS file manager (Finder/Explorer). The
/// webview passes a vault-RELATIVE path; `safe_join` confines it to the vault
/// root (rejects `..` traversal — the same vetted gate as every vault_* IO
/// command), so absolute paths never leave the shell. Read-only OS action: no
/// vault write, no data-safety surface. `tauri-plugin-opener` Rust API only —
/// the frontend never invokes the opener's JS commands (no capability needed).
#[tauri::command]
fn reveal_in_system(app: tauri::AppHandle, vault: String, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let abs = safe_join(&vault, &path)?;
    app.opener()
        .reveal_item_in_dir(&abs)
        .map_err(|e| format!("reveal {path}: {e}"))
}

/// R218: open a vault file with the OS default application. Same vault
/// confinement as `reveal_in_system`; the opener is handed the `safe_join`'d
/// absolute path, NEVER an arbitrary URL (R218 scope = vault files only).
/// Read-only OS action.
#[tauri::command]
fn open_in_default_app(app: tauri::AppHandle, vault: String, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let abs = safe_join(&vault, &path)?;
    app.opener()
        .open_path(abs.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| format!("open {path}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            initial_vault,
            vault_list,
            vault_read,
            vault_read_binary,
            vault_write_binary,
            vault_modify_binary,
            vault_write,
            vault_create,
            vault_mkdir,
            vault_rename,
            vault_delete,
            vault_trash,
            vault_list_trash,
            vault_watch,
            vault_plugin_files,
            vault_obsidian_plugins,
            vault_read_config,
            vault_write_config,
            vault_list_config_dir,
            reveal_in_system,
            open_in_default_app,
            http_request,
            export_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running Geode");
}
