use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const GITHUB_REPO: &str = "idkvr380-svg/jurobot-v2";
const WORKFLOW_FILE: &str = "run-bot.yml";

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct Config {
    password: String,
    github_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WorkflowRun {
    id: u64,
    status: String,
    conclusion: Option<String>,
    created_at: String,
    updated_at: String,
    html_url: String,
    run_number: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct RunsResponse {
    workflow_runs: Vec<WorkflowRun>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BotStatus {
    online: bool,
    tunnel_url: Option<String>,
    run_id: Option<u64>,
    run_status: Option<String>,
    run_conclusion: Option<String>,
    run_url: Option<String>,
}

struct AppState {
    config: Mutex<Config>,
}

#[tauri::command]
fn get_config(state: tauri::State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn set_config(state: tauri::State<AppState>, password: String, github_token: String) {
    let mut cfg = state.config.lock().unwrap();
    cfg.password = password;
    cfg.github_token = github_token;
    save_config(&cfg);
}

#[tauri::command]
async fn get_bot_status(state: tauri::State<'_, AppState>) -> Result<BotStatus, String> {
    let cfg = state.config.lock().unwrap().clone();

    let mut status = BotStatus {
        online: false,
        tunnel_url: None,
        run_id: None,
        run_status: None,
        run_conclusion: None,
        run_url: None,
    };

    // Auto-detect tunnel URL from repo
    if let Ok(url) = get_tunnel_url().await {
        if !url.is_empty() {
            status.tunnel_url = Some(url.clone());
            let health_url = format!("{}/api/health", url.trim_end_matches('/'));
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .map_err(|e| e.to_string())?;
            if let Ok(resp) = client.get(&health_url).send().await {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    status.online = body.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                }
            }
        }
    }

    // Check GitHub Actions status
    if !cfg.github_token.is_empty() {
        let api_url = format!(
            "https://api.github.com/repos/{}/actions/workflows/{}/runs?per_page=1",
            GITHUB_REPO, WORKFLOW_FILE
        );
        let client = reqwest::Client::new();
        if let Ok(resp) = client
            .get(&api_url)
            .header("Authorization", format!("Bearer {}", cfg.github_token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "jurobot-client")
            .send()
            .await
        {
            if let Ok(body) = resp.json::<RunsResponse>().await {
                if let Some(run) = body.workflow_runs.first() {
                    status.run_id = Some(run.id);
                    status.run_status = Some(run.status.clone());
                    status.run_conclusion = run.conclusion.clone();
                    status.run_url = Some(run.html_url.clone());
                }
            }
        }
    }

    Ok(status)
}

#[tauri::command]
async fn start_bot(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let cfg = state.config.lock().unwrap().clone();
    if cfg.github_token.is_empty() {
        return Err("GitHub token not configured".into());
    }

    let api_url = format!(
        "https://api.github.com/repos/{}/actions/workflows/{}/dispatches",
        GITHUB_REPO, WORKFLOW_FILE
    );

    let body = serde_json::json!({
        "ref": "main",
        "inputs": {
            "duration": "6"
        }
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", cfg.github_token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "jurobot-client")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok("Bot start triggered".into())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("GitHub API error {}: {}", status, text))
    }
}

#[tauri::command]
async fn stop_bot(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let cfg = state.config.lock().unwrap().clone();
    if cfg.github_token.is_empty() {
        return Err("GitHub token not configured".into());
    }

    // Find the latest in-progress run
    let list_url = format!(
        "https://api.github.com/repos/{}/actions/workflows/{}/runs?per_page=5&status=in_progress",
        GITHUB_REPO, WORKFLOW_FILE
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&list_url)
        .header("Authorization", format!("Bearer {}", cfg.github_token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "jurobot-client")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: RunsResponse = resp.json().await.map_err(|e| e.to_string())?;
    let run = body.workflow_runs.first().ok_or("No running workflow found")?;

    let cancel_url = format!(
        "https://api.github.com/repos/{}/actions/runs/{}/cancel",
        GITHUB_REPO, run.id
    );

    let resp = client
        .post(&cancel_url)
        .header("Authorization", format!("Bearer {}", cfg.github_token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "jurobot-client")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(format!("Run #{} cancelled", run.run_number))
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("GitHub API error {}: {}", status, text))
    }
}

#[tauri::command]
async fn get_tunnel_url() -> Result<String, String> {
    let url = "https://raw.githubusercontent.com/idkvr380-svg/jurobot-v2/main/tunnel-url.txt";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
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
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            get_bot_status,
            start_bot,
            stop_bot,
            get_tunnel_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
