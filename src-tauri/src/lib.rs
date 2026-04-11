use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::sync::Mutex;
use std::collections::HashMap;
use std::net::TcpListener;
use std::time::Duration;
use std::io::Write;
use std::process::Command;
use std::path::Path;

struct ServerProcess(Mutex<Option<CommandChild>>);

fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("failed to bind to ephemeral port");
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    port
}

fn wait_for_server(port: u16, timeout_secs: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);
    while start.elapsed() < timeout {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

/// Read a .env file and return key=value pairs
fn read_dotenv(path: &Path) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    if let Ok(content) = std::fs::read_to_string(path) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                vars.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }
    vars
}

/// Read user config from ~/.kai/settings.json
fn read_user_config(home: &Path) -> serde_json::Value {
    let config_path = home.join(".kai").join("settings.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(json) = serde_json::from_str(&content) {
            return json;
        }
    }
    serde_json::Value::Object(serde_json::Map::new())
}

/// Check if Tailscale CLI is available and running
fn is_tailscale_available() -> bool {
    let tailscale_paths = [
        "tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/usr/bin/tailscale",
    ];
    
    for path in &tailscale_paths {
        let result = Command::new(path)
            .args(["status", "--json"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output();
            
        if let Ok(output) = result {
            if output.status.success() {
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    if let Some(backend_state) = json.get("BackendState") {
                        if backend_state.as_str() == Some("Running") {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_path = dirs::home_dir().unwrap().join(".kai").join("tauri.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .ok();

    macro_rules! debug_log {
        ($file:expr, $($arg:tt)*) => {
            if let Some(ref mut f) = $file {
                let _ = writeln!(f, "{}", format!($($arg)*));
                let _ = f.flush();
            }
        };
    }

    let mut log = log_file;
    debug_log!(log, "=== Kai Tauri starting ===");

    let home = dirs::home_dir().unwrap();
    let config = read_user_config(&home);
    
    // Check if VPN/Tailscale is enabled in config (default: true)
    let vpn_enabled = config.get("vpn")
        .and_then(|v| v.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    
    debug_log!(log, "VPN enabled in config: {}", vpn_enabled);
    
    // Only auto-detect Tailscale if VPN is enabled
    let tailscale_available = if vpn_enabled { is_tailscale_available() } else { false };
    debug_log!(log, "Tailscale detected: {}", tailscale_available);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let resource_dir = app.path().resource_dir()
                .expect("failed to resolve resource dir");
            let node_binary = resource_dir.join("node").join("node");
            let server_script = resource_dir.join("dist").join("index.js");
            let node_modules = resource_dir.join("node_modules");

            let port = find_free_port();
            let port_str = port.to_string();

            debug_log!(log, "Resource dir: {:?}", resource_dir);
            debug_log!(log, "Node binary exists: {}", node_binary.exists());
            debug_log!(log, "Port: {}", port);

            // Load env vars from ~/.kai/.env
            let kai_env = home.join(".kai").join(".env");
            let mut env_vars: HashMap<String, String> = HashMap::new();
            for (k, v) in read_dotenv(&kai_env) { env_vars.insert(k, v); }
            debug_log!(log, "Loaded {} env vars from ~/.kai/.env", env_vars.len());

            // Build the command
            let shell = app.shell();
            let mut cmd = shell.command(node_binary.to_str().unwrap());
            cmd = cmd.current_dir(&home);
            cmd = cmd.env("NODE_PATH", node_modules.to_str().unwrap());
            cmd = cmd.env("HOME", home.to_str().unwrap());
            for (key, value) in &env_vars {
                cmd = cmd.env(key, value);
            }

            // Build args
            let mut args = vec![
                server_script.to_str().unwrap().to_string(),
                "server".to_string(),
                "--port".to_string(),
                port_str.clone(),
                "--skip-build".to_string(),
            ];
            
            // Only add --tailscale if VPN is enabled AND Tailscale is available
            if vpn_enabled && tailscale_available {
                args.push("--tailscale".to_string());
                debug_log!(log, "Auto-enabling Tailscale (--tailscale)");
            }

            let (mut rx, child) = cmd
                .args(args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
                .spawn()
                .expect("failed to start Kai server");

            debug_log!(log, "Node process spawned");

            let state: tauri::State<ServerProcess> = app.state();
            *state.0.lock().unwrap() = Some(child);

            // Log sidecar output
            let sidecar_log_path = home.join(".kai").join("tauri-node.log");
            std::thread::spawn(move || {
                let mut sidecar_log = std::fs::OpenOptions::new()
                    .create(true).write(true).truncate(true)
                    .open(&sidecar_log_path).ok();
                while let Some(event) = rx.blocking_recv() {
                    match event {
                        CommandEvent::Stdout(line) => {
                            debug_log!(sidecar_log, "[stdout] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            debug_log!(sidecar_log, "[stderr] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            debug_log!(sidecar_log, "[terminated] code={:?}", payload.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Wait for server then show window
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if wait_for_server(port, 30) {
                    std::thread::sleep(Duration::from_millis(500));
                    if let Some(window) = handle.get_webview_window("main") {
                        let url = format!("http://localhost:{}", port);
                        let _ = window.navigate(url.parse::<url::Url>().unwrap());
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                } else {
                    if let Some(window) = handle.get_webview_window("main") {
                        let msg = "data:text/html,\
                            <html><body style='font-family:-apple-system,system-ui,sans-serif;\
                            display:flex;align-items:center;justify-content:center;height:100vh;\
                            margin:0;background:%23111;color:%23eee;text-align:center'>\
                            <div><h2 style='margin-bottom:8px'>Kai failed to start</h2>\
                            <p style='color:%23999'>Check ~/.kai/tauri-node.log for details</p>\
                            </div></body></html>";
                        let _ = window.navigate(msg.parse().unwrap());
                        let _ = window.show();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<ServerProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            }
        });
}
