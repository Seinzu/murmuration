mod audio;
mod arc_mappings;
mod serialosc;
mod ws;

use std::sync::Arc;

use tauri::path::BaseDirectory;
use tauri::Manager;

use crate::arc_mappings::ArcMappings;
use crate::audio::AudioEngine;
use crate::serialosc::SerialOsc;
use crate::ws::Ctx;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let path = app.path();
      let scsynth_bin = path.resolve("resources/sc/Resources/scsynth", BaseDirectory::Resource)?;
      let plugin_dir  = path.resolve("resources/sc/Resources/plugins",  BaseDirectory::Resource)?;
      let synthdef_dir = path.resolve("resources/synthdefs", BaseDirectory::Resource)?;
      let mappings_path = path.resolve("arc-mappings.json", BaseDirectory::AppConfig)?;

      // Ensure app config dir exists for first-run persistence.
      if let Some(parent) = mappings_path.parent() {
        let _ = std::fs::create_dir_all(parent);
      }

      tauri::async_runtime::spawn(async move {
        match AudioEngine::start(Some(scsynth_bin), &synthdef_dir, Some(&plugin_dir)).await {
          Ok(audio) => {
            let audio = Arc::new(audio);
            let mappings = Arc::new(ArcMappings::new(mappings_path));
            let (tx, _) = tokio::sync::broadcast::channel(64);
            let serialosc = match SerialOsc::start(audio.clone(), mappings.clone(), tx.clone()).await {
              Ok(s) => s,
              Err(e) => { log::warn!("[serialosc] failed to start: {:?}", e); return; }
            };
            let ctx = Arc::new(Ctx { audio, mappings, serialosc, broadcast: tx });
            if let Err(e) = ws::serve(ctx).await {
              log::error!("[ws] server error: {:?}", e);
            }
          }
          Err(e) => log::error!("[audio] failed to start: {:?}", e),
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
