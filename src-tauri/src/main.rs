// Geode — Tauri 2 backend. Filesystem commands for the vault.
// Command contract mirrors src/core/vault.ts (TauriVaultAdapter).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            initial_vault,
            vault_list,
            vault_read,
            vault_write,
            vault_create,
            vault_mkdir,
            vault_rename,
            vault_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Geode");
}
