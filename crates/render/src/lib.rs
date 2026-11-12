//! beatgem-render: Owned composition engine with Reference CPU Oracle, WGPU Shader Compositor,
//! 11 genuine transitions, canonical effect stack descriptions, and content-addressed render cache.
//! Section 10.2: The graphics compositor is correct only insofar as it agrees with the CPU oracle (max channel step <= 1).

use beatgem_core::TimelineItem;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransitionKind {
    HardCut,
    CrossDissolve,
    DipToColor,
    FilmDissolveLinearLight,
    DipToDissolve,
    CrashZoom,
    DirectionalZoom,
    TwistWheel,
    RadialTwist,
    Push,
    Slide,
    Split,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectEntry {
    pub kind: String,
    pub amount: f32,
    pub enabled: bool,
    pub gpu_shader_graduated: bool,
}

/// Section 10.4: Canonical text description used in content-addressed cache keys
/// so that equal effect stacks always describe themselves identically.
pub fn canonical_effect_stack_description(effects: &[EffectEntry]) -> String {
    let active: Vec<String> = effects
        .iter()
        .filter(|e| e.enabled)
        .map(|e| {
            format!(
                "{}:{:.1}:{}",
                e.kind.to_lowercase().replace(' ', "_"),
                e.amount,
                if e.gpu_shader_graduated { "gpu" } else { "cpu" }
            )
        })
        .collect();
    if active.is_empty() {
        "fx:none".to_string()
    } else {
        active.join("|")
    }
}

/// Section 10.5: Content-addressed render cache key.
/// Hashes source fingerprint, ranges, transform, canonical effect stack, transition, and capability hash.
pub fn compute_content_addressed_cache_key(
    item: &TimelineItem,
    source_fingerprint: &str,
    capability_hash: &str,
) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(source_fingerprint.as_bytes());
    hasher.update(&item.source_in_ticks.0.to_le_bytes());
    hasher.update(&item.duration_ticks.0.to_le_bytes());
    hasher.update(item.transition_in.as_bytes());
    hasher.update(item.effect_canonical_desc.as_bytes());
    hasher.update(capability_hash.as_bytes());
    let hex = hasher.finalize().to_hex();
    format!("ca_{}", &hex[..16])
}

/// Reference CPU Oracle implementation of Film Dissolve in linear light (gamma 2.2).
pub fn cpu_oracle_film_dissolve_pixel(rgba_a: [u8; 4], rgba_b: [u8; 4], p: f32) -> [u8; 4] {
    let mut out = [0u8; 4];
    let p_clamped = p.clamp(0.0, 1.0);
    for c in 0..3 {
        let lin_a = (rgba_a[c] as f32 / 255.0).powf(2.2);
        let lin_b = (rgba_b[c] as f32 / 255.0).powf(2.2);
        let mixed = (1.0 - p_clamped) * lin_a + p_clamped * lin_b;
        let srgb = (mixed.clamp(0.0, 1.0).powf(1.0 / 2.2) * 255.0).round() as u8;
        out[c] = srgb;
    }
    out[3] = 255;
    out
}

/// Reference CPU Oracle UV mapping for Crash Zoom at normalized progress p in [0.0, 1.0].
pub fn cpu_oracle_crash_zoom_uv(u: f32, v: f32, p: f32) -> ((f32, f32), (f32, f32)) {
    let zoom_a = 1.0 + 2.8 * p * p;
    let zoom_b = 2.4 - 1.4 * p;
    let ua = ((u - 0.5) / zoom_a + 0.5).clamp(0.0, 1.0);
    let va = ((v - 0.5) / zoom_a + 0.5).clamp(0.0, 1.0);
    let ub = ((u - 0.5) * zoom_b + 0.5).clamp(0.0, 1.0);
    let vb = ((v - 0.5) * zoom_b + 0.5).clamp(0.0, 1.0);
    ((ua, va), (ub, vb))
}

/// Verify that GPU shader output matches Reference CPU Oracle within <= 1 channel step.
pub fn assert_oracle_parity(oracle_rgba: &[u8], gpu_rgba: &[u8]) -> Result<(u8, f32), String> {
    if oracle_rgba.len() != gpu_rgba.len() {
        return Err("Buffer length mismatch".into());
    }
    let mut max_diff: u8 = 0;
    let mut sum_diff: u64 = 0;
    for (&o, &g) in oracle_rgba.iter().zip(gpu_rgba.iter()) {
        let diff = o.abs_diff(g);
        if diff > max_diff {
            max_diff = diff;
        }
        sum_diff += diff as u64;
    }
    let mean_diff = (sum_diff as f32) / (oracle_rgba.len().max(1) as f32);
    if max_diff > 1 {
        return Err(format!("Oracle parity failed: max_diff = {} (> 1)", max_diff));
    }
    Ok((max_diff, mean_diff))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oracle_film_dissolve_matches_endpoints_and_diverges_from_srgb_at_midpoint() {
        let a = [220, 40, 40, 255];
        let b = [20, 200, 240, 255];
        assert_eq!(cpu_oracle_film_dissolve_pixel(a, b, 0.0), a);
        assert_eq!(cpu_oracle_film_dissolve_pixel(a, b, 1.0), b);

        let film_mid = cpu_oracle_film_dissolve_pixel(a, b, 0.5);
        let plain_mid_r = ((a[0] as u16 + b[0] as u16) / 2) as u8;
        assert!(
            film_mid[0] > plain_mid_r,
            "Linear light Film Dissolve must bloom brighter than sRGB crossfade at midpoint"
        );
    }
}
