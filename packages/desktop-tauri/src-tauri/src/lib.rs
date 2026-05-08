mod sidecar;
mod tray;

use std::sync::Mutex;
use tauri::Manager;

/// Embed the icon PNG at compile time and set it as the macOS app icon.
/// In dev mode (cargo run), macOS shows a terminal icon by default.
/// This forces the correct icon on the Dock regardless of launch method.
#[cfg(target_os = "macos")]
fn set_dock_icon() {
    use objc::class;
    use objc::msg_send;
    use objc::sel;
    use objc::sel_impl;
    use objc::runtime::Object;

    static ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

    unsafe {
        let nsdata: *mut Object = msg_send![class!(NSData),
            dataWithBytes:ICON_PNG.as_ptr()
            length:ICON_PNG.len()
        ];
        let nsimage: *mut Object = msg_send![class!(NSImage), alloc];
        let nsimage: *mut Object = msg_send![nsimage, initWithData:nsdata];
        if !nsimage.is_null() {
            let nsapp: *mut Object = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![nsapp, setApplicationIconImage:nsimage];
            let _: () = msg_send![nsimage, release];
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn set_dock_icon() {}

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
            set_dock_icon();
            // Start sidecar server and open dashboard when ready
            let handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sidecar::start_server(&handle).await {
                    eprintln!("Failed to start server: {e}");
                }
                sidecar::show_dashboard_from_state(&handle);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
