mod sidecar;
mod tray;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When second instance is launched, show dashboard via tray
            sidecar::show_dashboard_from_state(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(sidecar::SidecarState {
            child: None,
            port: None,
            host: None,
            ui_token: None,
            is_leader: false,
        }))
        .setup(|app| {
            tray::create_tray(app)?;
            // Start sidecar server in background (no auto-open dashboard)
            let handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sidecar::start_server(&handle).await {
                    eprintln!("Failed to start server: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
