//! beatgem-media: Content fingerprinting, staged footage analysis (Stage 0 Probe, Stage 1 Quick Pass,
//! Stage 2 Full Shader Pass), filmstrips, and disposable content-keyed analysis cache.
//! Section 8.2 & 12: A file is identified by content fingerprint (size + sampled bytes from head, middle, tail).

use beatgem_core::Tick;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub const FINGERPRINT_WINDOW_BYTES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnalysisStage {
    Stage0ProbeOnly = 0,
    Stage1QuickSparse = 1,
    Stage2FullShader = 2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneCutCandidate {
    pub tick: Tick,
    pub confidence: f32,
    pub exact_frame: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackFrameSpan {
    pub start_ticks: Tick,
    pub end_ticks: Tick,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionEnergySample {
    pub tick: Tick,
    pub magnitude: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FootageAnalysisCacheEntry {
    pub content_fingerprint: String,
    pub stage_completed: AnalysisStage,
    pub scenes: Vec<SceneCutCandidate>,
    pub black_ranges: Vec<BlackFrameSpan>,
    pub motion_curve: Vec<MotionEnergySample>,
}

/// Section 12: Compute content fingerprint from file size + sampled bytes from head, middle, and tail.
/// Never modifies the user's file; survives file renames and folder moves.
pub fn fingerprint_media_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut hasher = blake3::Hasher::new();
    hasher.update(&size.to_le_bytes());

    let mut buf = vec![0u8; FINGERPRINT_WINDOW_BYTES.min(size as usize)];

    // 1. Head bytes
    file.seek(SeekFrom::Start(0))?;
    let n_head = file.read(&mut buf)?;
    hasher.update(&buf[..n_head]);

    // 2. Middle bytes
    if size > (FINGERPRINT_WINDOW_BYTES as u64) * 2 {
        file.seek(SeekFrom::Start(size / 2))?;
        let n_mid = file.read(&mut buf)?;
        hasher.update(&buf[..n_mid]);
    }

    // 3. Tail bytes
    if size > FINGERPRINT_WINDOW_BYTES as u64 {
        file.seek(SeekFrom::End(-(buf.len() as i64)))?;
        let n_tail = file.read(&mut buf)?;
        hasher.update(&buf[..n_tail]);
    }

    let hex = hasher.finalize().to_hex();
    Ok(format!("fp_{}_{}", size, &hex[..16]))
}
