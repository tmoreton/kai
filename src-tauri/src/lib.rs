use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::sync::Mutex;
use std::collections::HashMap;
use std::net::TcpListener;
use std::time::Duration;
use std::io::Write;
use std::process::Command;

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
fn read_dotenv(path: &std::path::Path) -> HashMap<String, String> {
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

/// Check if Tailscale is installed
fn is_tailscale_installed() -> bool {
    let paths = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
    for path in paths {
        if Command::new("which").arg(path).output().map(|o| o.status.success()).unwrap_or(false) {
            return true;
        }
        if std::path::Path::new(path).exists() {
            return true;
        }
    }
    false
}

/// Get Tailscale status
/// Returns: (installed, logged_in, running, hostname, dns_name)
fn get_tailscale_status() -> (bool, bool, bool, Option<String>, Option<String>) {
    // Check if CLI is available (installed)
    let cli_available = is_tailscale_installed();
    if !cli_available {
        return (false, false, false, None, None);
    }
    
    // Try to get status
    let output = match Command::new("tailscale")
        .args(["status", "--json"])
        .output() {
        Ok(o) => o,
        Err(_) => return (true, false, false, None, None),
    };
    
    if !output.status.success() {
        // CLI works but status failed - likely not logged in
        return (true, false, false, None, None);
    }
    
    let json: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(j) => j,
        Err(_) => return (true, false, false, None, None),
    };
    
    // Check backend state - "Running" means logged in and connected
    let backend_state = json["BackendState"].as_str().unwrap_or("");
    let running = backend_state == "Running";
    let logged_in = running || backend_state == "Starting" || backend_state == "NoState";
    
    let hostname = json["Self"]["HostName"].as_str().map(|s| s.to_string());
    let dns_name = json["Self"]["DNSName"].as_str().map(|s| s.trim_end_matches('.').to_string());
    
    (true, logged_in, running, hostname, dns_name)
}

/// Start Tailscale serve or funnel
fn start_tailscale(port: u16, funnel: bool) -> Result<String, String> {
    let command = if funnel { "funnel" } else { "serve" };
    
    let output = Command::new("tailscale")
        .args([command, "--bg", &port.to_string()])
        .output()
        .map_err(|e| format!("Failed to run tailscale {}: {}", command, e))?;
    
    if output.status.success() {
        let (_, _, _, _, dns_name) = get_tailscale_status();
        let url = dns_name.map(|dns| format!("https://{}", dns))
            .unwrap_or_else(|| format!("https://tailscale:{}.ts.net", port));
        Ok(url)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Tailscale {} failed: {}", command, stderr))
    }
}

// Tauri commands for Tailscale

#[tauri::command]
fn tailscale_status() -> serde_json::Value {
    let (_installed, logged_in, running, hostname, dns_name) = get_tailscale_status();
    
    serde_json::json!({
        "installed": _installed,
        "logged_in": logged_in,
        "running": running,
        "hostname": hostname,
        "dns_name": dns_name
    })
}

#[tauri::command]
fn tailscale_start_serve(port: u16) -> Result<String, String> {
    start_tailscale(port, false)
}

#[tauri::command]
fn tailscale_start_funnel(port: u16) -> Result<String, String> {
    start_tailscale(port, true)
}

#[tauri::command]
fn tailscale_stop() {
    let _ = Command::new("tailscale").args(["serve", "reset"]).output();
    let _ = Command::new("tailscale").args(["funnel", "reset"]).output();
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

            // Load env vars from ~/.kai/.env only (credentials should never be bundled)
            let home = dirs::home_dir().unwrap();
            let mut env_vars: HashMap<String, String> = HashMap::new();

            let kai_env = home.join(".kai").join(".env");
            for (k, v) in read_dotenv(&kai_env) { env_vars.insert(k, v); }

            debug_log!(log, "Loaded {} env vars from ~/.kai/.env", env_vars.len());

            // Build the command with all env vars
            // Set cwd to home so sessions resolve the same as terminal usage
            let shell = app.shell();
            let mut cmd = shell.command(node_binary.to_str().unwrap());
            cmd = cmd.current_dir(&home);
            cmd = cmd.env("NODE_PATH", node_modules.to_str().unwrap());
            cmd = cmd.env("HOME", home.to_str().unwrap());
            for (key, value) in &env_vars {
                cmd = cmd.env(key, value);
            }

            let (mut rx, child) = cmd
                .args([
                    server_script.to_str().unwrap(),
                    "server",
                    "--port", &port_str,
                    "--skip-build",
                ])
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

            // Wait for server then configure networking and show window
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if wait_for_server(port, 30) {
                    std::thread::sleep(Duration::from_millis(500));
                    
                    // Check for Tailscale and auto-configure if running
                    let mut final_url = format!("http://localhost:{}", port);
                    let (installed, _, running, _, dns_name) = get_tailscale_status();
                    
                    if installed && running {
                        // Try to start Tailscale serve for this port
                        match start_tailscale(port, false) {
                            Ok(tailscale_url) => {
                                debug_log!(log, "Tailscale serve started: {}", tailscale_url);
                                final_url = tailscale_url;
                            }
                            Err(e) => {
                                debug_log!(log, "Failed to start Tailscale serve: {}", e);
                            }
                        }
                    } else if installed {
                        debug_log!(log, "Tailscale installed but not running (not logged in)");
                    }
                    
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.navigate(final_url.parse::<url::Url>().unwrap());
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
        .invoke_handler(tauri::generate_handler![
            tailscale_status,
            tailscale_start_serve,
            tailscale_start_funnel,
            tailscale_stop
        ])
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
