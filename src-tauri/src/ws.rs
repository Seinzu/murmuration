// WebSocket server. Ports server/index.js WS dispatch.

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::tungstenite::Message;

use crate::arc_mappings::{ArcMappings, Param};
use crate::audio::AudioEngine;
use crate::serialosc::SerialOsc;

pub const WS_PORT: u16 = 8080;

pub struct Ctx {
    pub audio: Arc<AudioEngine>,
    pub mappings: Arc<ArcMappings>,
    pub serialosc: Arc<SerialOsc>,
    pub broadcast: broadcast::Sender<String>,
}

pub async fn serve(ctx: Arc<Ctx>) -> Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", WS_PORT)).await?;
    log::info!("WebSocket listening on ws://localhost:{}", WS_PORT);
    loop {
        let (stream, _) = listener.accept().await?;
        let ctx = ctx.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, ctx).await {
                log::warn!("[ws] connection error: {:?}", e);
            }
        });
    }
}

async fn handle_conn(stream: TcpStream, ctx: Arc<Ctx>) -> Result<()> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (write, mut read) = ws.split();
    let write = Arc::new(Mutex::new(write));
    let mut rx = ctx.broadcast.subscribe();

    // Broadcast pump.
    {
        let write = write.clone();
        tokio::spawn(async move {
            while let Ok(msg) = rx.recv().await {
                let mut w = write.lock().await;
                if w.send(Message::Text(msg)).await.is_err() { break; }
            }
        });
    }

    while let Some(msg) = read.next().await {
        let msg = match msg { Ok(m) => m, Err(_) => break };
        let text = match msg { Message::Text(t) => t, Message::Close(_) => break, _ => continue };
        let data: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => { log::warn!("[ws] bad JSON: {}", text); continue; }
        };
        let ty = data.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match ty {
            "grid_state" => {
                if let Some(grid) = data.get("data").and_then(|v| v.as_array()) {
                    let rows: Vec<Vec<bool>> = grid.iter().map(|row| {
                        row.as_array().map(|r| r.iter().map(|c| c.as_bool().unwrap_or(false)).collect())
                            .unwrap_or_default()
                    }).collect();
                    ctx.serialosc.update_grid(&rows).await;
                }
            }
            "audio_event" => {
                let event = data.get("event").and_then(|v| v.as_str()).unwrap_or("");
                handle_audio_event(&ctx, event, &data).await;
            }
            "get_arc_mappings" => {
                let snap = ctx.mappings.snapshot_json();
                let out = serde_json::json!({
                    "type": "arc_mappings",
                    "availableParams": snap["availableParams"],
                    "encoderMap": snap["encoderMap"],
                    "encoders": snap["encoders"],
                });
                let mut w = write.lock().await;
                let _ = w.send(Message::Text(out.to_string())).await;
            }
            "set_arc_mapping" => {
                let enc = data.get("encoder").and_then(|v| v.as_u64()).unwrap_or(99) as usize;
                let pidx = data.get("paramIndex").and_then(|v| v.as_u64()).unwrap_or(99) as usize;
                if ctx.mappings.set_mapping(enc, pidx) {
                    let params = ctx.mappings.encoder_params();
                    if let Some(p) = params.get(enc).cloned() {
                        ctx.serialosc.set_arc_mapping(enc, p).await;
                    }
                    broadcast_mappings(&ctx);
                }
            }
            "add_arc_param" => {
                if let Some(p) = data.get("param") {
                    if let Ok(param) = serde_json::from_value::<Param>(p.clone()) {
                        if ctx.mappings.add_param(param) {
                            broadcast_mappings(&ctx);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn broadcast_mappings(ctx: &Ctx) {
    let snap = ctx.mappings.snapshot_json();
    let out = serde_json::json!({
        "type": "arc_mappings",
        "availableParams": snap["availableParams"],
        "encoderMap": snap["encoderMap"],
        "encoders": snap["encoders"],
    });
    let _ = ctx.broadcast.send(out.to_string());
}

async fn handle_audio_event(ctx: &Ctx, event: &str, data: &Value) {
    let f = |k: &str| data.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let i = |k: &str| data.get(k).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let r = match event {
        "drone_on"     => ctx.audio.drone_on(i("boidIndex"), f("freq"), f("presence"), f("modIndex")).await,
        "drone_update" => ctx.audio.drone_update(i("boidIndex"), f("presence"), f("modIndex")).await,
        "drone_off"    => ctx.audio.drone_off(i("boidIndex")).await,
        "trigger"      => ctx.audio.trigger(f("freq"), f("velocity")).await,
        "flock_speed"  => ctx.audio.set_flock_speed(f("speed")).await,
        "thunder"      => ctx.audio.thunder().await,
        other => { log::warn!("[ws] unknown audio event: {}", other); Ok(()) }
    };
    if let Err(e) = r { log::warn!("[audio] {}: {:?}", event, e); }
}
