// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use directories::ProjectDirs;
use std::fs;
use std::path::PathBuf;

// TODO: occasionally save data in timestamped files, in addition to a most recent file

fn cache_dir() -> PathBuf {
    let project_dirs = ProjectDirs::from("org", "infohazards", "indranet-explorer").unwrap();
    project_dirs.cache_dir().to_path_buf()
}

fn data_file() -> PathBuf {
    cache_dir().join("data.json")
}

#[tauri::command]
fn save_data(data: String) {
    fs::create_dir_all(cache_dir()).unwrap();
    fs::write(data_file(), data).unwrap();
}

#[tauri::command]
fn load_data() -> String {
    match fs::read_to_string(data_file()) {
        Ok(content) => content,
        Err(_) => String::from("{}"),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_data, load_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}