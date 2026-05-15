use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

use crate::tray;

pub struct SidecarState {
    pub child: Option<CommandChild>,
    pub port: Option<u16>,
    pub host: Option<String>,
    pub ui_token: Option<String>,
    pub is_leader: bool,
}

/// Start the ccrelay-server sidecar and parse port/token from stdout.
pub async fn start_server(app: &AppHandle) -> Result<(), String> {
    // Stop any existing sidecar before starting a new one
    let _ = stop_server(app);

    let sidecar_command = app
        .shell()
        .sidecar("ccrelay-server")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?;

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // Store child for later termination
    {
        let state = app.state::<Mutex<SidecarState>>();
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.child = Some(child);
    }

    // Read stdout for CCRELAY_PORT/HOST/UI_TOKEN lines
    use tauri_plugin_shell::process::CommandEvent;
    let mut port_found = None;
    let mut host_found = None;
    let mut token_found = None;
    let mut is_leader = false;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let output = String::from_utf8_lossy(&line);
                for line in output.lines() {
                    if let Some(port_str) = line.strip_prefix("CCRELAY_PORT=") {
                        if let Ok(port) = port_str.trim().parse::<u16>() {
                            port_found = Some(port);
                        }
                    }
                    if let Some(host_str) = line.strip_prefix("CCRELAY_HOST=") {
                        host_found = Some(host_str.trim().to_string());
                    }
                    if let Some(token_str) = line.strip_prefix("CCRELAY_UI_TOKEN=") {
                        token_found = Some(token_str.trim().to_string());
                    }
                    if let Some(role_str) = line.strip_prefix("CCRELAY_ROLE=") {
                        let role = role_str.trim();
                        is_leader = role == "leader";
                    }
                }
                // Once we have port, host, and token — server is fully ready
                if let (Some(port), Some(host), Some(token)) =
                    (port_found, host_found.clone(), token_found.clone())
                {
                    let state = app.state::<Mutex<SidecarState>>();
                    if let Ok(mut s) = state.lock() {
                        s.port = Some(port);
                        s.host = Some(host);
                        s.ui_token = Some(token);
                        s.is_leader = is_leader;
                    }
                    // Only mark as "running" when this instance is the leader
                    tray::set_server_running(app, is_leader);
                    break;
                }
            }
            CommandEvent::Stderr(line) => {
                eprintln!("[sidecar] {}", String::from_utf8_lossy(&line).trim());
            }
            CommandEvent::Terminated(_) => {
                let state = app.state::<Mutex<SidecarState>>();
                if let Ok(mut s) = state.lock() {
                    let was_leader = s.is_leader;
                    s.child = None;
                    s.port = None;
                    s.host = None;
                    s.ui_token = None;
                    s.is_leader = false;
                    if was_leader {
                        tray::set_server_running(app, false);
                    }
                }
                break;
            }
            CommandEvent::Error(err) => {
                eprintln!("[sidecar error] {err}");
                let state = app.state::<Mutex<SidecarState>>();
                if let Ok(s) = state.lock() {
                    if s.is_leader {
                        tray::set_server_running(app, false);
                    }
                }
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Stop the sidecar server process.
pub fn stop_server(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<SidecarState>>();
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let was_leader = s.is_leader;
    if let Some(child) = s.child.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill sidecar: {e}"))?;
    }
    s.port = None;
    s.host = None;
    s.ui_token = None;
    s.is_leader = false;
    if was_leader {
        tray::set_server_running(app, false);
    }
    Ok(())
}

/// Show the dashboard window, creating it if needed.
fn show_dashboard(app: &AppHandle, port: u16, host: &str, token: &str) {
    let url = format!("http://{host}:{port}/ccrelay/ui-auth?token={token}");

    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.navigate(url.parse().unwrap());
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    } else {
        match WebviewWindowBuilder::new(
            app,
            "dashboard",
            WebviewUrl::External(url.parse().unwrap()),
        )
        .title("CCRelay")
        .inner_size(1024.0, 720.0)
        .min_inner_size(640.0, 480.0)
        .build()
        {
            Ok(window) => {
                let handle = app.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = handle.get_webview_window("dashboard") {
                            let _ = w.hide();
                        }
                        // Hide Dock icon — tray-only mode
                        #[cfg(target_os = "macos")]
                        let _ = handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                });
            }
            Err(e) => eprintln!("Failed to create dashboard window: {e}"),
        }
    }
}

/// Show dashboard using stored state (for tray interaction).
pub fn show_dashboard_from_state(app: &AppHandle) {
    let result = {
        let state = app.state::<Mutex<SidecarState>>();
        let x = if let Ok(s) = state.lock() {
            (s.port, s.host.clone(), s.ui_token.clone())
        } else {
            return;
        };
        x
    };

    if let (Some(port), Some(host), Some(token)) = result {
        show_dashboard(app, port, &host, &token);
    }
}
