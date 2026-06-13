// scsynth lifecycle + OSC client + dispatcher. Ports server/scsynth.js.

use anyhow::{anyhow, Context, Result};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UdpSocket;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

const SC_PORT: u16 = 57110;
const FX_BUS: i32 = 16;
const THUNDER_BUS: i32 = 0;
const SRC_GROUP: i32 = 100;
const FX_GROUP: i32 = 101;

const DEFAULT_SCSYNTH: &str = "/Applications/SuperCollider.app/Contents/Resources/scsynth";

pub struct AudioEngine {
    socket: UdpSocket,
    dest: std::net::SocketAddr,
    next_node_id: AtomicI32,
    fx_id: i32,
    state: Mutex<State>,
    _child: Child, // drop on shutdown
}

struct State {
    drones: HashMap<i32, i32>, // boidIndex -> nodeId
    filter_mul: f32,
    drone_attack: f32,
    drone_release: f32,
    last_speed: f32,
}

impl AudioEngine {
    pub async fn start(scsynth_bin: Option<PathBuf>, synthdef_dir: &Path, plugin_dir: Option<&Path>) -> Result<Self> {
        let bin = scsynth_bin.unwrap_or_else(|| PathBuf::from(DEFAULT_SCSYNTH));
        log::info!("[audio] spawning scsynth: {}", bin.display());

        let mut cmd = Command::new(&bin);
        cmd.args(["-u", &SC_PORT.to_string()]);
        if let Some(p) = plugin_dir {
            cmd.args(["-U", &p.to_string_lossy()]);
            log::info!("[audio] plugin dir: {}", p.display());
        }
        let mut child = cmd
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to spawn scsynth at {}", bin.display()))?;

        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no scsynth stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("no scsynth stderr"))?;

        // Mirror stderr to our log, background.
        tokio::spawn(async move {
            let mut r = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = r.next_line().await {
                log::warn!("[scsynth.err] {}", line);
            }
        });

        // Wait for "server ready" on stdout.
        let mut reader = BufReader::new(stdout).lines();
        let boot = tokio::time::timeout(Duration::from_secs(8), async {
            while let Some(line) = reader.next_line().await? {
                log::info!("[scsynth] {}", line);
                if line.to_lowercase().contains("server ready") {
                    return Ok::<(), anyhow::Error>(());
                }
            }
            Err(anyhow!("scsynth exited before reporting ready"))
        })
        .await
        .map_err(|_| anyhow!("scsynth boot timeout"))?;
        boot?;

        // Forward remaining stdout to log.
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                log::debug!("[scsynth] {}", line);
            }
        });

        let socket = UdpSocket::bind("127.0.0.1:0").await?;
        let dest: std::net::SocketAddr = format!("127.0.0.1:{}", SC_PORT).parse()?;

        // Load synthdefs, create groups, spawn FX synth.
        send_osc(
            &socket,
            dest,
            "/d_loadDir",
            vec![OscType::String(synthdef_dir.to_string_lossy().into_owned())],
        )
        .await?;
        sleep(Duration::from_millis(300)).await;

        send_osc(&socket, dest, "/g_new", vec![OscType::Int(SRC_GROUP), OscType::Int(0), OscType::Int(0)]).await?;
        send_osc(&socket, dest, "/g_new", vec![OscType::Int(FX_GROUP), OscType::Int(1), OscType::Int(0)]).await?;
        sleep(Duration::from_millis(50)).await;

        let fx_id = 1000;
        send_osc(
            &socket,
            dest,
            "/s_new",
            vec![
                OscType::String("murmurFX".into()),
                OscType::Int(fx_id),
                OscType::Int(0),
                OscType::Int(FX_GROUP),
                OscType::String("in".into()), OscType::Int(FX_BUS),
                OscType::String("out".into()), OscType::Int(0),
                OscType::String("filterFreq".into()), OscType::Float(1000.0),
                OscType::String("rq".into()), OscType::Float(0.7),
                OscType::String("reverbMix".into()), OscType::Float(0.6),
                OscType::String("reverbRoom".into()), OscType::Float(0.8),
                OscType::String("thunderBus".into()), OscType::Int(THUNDER_BUS),
                OscType::String("thunderFilterAmt".into()), OscType::Float(3000.0),
                OscType::String("thunderReverbAmt".into()), OscType::Float(0.3),
                OscType::String("delayMix".into()), OscType::Float(0.3),
                OscType::String("delayFeedback".into()), OscType::Float(0.4),
                OscType::String("delayTime".into()), OscType::Float(0.375),
            ],
        )
        .await?;

        Ok(Self {
            socket,
            dest,
            next_node_id: AtomicI32::new(fx_id + 1),
            fx_id,
            state: Mutex::new(State {
                drones: HashMap::new(),
                filter_mul: 1.0,
                drone_attack: 0.3,
                drone_release: 2.1,
                last_speed: 0.0,
            }),
            _child: child,
        })
    }

    fn nid(&self) -> i32 { self.next_node_id.fetch_add(1, Ordering::Relaxed) }

    async fn send(&self, addr: &str, args: Vec<OscType>) -> Result<()> {
        send_osc(&self.socket, self.dest, addr, args).await
    }

    pub async fn drone_on(&self, boid: i32, freq: f32, presence: f32, mod_index: f32) -> Result<()> {
        let mut s = self.state.lock().await;
        if s.drones.contains_key(&boid) { return Ok(()); }
        let id = self.nid();
        s.drones.insert(boid, id);
        let attack = s.drone_attack;
        let release = s.drone_release;
        drop(s);
        self.send("/s_new", vec![
            OscType::String("murmurDrone".into()),
            OscType::Int(id), OscType::Int(0), OscType::Int(SRC_GROUP),
            OscType::String("out".into()), OscType::Int(FX_BUS),
            OscType::String("freq".into()), OscType::Float(freq),
            OscType::String("amp".into()), OscType::Float((presence * 0.2).max(0.0)),
            OscType::String("modIndex".into()), OscType::Float(mod_index),
            OscType::String("gate".into()), OscType::Int(1),
            OscType::String("thunderBus".into()), OscType::Int(THUNDER_BUS),
            OscType::String("attackTime".into()), OscType::Float(attack),
            OscType::String("releaseTime".into()), OscType::Float(release),
        ]).await
    }

    pub async fn drone_update(&self, boid: i32, presence: f32, mod_index: f32) -> Result<()> {
        let id = match self.state.lock().await.drones.get(&boid).copied() {
            Some(id) => id, None => return Ok(()),
        };
        self.send("/n_set", vec![
            OscType::Int(id),
            OscType::String("amp".into()), OscType::Float((presence * 0.2).max(0.0)),
            OscType::String("modIndex".into()), OscType::Float(mod_index),
        ]).await
    }

    pub async fn drone_off(&self, boid: i32) -> Result<()> {
        let id = match self.state.lock().await.drones.remove(&boid) {
            Some(id) => id, None => return Ok(()),
        };
        self.send("/n_set", vec![OscType::Int(id), OscType::String("gate".into()), OscType::Int(0)]).await
    }

    pub async fn trigger(&self, freq: f32, velocity: f32) -> Result<()> {
        let id = self.nid();
        self.send("/s_new", vec![
            OscType::String("murmurTrigger".into()),
            OscType::Int(id), OscType::Int(0), OscType::Int(SRC_GROUP),
            OscType::String("out".into()), OscType::Int(FX_BUS),
            OscType::String("freq".into()), OscType::Float(freq),
            OscType::String("amp".into()), OscType::Float(velocity * 0.4),
        ]).await
    }

    pub async fn set_flock_speed(&self, speed: f32) -> Result<()> {
        let mut s = self.state.lock().await;
        s.last_speed = speed;
        let filter_freq = (400.0 + speed * 1000.0) * s.filter_mul;
        drop(s);
        self.send("/n_set", vec![
            OscType::Int(self.fx_id),
            OscType::String("filterFreq".into()), OscType::Float(filter_freq),
        ]).await
    }

    pub async fn thunder(&self) -> Result<()> {
        let id = self.nid();
        self.send("/s_new", vec![
            OscType::String("murmurThunder".into()),
            OscType::Int(id), OscType::Int(0), OscType::Int(SRC_GROUP),
            OscType::String("out".into()), OscType::Int(FX_BUS),
            OscType::String("thunderBus".into()), OscType::Int(THUNDER_BUS),
            OscType::String("modScale".into()), OscType::Float(10.0),
        ]).await
    }

    pub async fn apply_arc_param(&self, path: &str, value: f32) -> Result<()> {
        match path {
            "/murmuration/arc/attackTime" => {
                let mut s = self.state.lock().await;
                s.drone_attack = value;
                let ids: Vec<i32> = s.drones.values().copied().collect();
                drop(s);
                for id in ids {
                    self.send("/n_set", vec![OscType::Int(id), OscType::String("attackTime".into()), OscType::Float(value)]).await?;
                }
                Ok(())
            }
            "/murmuration/arc/releaseTime" => {
                let mut s = self.state.lock().await;
                s.drone_release = value;
                let ids: Vec<i32> = s.drones.values().copied().collect();
                drop(s);
                for id in ids {
                    self.send("/n_set", vec![OscType::Int(id), OscType::String("releaseTime".into()), OscType::Float(value)]).await?;
                }
                Ok(())
            }
            "/murmuration/arc/filterMul" => {
                let last = {
                    let mut s = self.state.lock().await;
                    s.filter_mul = value;
                    s.last_speed
                };
                self.set_flock_speed(last).await
            }
            "/murmuration/arc/resonance"         => self.set_fx("rq", value).await,
            "/murmuration/arc/reverbMix"         => self.set_fx("reverbMix", value).await,
            "/murmuration/arc/reverbRoom"        => self.set_fx("reverbRoom", value).await,
            "/murmuration/arc/thunderFilterAmt"  => self.set_fx("thunderFilterAmt", value).await,
            "/murmuration/arc/thunderReverbAmt"  => self.set_fx("thunderReverbAmt", value).await,
            other => { log::warn!("[audio] unknown arc path: {}", other); Ok(()) }
        }
    }

    async fn set_fx(&self, key: &str, value: f32) -> Result<()> {
        self.send("/n_set", vec![
            OscType::Int(self.fx_id),
            OscType::String(key.into()),
            OscType::Float(value),
        ]).await
    }
}

async fn send_osc(sock: &UdpSocket, dest: std::net::SocketAddr, addr: &str, args: Vec<OscType>) -> Result<()> {
    let packet = OscPacket::Message(OscMessage { addr: addr.to_string(), args });
    let buf = encoder::encode(&packet).map_err(|e| anyhow!("osc encode: {:?}", e))?;
    sock.send_to(&buf, dest).await?;
    Ok(())
}
