// Arc mapping persistence. Ports server/arc-mappings.js.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Param {
    pub name: String,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    #[serde(rename = "oscPath")]
    pub osc_path: String,
}

#[derive(Serialize, Deserialize)]
struct Persisted {
    #[serde(rename = "availableParams")]
    available_params: Vec<Param>,
    #[serde(rename = "encoderMap")]
    encoder_map: Vec<usize>,
}

pub struct ArcMappings {
    path: PathBuf,
    inner: Mutex<Persisted>,
}

impl ArcMappings {
    pub fn new(path: PathBuf) -> Self {
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Persisted>(&s).ok())
            .unwrap_or_else(default_persisted);
        Self { path, inner: Mutex::new(inner) }
    }

    pub fn snapshot_json(&self) -> serde_json::Value {
        let p = self.inner.lock().unwrap();
        let encoders: Vec<Param> = p.encoder_map.iter()
            .filter_map(|&i| p.available_params.get(i).cloned())
            .collect();
        serde_json::json!({
            "availableParams": p.available_params,
            "encoderMap": p.encoder_map,
            "encoders": encoders,
        })
    }

    pub fn encoder_params(&self) -> Vec<Param> {
        let p = self.inner.lock().unwrap();
        p.encoder_map.iter()
            .filter_map(|&i| p.available_params.get(i).cloned())
            .collect()
    }

    pub fn set_mapping(&self, encoder: usize, param_index: usize) -> bool {
        let mut p = self.inner.lock().unwrap();
        if encoder > 3 || param_index >= p.available_params.len() { return false; }
        p.encoder_map[encoder] = param_index;
        self.save(&p);
        true
    }

    pub fn add_param(&self, param: Param) -> bool {
        let mut p = self.inner.lock().unwrap();
        if p.available_params.iter().any(|x| x.name == param.name) { return false; }
        p.available_params.push(param);
        self.save(&p);
        true
    }

    fn save(&self, p: &Persisted) {
        if let Ok(s) = serde_json::to_string_pretty(p) {
            let _ = std::fs::write(&self.path, s);
        }
    }
}

fn default_persisted() -> Persisted {
    Persisted {
        available_params: vec![
            Param { name: "attackTime".into(),  min: 0.01, max: 2.0,    default: 0.3,    osc_path: "/murmuration/arc/attackTime".into() },
            Param { name: "releaseTime".into(), min: 0.1,  max: 5.0,    default: 2.1,    osc_path: "/murmuration/arc/releaseTime".into() },
            Param { name: "filterMul".into(),   min: 0.25, max: 4.0,    default: 1.0,    osc_path: "/murmuration/arc/filterMul".into() },
            Param { name: "resonance".into(),   min: 0.1,  max: 1.0,    default: 0.7,    osc_path: "/murmuration/arc/resonance".into() },
            Param { name: "reverbMix".into(),   min: 0.0,  max: 1.0,    default: 0.6,    osc_path: "/murmuration/arc/reverbMix".into() },
            Param { name: "reverbRoom".into(),  min: 0.0,  max: 1.0,    default: 0.8,    osc_path: "/murmuration/arc/reverbRoom".into() },
            Param { name: "thunderFilterAmt".into(), min: 0.0, max: 6000.0, default: 3000.0, osc_path: "/murmuration/arc/thunderFilterAmt".into() },
            Param { name: "thunderReverbAmt".into(), min: 0.0, max: 0.5,    default: 0.3,    osc_path: "/murmuration/arc/thunderReverbAmt".into() },
        ],
        encoder_map: vec![0, 1, 2, 3],
    }
}
