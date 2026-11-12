//! beatgem-audio: Song decoding, multiband spectral flux onsets, tempo autocorrelation, and change points.
//! Section 8.1: Runs on the processor deliberately; verified against synthetic 120.0 BPM click-train fixture.

use beatgem_core::{Tick, TICKS_PER_SECOND};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnsetPeak {
    pub tick: Tick,
    pub strength: f32,
    pub low_band_flux: f32,
    pub mid_band_flux: f32,
    pub high_band_flux: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoudnessChangePoint {
    pub tick: Tick,
    pub label: String,
    pub energy_regime: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftedLyricSegment {
    pub start_ticks: Tick,
    pub end_ticks: Tick,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongStructureReport {
    pub bpm: f32,
    pub beats_per_bar: u32,
    pub beat_ticks: Vec<Tick>,
    pub bar_ticks: Vec<Tick>,
    pub phrase_ticks: Vec<Tick>,
    pub onsets: Vec<OnsetPeak>,
    pub change_points: Vec<LoudnessChangePoint>,
    pub waveform_peaks: Vec<f32>,
    pub integrated_lufs: f32,
    pub drafted_lyrics: Vec<DraftedLyricSegment>,
}

/// Compute multiband spectral flux between consecutive magnitude spectra.
/// Splits bins into Low (sub/kick), Mid (snare/body), and High (hi-hats/transients).
pub fn compute_multiband_spectral_flux(prev_mag: &[f32], curr_mag: &[f32]) -> (f32, f32, f32, f32) {
    let n = prev_mag.len().min(curr_mag.len());
    if n == 0 {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let low_end = (n / 8).max(1);
    let mid_end = (n / 2).max(low_end + 1);

    let mut low_flux = 0.0_f32;
    let mut mid_flux = 0.0_f32;
    let mut high_flux = 0.0_f32;

    for i in 0..n {
        let diff = (curr_mag[i] - prev_mag[i]).max(0.0);
        if i < low_end {
            low_flux += diff * 1.35;
        } else if i < mid_end {
            mid_flux += diff;
        } else {
            high_flux += diff * 0.85;
        }
    }

    let total = (low_flux + mid_flux + high_flux) / (n as f32);
    (low_flux, mid_flux, high_flux, total)
}

/// Estimate tempo in BPM via autocorrelation of the onset strength envelope.
pub fn estimate_tempo_autocorrelation(onset_envelope: &[f32], envelope_fps: f32) -> f32 {
    let min_lag = (envelope_fps * 60.0 / 190.0).round() as usize;
    let max_lag = (envelope_fps * 60.0 / 60.0).round() as usize;

    let mut best_lag = min_lag.max(1);
    let mut best_corr = f32::MIN;

    for lag in min_lag..=max_lag.min(onset_envelope.len() / 2) {
        let mut sum = 0.0_f32;
        for i in 0..(onset_envelope.len() - lag) {
            sum += onset_envelope[i] * onset_envelope[i + lag];
        }
        if sum > best_corr {
            best_corr = sum;
            best_lag = lag;
        }
    }

    (60.0 * envelope_fps) / (best_lag as f32)
}

/// Detect structural change points on a loudness envelope using sliding window energy delta.
pub fn detect_loudness_change_points(
    loudness_frames: &[f32],
    frame_rate_hz: f32,
) -> Vec<LoudnessChangePoint> {
    let mut points = Vec::new();
    let window = (frame_rate_hz * 2.0).round() as usize;
    if loudness_frames.len() < window * 2 || window == 0 {
        return points;
    }

    let mut last_trigger_idx = 0usize;
    for i in window..(loudness_frames.len() - window) {
        let prev_mean: f32 = loudness_frames[(i - window)..i].iter().sum::<f32>() / (window as f32);
        let next_mean: f32 = loudness_frames[i..(i + window)].iter().sum::<f32>() / (window as f32);
        let delta = (next_mean - prev_mean).abs();

        if delta > 0.18 && (i - last_trigger_idx) >= window {
            let sec = (i as f64) / (frame_rate_hz as f64);
            let tick = Tick((sec * (TICKS_PER_SECOND as f64)).round() as i64);
            points.push(LoudnessChangePoint {
                tick,
                label: if next_mean > prev_mean {
                    "Energy Lift / Chorus".to_string()
                } else {
                    "Breakdown / Bridge".to_string()
                },
                energy_regime: next_mean.clamp(0.0, 1.0),
            });
            last_trigger_idx = i;
        }
    }
    points
}

/// Generate synthetic click-train signal at a known BPM for self-describing verification tests (Section 8.1 & 16).
pub fn generate_synthetic_click_envelope(
    target_bpm: f32,
    duration_sec: f32,
    envelope_fps: f32,
) -> Vec<f32> {
    let total_frames = (duration_sec * envelope_fps) as usize;
    let mut env = vec![0.0_f32; total_frames];
    let period_frames = (envelope_fps * 60.0 / target_bpm).round() as usize;

    for idx in (0..total_frames).step_by(period_frames.max(1)) {
        env[idx] = 1.0;
        if idx + 1 < total_frames {
            env[idx + 1] = 0.35;
        }
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_train_120_bpm_measures_within_one_bpm() {
        let env = generate_synthetic_click_envelope(120.0, 12.0, 200.0);
        let measured = estimate_tempo_autocorrelation(&env, 200.0);
        assert!(
            (measured - 120.0).abs() <= 1.0,
            "Expected 120.0 BPM +/- 1.0, got {}",
            measured
        );
    }
}
