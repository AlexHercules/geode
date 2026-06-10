// Geode — Tauri 2 backend. Filesystem commands for the vault.
// Command contract mirrors src/core/vault.ts (TauriVaultAdapter).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
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

#[tauri::command]
fn vault_write(vault: String, path: String, content: String) -> CmdResult<()> {
    let abs = safe_join(&vault, &path)?;
    fs::write(&abs, content).map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command]
fn vault_create(vault: String, path: String, content: String) -> CmdResult<()> {
    let abs = safe_join(&vault, &path)?;
    if abs.exists() {
        return Err(format!("file already exists: {path}"));
    }
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir parents for {path}: {e}"))?;
    }
    fs::write(&abs, content).map_err(|e| format!("create {path}: {e}"))
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

/// Strip the Windows verbatim prefix that `canonicalize` adds.
fn strip_verbatim(s: &str) -> &str {
    s.trim_start_matches(r"\\?\")
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            initial_vault,
            vault_list,
            vault_read,
            vault_write,
            vault_create,
            vault_mkdir,
            vault_rename,
            vault_delete,
            vault_watch,
            vault_plugin_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running Geode");
}
