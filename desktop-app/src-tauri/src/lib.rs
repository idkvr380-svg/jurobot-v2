use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct Config {
    server_url: String,
    password: String,
}

struct AppState {
    config: Mutex<Config>,
}

#[tauri::command]
fn get_config(state: tauri::State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn set_config(state: tauri::State<AppState>, server_url: String, password: String) {
    let mut cfg = state.config.lock().unwrap();
    cfg.server_url = server_url;
    cfg.password = password;
    save_config(&cfg);
}

fn config_path() -> std::path::PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("jurobot-client");
    std::fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

fn load_config() -> Config {
    let path = config_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(cfg: &Config) {
    let path = config_path();
    if let Ok(s) = serde_json::to_string_pretty(cfg) {
        std::fs::write(path, s).ok();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = load_config();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config: Mutex::new(config),
        })
        .invoke_handler(tauri::generate_handler![get_config, set_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
