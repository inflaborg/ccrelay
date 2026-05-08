use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager,
};

use crate::sidecar;

const MENU_SHOW: &str = "show";
const MENU_START: &str = "start";
const MENU_STOP: &str = "stop";
const MENU_QUIT: &str = "quit";

/// Stored menu items for runtime state updates
pub struct TrayMenuState {
    pub start_item: MenuItem<tauri::Wry>,
    pub stop_item: MenuItem<tauri::Wry>,
}

pub fn create_tray(app: &tauri::App) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, MENU_SHOW, "Open Dashboard", true, None::<&str>)?;
    let start = MenuItem::with_id(app, MENU_START, "Start Server", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, MENU_STOP, "Stop Server", false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit CCRelay", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &start, &stop, &sep, &quit])
        .build()?;

    app.manage(Mutex::new(TrayMenuState {
        start_item: start.clone(),
        stop_item: stop.clone(),
    }));

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(true)
        .tooltip("CCRelay")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_SHOW => {
                sidecar::show_dashboard_from_state(app);
            }
            MENU_START => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = sidecar::start_server(&handle).await {
                        eprintln!("Failed to start server: {e}");
                    }
                });
            }
            MENU_STOP => {
                if let Err(e) = sidecar::stop_server(app) {
                    eprintln!("Failed to stop server: {e}");
                }
            }
            MENU_QUIT => {
                let _ = sidecar::stop_server(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(tray)
}

/// Update tray menu items to reflect server running state.
pub fn set_server_running(app: &AppHandle, running: bool) {
    let state = app.state::<Mutex<TrayMenuState>>();
    if let Ok(s) = state.lock() {
        let _ = s.start_item.set_enabled(!running);
        let _ = s.stop_item.set_enabled(running);
    };
}
