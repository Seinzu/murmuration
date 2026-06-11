// serialosc client. Ports server/devices.js, grid.js, arc.js.
//
// Protocol:
//   1. Send /serialosc/list <host> <port> to 127.0.0.1:12002.
//   2. Daemon replies /serialosc/device <id> <type> <port>.
//   3. Connect to device port, send /sys/host, /sys/port, /sys/prefix "/monome".
//   4. Send /sys/info to learn grid size.
//   5. Receive /monome/grid/key, /monome/enc/delta, /monome/enc/key.
//   6. Send LED updates via /monome/grid/led/* and /monome/ring/map.

use anyhow::Result;
use rosc::{decoder, encoder, OscMessage, OscPacket, OscType};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::Mutex;

use crate::arc_mappings::{ArcMappings, Param};
use crate::audio::AudioEngine;

const SERIALOSC_PORT: u16 = 12002;
const PREFIX: &str = "/monome";
const ARC_SENSITIVITY: f32 = 1.0 / 800.0;
const ARC_THROTTLE_MS: u128 = 33;
const ARC_LED_COUNT: usize = 64;

struct GridDev {
    port: u16,
    size_x: u32,
    size_y: u32,
    varibright: bool,
    last_state: Vec<Vec<u8>>, // rows of levels (0..15)
}

struct ArcDev {
    port: u16,
    values: [f32; 4],
    params: [Param; 4],
    last_ring_update: [u128; 4],
}

pub struct SerialOsc {
    sock: Arc<UdpSocket>,
    audio: Arc<AudioEngine>,
    mappings: Arc<ArcMappings>,
    broadcast: tokio::sync::broadcast::Sender<String>,
    grid: Mutex<Option<GridDev>>,
    arc: Mutex<Option<ArcDev>>,
}

impl SerialOsc {
    pub async fn start(
        audio: Arc<AudioEngine>,
        mappings: Arc<ArcMappings>,
        broadcast: tokio::sync::broadcast::Sender<String>,
    ) -> Result<Arc<Self>> {
        let sock = Arc::new(UdpSocket::bind("127.0.0.1:0").await?);
        let local_port = sock.local_addr()?.port();
        log::info!("[serialosc] listening on 127.0.0.1:{}", local_port);

        let this = Arc::new(Self {
            sock: sock.clone(),
            audio,
            mappings,
            broadcast,
            grid: Mutex::new(None),
            arc: Mutex::new(None),
        });

        // Receive loop.
        {
            let this = this.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                loop {
                    match this.sock.recv_from(&mut buf).await {
                        Ok((n, src)) => {
                            if let Ok((_, packet)) = decoder::decode_udp(&buf[..n]) {
                                this.handle_packet(packet, src).await;
                            }
                        }
                        Err(e) => { log::warn!("[serialosc] recv: {:?}", e); break; }
                    }
                }
            });
        }

        // Ask serialosc daemon for device list.
        let daemon: SocketAddr = format!("127.0.0.1:{}", SERIALOSC_PORT).parse()?;
        send_osc(&sock, daemon, "/serialosc/list", vec![
            OscType::String("127.0.0.1".into()),
            OscType::Int(local_port as i32),
        ]).await?;
        // Also request hotplug notifications.
        send_osc(&sock, daemon, "/serialosc/notify", vec![
            OscType::String("127.0.0.1".into()),
            OscType::Int(local_port as i32),
        ]).await?;

        Ok(this)
    }

    async fn handle_packet(&self, packet: OscPacket, _src: SocketAddr) {
        match packet {
            OscPacket::Message(msg) => self.handle_msg(msg).await,
            OscPacket::Bundle(b) => {
                for p in b.content { Box::pin(self.handle_packet(p, _src)).await; }
            }
        }
    }

    async fn handle_msg(&self, msg: OscMessage) {
        log::debug!("[serialosc] rx {} args={:?}", msg.addr, msg.args);
        let a = msg.addr.as_str();
        match a {
            "/serialosc/device" | "/serialosc/add" => {
                // args: id (string), type (string), port (int)
                let kind = msg.args.get(1).and_then(as_str).unwrap_or("");
                let port = msg.args.get(2).and_then(as_int).unwrap_or(0) as u16;
                let id = msg.args.get(0).and_then(as_str).unwrap_or("").to_string();
                log::info!("[serialosc] device: {} ({}), port {}", id, kind, port);
                let k = kind.to_lowercase();
                if k.contains("arc") {
                    self.connect_arc(port).await;
                } else if k.contains("grid") || k.contains("one") || id.as_bytes().first() == Some(&b'm') {
                    let varibright = is_varibright(&id);
                    self.connect_grid(port, varibright).await;
                } else if id.as_bytes().first() == Some(&b'a') {
                    self.connect_arc(port).await;
                } else {
                    log::warn!("[serialosc] unknown device type {} for {}", kind, id);
                }
            }
            "/serialosc/remove" => {
                // We don't distinguish which; just drop state.
                let id = msg.args.get(0).and_then(as_str).unwrap_or("");
                log::info!("[serialosc] device removed: {}", id);
            }
            "/sys/size" => {
                let w = msg.args.get(0).and_then(as_int).unwrap_or(16) as u32;
                let h = msg.args.get(1).and_then(as_int).unwrap_or(8) as u32;
                let mut g = self.grid.lock().await;
                if let Some(dev) = g.as_mut() {
                    dev.size_x = w; dev.size_y = h;
                    dev.last_state = vec![vec![0u8; w as usize]; h as usize];
                    log::info!("[serialosc] grid size: {}x{}", w, h);
                }
            }
            _ if a == format!("{}/grid/key", PREFIX) => {
                let x = msg.args.get(0).and_then(as_int).unwrap_or(0);
                let y = msg.args.get(1).and_then(as_int).unwrap_or(0);
                let s = msg.args.get(2).and_then(as_int).unwrap_or(0);
                if s == 1 {
                    let out = serde_json::json!({ "type": "toggle", "row": y, "col": x });
                    let _ = self.broadcast.send(out.to_string());
                }
            }
            _ if a == format!("{}/enc/delta", PREFIX) => {
                let n = msg.args.get(0).and_then(as_int).unwrap_or(-1);
                let d = msg.args.get(1).and_then(as_int).unwrap_or(0);
                if n >= 0 { self.arc_delta(n as usize, d).await; }
            }
            _ if a == format!("{}/enc/key", PREFIX) => {
                let n = msg.args.get(0).and_then(as_int).unwrap_or(-1);
                let s = msg.args.get(1).and_then(as_int).unwrap_or(0);
                if n >= 0 && s == 1 { self.arc_reset(n as usize).await; }
            }
            _ => {}
        }
    }

    async fn connect_grid(&self, port: u16, varibright: bool) {
        let local_port = self.sock.local_addr().unwrap().port();
        let dest: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        let _ = send_osc(&self.sock, dest, "/sys/host", vec![OscType::String("127.0.0.1".into())]).await;
        let _ = send_osc(&self.sock, dest, "/sys/port", vec![OscType::Int(local_port as i32)]).await;
        let _ = send_osc(&self.sock, dest, "/sys/prefix", vec![OscType::String(PREFIX.into())]).await;
        let _ = send_osc(&self.sock, dest, "/sys/info", vec![]).await;

        *self.grid.lock().await = Some(GridDev {
            port, size_x: 16, size_y: 8, varibright,
            last_state: vec![vec![0u8; 16]; 8],
        });
    }

    async fn connect_arc(&self, port: u16) {
        let local_port = self.sock.local_addr().unwrap().port();
        let dest: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        let _ = send_osc(&self.sock, dest, "/sys/host", vec![OscType::String("127.0.0.1".into())]).await;
        let _ = send_osc(&self.sock, dest, "/sys/port", vec![OscType::Int(local_port as i32)]).await;
        let _ = send_osc(&self.sock, dest, "/sys/prefix", vec![OscType::String(PREFIX.into())]).await;

        let params = self.mappings.encoder_params();
        let mut p4: [Param; 4] = [
            params.first().cloned().unwrap_or_else(default_param),
            params.get(1).cloned().unwrap_or_else(default_param),
            params.get(2).cloned().unwrap_or_else(default_param),
            params.get(3).cloned().unwrap_or_else(default_param),
        ];
        // Normalize suppressing unused-mut warning
        let _ = &mut p4;
        let values = [
            norm(&p4[0]), norm(&p4[1]), norm(&p4[2]), norm(&p4[3]),
        ];
        *self.arc.lock().await = Some(ArcDev {
            port, values, params: p4, last_ring_update: [0; 4],
        });
        for n in 0..4 { self.update_ring(n).await; }
    }

    async fn arc_delta(&self, n: usize, d: i32) {
        if n >= 4 { return; }
        let (osc_path, mapped) = {
            let mut guard = self.arc.lock().await;
            let Some(arc) = guard.as_mut() else { return };
            arc.values[n] = (arc.values[n] + (d as f32) * ARC_SENSITIVITY).clamp(0.0, 1.0);
            let p = &arc.params[n];
            let mapped = p.min + arc.values[n] * (p.max - p.min);
            (p.osc_path.clone(), mapped)
        };
        let _ = self.audio.apply_arc_param(&osc_path, mapped).await;

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
        let should_draw = {
            let mut guard = self.arc.lock().await;
            let Some(arc) = guard.as_mut() else { return };
            if now_ms - arc.last_ring_update[n] >= ARC_THROTTLE_MS {
                arc.last_ring_update[n] = now_ms;
                true
            } else { false }
        };
        if should_draw { self.update_ring(n).await; }
    }

    async fn arc_reset(&self, n: usize) {
        if n >= 4 { return; }
        let (osc_path, default) = {
            let mut guard = self.arc.lock().await;
            let Some(arc) = guard.as_mut() else { return };
            let p = &arc.params[n];
            arc.values[n] = norm(p);
            (p.osc_path.clone(), p.default)
        };
        let _ = self.audio.apply_arc_param(&osc_path, default).await;
        self.update_ring(n).await;
    }

    pub async fn set_arc_mapping(&self, encoder: usize, param: Param) {
        if encoder >= 4 { return; }
        {
            let mut guard = self.arc.lock().await;
            let Some(arc) = guard.as_mut() else { return };
            arc.values[encoder] = norm(&param);
            arc.params[encoder] = param;
        }
        self.update_ring(encoder).await;
    }

    async fn update_ring(&self, n: usize) {
        let (port, value) = {
            let guard = self.arc.lock().await;
            let Some(arc) = guard.as_ref() else { return };
            (arc.port, arc.values[n])
        };
        let mut levels = vec![0i32; ARC_LED_COUNT];
        let lit = (value * (ARC_LED_COUNT as f32 - 1.0)).round() as usize;
        for i in 0..=lit.min(ARC_LED_COUNT - 1) {
            levels[i] = if i == lit { 12 } else { 8 };
        }
        let mut args = vec![OscType::Int(n as i32)];
        for l in levels { args.push(OscType::Int(l)); }
        let dest: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        let _ = send_osc(&self.sock, dest, &format!("{}/ring/map", PREFIX), args).await;
    }

    pub async fn update_grid(&self, state: &Vec<Vec<bool>>) {
        let (port, size_x, size_y, varibright) = {
            let guard = self.grid.lock().await;
            let Some(g) = guard.as_ref() else { return };
            (g.port, g.size_x, g.size_y, g.varibright)
        };
        let dest: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        for x_off in (0..size_x).step_by(8) {
            for y_off in (0..size_y).step_by(8) {
                if varibright {
                    let mut levels = vec![OscType::Int(x_off as i32), OscType::Int(y_off as i32)];
                    for dy in 0..8 {
                        for dx in 0..8 {
                            let y = (y_off + dy) as usize;
                            let x = (x_off + dx) as usize;
                            let on = state.get(y).and_then(|r| r.get(x)).copied().unwrap_or(false);
                            levels.push(OscType::Int(if on { 7 } else { 0 }));
                        }
                    }
                    let _ = send_osc(&self.sock, dest, &format!("{}/grid/led/level/map", PREFIX), levels).await;
                } else {
                    // Low-res: 8 ints, each an 8-bit row mask.
                    let mut args = vec![OscType::Int(x_off as i32), OscType::Int(y_off as i32)];
                    for dy in 0..8 {
                        let mut mask = 0i32;
                        for dx in 0..8 {
                            let y = (y_off + dy) as usize;
                            let x = (x_off + dx) as usize;
                            if state.get(y).and_then(|r| r.get(x)).copied().unwrap_or(false) {
                                mask |= 1 << dx;
                            }
                        }
                        args.push(OscType::Int(mask));
                    }
                    let _ = send_osc(&self.sock, dest, &format!("{}/grid/led/map", PREFIX), args).await;
                }
            }
        }
    }
}

fn is_varibright(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.first().copied() == Some(b'm') && bytes.iter().skip(1).take_while(|b| b.is_ascii_digit()).count() > 0
}

fn norm(p: &Param) -> f32 { (p.default - p.min) / (p.max - p.min) }

fn default_param() -> Param {
    Param { name: "noop".into(), min: 0.0, max: 1.0, default: 0.5, osc_path: "/murmuration/arc/noop".into() }
}

fn as_str(t: &OscType) -> Option<&str> {
    if let OscType::String(s) = t { Some(s) } else { None }
}
fn as_int(t: &OscType) -> Option<i32> {
    match t {
        OscType::Int(i) => Some(*i),
        OscType::Long(l) => Some(*l as i32),
        _ => None,
    }
}

async fn send_osc(sock: &UdpSocket, dest: SocketAddr, addr: &str, args: Vec<OscType>) -> Result<()> {
    let packet = OscPacket::Message(OscMessage { addr: addr.to_string(), args });
    let buf = encoder::encode(&packet).map_err(|e| anyhow::anyhow!("osc encode: {:?}", e))?;
    sock.send_to(&buf, dest).await?;
    Ok(())
}
