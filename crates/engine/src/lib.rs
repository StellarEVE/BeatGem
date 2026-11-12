//! beatgem-engine: Deterministic Montage Planner, wrapper settings, and staged refinement pipeline.
//! Section 7, 8.3 & 9:
//! - Same project snapshot + analysis + settings + seed = exact same timeline cut byte-for-byte.
//! - Breadth before depth: Stage 1 covers every video before Stage 2 begins on any of them.
//! - Pinned clips are inputs, not obstacles: refined results carry pinned clips byte-for-byte.

use beatgem_core::{TimelineItem, Tick};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlacementMode {
    WindowedProportionalWalk,
    EvenlySpacedWindows,
}

/// Section 9: Planner owns a wrapper settings type rather than quietly growing the core type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerWrapperSettings {
    pub clip_variance: f32,
    pub source_reuse_protection: f32,
    pub spread: f32,
    pub continue_start_points: bool,
    pub placement_mode: PlacementMode,
    pub min_clip_ticks: Tick,
    pub max_clip_ticks: Tick,
    pub cut_offset_ticks: Tick,
    pub snap_to_scenes: bool,
    pub snap_to_black_edges: bool,
    pub beats_per_bar: u32,
    pub seed: u64,
}

/// Deterministic SplitMix64 PRNG so generation is reproducible across platforms byte-for-byte.
#[derive(Debug, Clone)]
pub struct DeterministicRng {
    state: u64,
}

impl DeterministicRng {
    pub const fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn next_f32(&mut self) -> f32 {
        ((self.next_u64() >> 40) as u32 as f32) / (16_777_216.0_f32)
    }
}

/// Section 8.3: Refinement Contract.
/// Merges Stage 2 refined candidates while preserving every pinned clip byte-for-byte.
pub fn merge_refined_cut_preserving_pinned(
    existing_items: &[TimelineItem],
    refined_candidates: Vec<TimelineItem>,
) -> Vec<TimelineItem> {
    let mut output: Vec<TimelineItem> = existing_items
        .iter()
        .filter(|item| item.pinned)
        .cloned()
        .collect();

    for cand in refined_candidates {
        let cand_end = cand.start_ticks.0 + cand.duration_ticks.0;
        let overlaps_pinned = output.iter().any(|p| {
            let p_end = p.start_ticks.0 + p.duration_ticks.0;
            cand.start_ticks.0 < p_end && cand_end > p.start_ticks.0
        });
        if !overlaps_pinned {
            output.push(cand);
        }
    }

    output.sort_by_key(|i| i.start_ticks.0);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use beatgem_core::ClipTransform;

    #[test]
    fn planner_rng_is_strictly_deterministic_and_pinned_clips_survive_refinement_byte_exact() {
        let mut rng_a = DeterministicRng::new(133742);
        let mut rng_b = DeterministicRng::new(133742);
        for _ in 0..32 {
            assert_eq!(rng_a.next_u64(), rng_b.next_u64());
        }

        let pinned_clip = TimelineItem {
            id: "pinned_user_clip".to_string(),
            asset_id: "vid_1".to_string(),
            start_ticks: Tick(1000),
            duration_ticks: Tick(500),
            source_in_ticks: Tick(250),
            pinned: true,
            provisional: false,
            enabled: true,
            transform: ClipTransform::default(),
            transition_in: "Crash Zoom".to_string(),
            effect_canonical_desc: "fx:none".to_string(),
        };

        let refined_candidate = TimelineItem {
            id: "refined_cand".to_string(),
            asset_id: "vid_2".to_string(),
            start_ticks: Tick(1000),
            duration_ticks: Tick(500),
            source_in_ticks: Tick(0),
            pinned: false,
            provisional: false,
            enabled: true,
            transform: ClipTransform::default(),
            transition_in: "Hard Cut".to_string(),
            effect_canonical_desc: "fx:none".to_string(),
        };

        let merged = merge_refined_cut_preserving_pinned(
            std::slice::from_ref(&pinned_clip),
            vec![refined_candidate],
        );
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0], pinned_clip);
    }
}
