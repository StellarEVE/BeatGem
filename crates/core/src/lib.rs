//! beatgem-core: Timeline model, fixed integer tick time, commands, invariants, and atomic persistence.
//! Section 11.2: Nothing in Core knows about codecs, graphics, or interface toolkits.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;
use thiserror::Error;

/// Exact integer tick rate: 254,016,000,000 ticks per second.
/// Divides evenly by every common video frame rate (23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120)
/// and by both 44,100 Hz and 48,000 Hz audio. Floating-point seconds are banned from positions and durations.
pub const TICKS_PER_SECOND: i64 = 254_016_000_000;
pub const TICKS_PER_MILLISECOND: i64 = 254_016_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Tick(pub i64);

impl Tick {
    pub const ZERO: Self = Self(0);

    pub const fn from_seconds_rational(num: i64, den: i64) -> Self {
        Self((num * TICKS_PER_SECOND) / den)
    }

    pub const fn from_frames(frames: i64, fps: u32) -> Self {
        let ticks_per_frame = TICKS_PER_SECOND / (fps as i64);
        Self(frames * ticks_per_frame)
    }

    pub const fn from_audio_samples(samples: i64, sample_rate_hz: u32) -> Self {
        let ticks_per_sample = TICKS_PER_SECOND / (sample_rate_hz as i64);
        Self(samples * ticks_per_sample)
    }

    pub const fn checked_add(self, rhs: Self) -> Option<Self> {
        match self.0.checked_add(rhs.0) {
            Some(v) => Some(Self(v)),
            None => None,
        }
    }

    pub const fn checked_sub(self, rhs: Self) -> Option<Self> {
        match self.0.checked_sub(rhs.0) {
            Some(v) => Some(Self(v)),
            None => None,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvariantError {
    #[error("Duplicate item identifier: {0}")]
    DuplicateItemId(String),
    #[error("Non-positive duration ({1} ticks) on item {0}")]
    NonPositiveDuration(String, i64),
    #[error("Negative start position ({1} ticks) on item {0}")]
    NegativeStartTick(String, i64),
    #[error("Overlapping or unsorted items on track {track}: {item_a} ends at {end_a} > {item_b} start {start_b}")]
    TrackOverlap {
        track: String,
        item_a: String,
        end_a: i64,
        item_b: String,
        start_b: i64,
    },
    #[error("Item {item_id} references unknown asset {asset_id}")]
    UnknownAsset { item_id: String, asset_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AssetRecord {
    pub id: String,
    pub name: String,
    pub path_hint: String,
    pub content_fingerprint: String,
    pub duration_ticks: Tick,
    pub intro_trim_ticks: Tick,
    pub outro_trim_ticks: Tick,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClipTransform {
    pub position_x: f32,
    pub position_y: f32,
    pub scale_pct: f32,
    pub rotation_deg: f32,
    pub anchor_x: f32,
    pub anchor_y: f32,
}

impl Default for ClipTransform {
    fn default() -> Self {
        Self {
            position_x: 0.0,
            position_y: 0.0,
            scale_pct: 100.0,
            rotation_deg: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimelineItem {
    pub id: String,
    pub asset_id: String,
    pub start_ticks: Tick,
    pub duration_ticks: Tick,
    pub source_in_ticks: Tick,
    pub pinned: bool,
    pub provisional: bool,
    pub enabled: bool,
    pub transform: ClipTransform,
    pub transition_in: String,
    pub effect_canonical_desc: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrackKind {
    Video,
    Overlay,
    Adjustment,
    Text,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub kind: TrackKind,
    pub muted: bool,
    pub locked: bool,
    pub items: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimelineMarker {
    pub id: String,
    pub name: String,
    pub color_hex: String,
    pub start_ticks: Tick,
    pub duration_ticks: Tick,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectDocument {
    pub schema_version: u32,
    pub project_name: String,
    pub assets: Vec<AssetRecord>,
    pub selected_song_ids: Vec<String>,
    pub tracks: Vec<Track>,
    pub markers: Vec<TimelineMarker>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EngineCommand {
    ImportAsset(AssetRecord),
    SetAssetTrims {
        asset_id: String,
        intro_trim_ticks: Tick,
        outro_trim_ticks: Tick,
    },
    RelinkAssetByFingerprint {
        content_fingerprint: String,
        new_path_hint: String,
    },
    TogglePinItem {
        item_id: String,
    },
    MoveItem {
        item_id: String,
        new_start_ticks: Tick,
    },
    SplitItem {
        item_id: String,
        split_tick: Tick,
        right_item_id: String,
    },
    ApplyPlannerCut {
        track_id: String,
        candidates: Vec<TimelineItem>,
    },
}

impl ProjectDocument {
    pub const CURRENT_SCHEMA_VERSION: u32 = 1;

    /// Forward schema migration chain so older projects open cleanly forever (Section 12).
    pub fn migrate_to_current(mut self) -> Self {
        if self.schema_version < Self::CURRENT_SCHEMA_VERSION {
            self.schema_version = Self::CURRENT_SCHEMA_VERSION;
        }
        self
    }

    /// Section 12: Enforce all model invariants before any command commits.
    pub fn validate_invariants(&self) -> Result<(), InvariantError> {
        let known_assets: HashSet<&str> = self.assets.iter().map(|a| a.id.as_str()).collect();
        let mut seen_ids: HashSet<&str> = HashSet::new();

        for track in &self.tracks {
            let mut prev_end: Option<(&str, i64)> = None;
            for item in &track.items {
                if !seen_ids.insert(item.id.as_str()) {
                    return Err(InvariantError::DuplicateItemId(item.id.clone()));
                }
                if item.duration_ticks.0 <= 0 {
                    return Err(InvariantError::NonPositiveDuration(
                        item.id.clone(),
                        item.duration_ticks.0,
                    ));
                }
                if item.start_ticks.0 < 0 {
                    return Err(InvariantError::NegativeStartTick(
                        item.id.clone(),
                        item.start_ticks.0,
                    ));
                }
                if item.asset_id != "__text__"
                    && item.asset_id != "__adj__"
                    && !known_assets.contains(item.asset_id.as_str())
                {
                    return Err(InvariantError::UnknownAsset {
                        item_id: item.id.clone(),
                        asset_id: item.asset_id.clone(),
                    });
                }
                if let Some((prev_id, end_tick)) = prev_end {
                    if item.start_ticks.0 < end_tick {
                        return Err(InvariantError::TrackOverlap {
                            track: track.name.clone(),
                            item_a: prev_id.to_string(),
                            end_a: end_tick,
                            item_b: item.id.clone(),
                            start_b: item.start_ticks.0,
                        });
                    }
                }
                prev_end = Some((item.id.as_str(), item.start_ticks.0 + item.duration_ticks.0));
            }
        }
        Ok(())
    }

    /// Section 11.3: Transactional command path: clone -> apply -> validate -> commit.
    pub fn apply_command(&self, cmd: EngineCommand) -> Result<Self, InvariantError> {
        let mut next = self.clone();

        match cmd {
            EngineCommand::ImportAsset(record) => {
                if !next.assets.iter().any(|a| a.id == record.id) {
                    next.assets.push(record);
                }
            }
            EngineCommand::SetAssetTrims {
                asset_id,
                intro_trim_ticks,
                outro_trim_ticks,
            } => {
                if let Some(asset) = next.assets.iter_mut().find(|a| a.id == asset_id) {
                    asset.intro_trim_ticks = Tick(intro_trim_ticks.0.max(0));
                    asset.outro_trim_ticks = Tick(outro_trim_ticks.0.max(0));
                }
            }
            EngineCommand::RelinkAssetByFingerprint {
                content_fingerprint,
                new_path_hint,
            } => {
                for asset in &mut next.assets {
                    if asset.content_fingerprint == content_fingerprint {
                        asset.path_hint = new_path_hint.clone();
                    }
                }
            }
            EngineCommand::TogglePinItem { item_id } => {
                for track in &mut next.tracks {
                    if let Some(item) = track.items.iter_mut().find(|i| i.id == item_id) {
                        item.pinned = !item.pinned;
                        if item.pinned {
                            item.provisional = false;
                        }
                    }
                }
            }
            EngineCommand::MoveItem {
                item_id,
                new_start_ticks,
            } => {
                for track in &mut next.tracks {
                    if track.locked {
                        continue;
                    }
                    if let Some(item) = track.items.iter_mut().find(|i| i.id == item_id) {
                        item.start_ticks = new_start_ticks;
                        item.pinned = true;
                        item.provisional = false;
                        track.items.sort_by_key(|i| i.start_ticks.0);
                        break;
                    }
                }
            }
            EngineCommand::SplitItem {
                item_id,
                split_tick,
                right_item_id,
            } => {
                for track in &mut next.tracks {
                    if track.locked {
                        continue;
                    }
                    if let Some(idx) = track.items.iter().position(|i| i.id == item_id) {
                        let left_dur = split_tick.0 - track.items[idx].start_ticks.0;
                        let right_dur = track.items[idx].duration_ticks.0 - left_dur;
                        if left_dur > 0 && right_dur > 0 {
                            let mut right_clone = track.items[idx].clone();
                            track.items[idx].duration_ticks = Tick(left_dur);
                            track.items[idx].pinned = true;
                            track.items[idx].provisional = false;

                            right_clone.id = right_item_id;
                            right_clone.start_ticks = split_tick;
                            right_clone.duration_ticks = Tick(right_dur);
                            right_clone.source_in_ticks =
                                Tick(right_clone.source_in_ticks.0 + left_dur);
                            right_clone.pinned = true;
                            right_clone.provisional = false;
                            track.items.insert(idx + 1, right_clone);
                        }
                        break;
                    }
                }
            }
            EngineCommand::ApplyPlannerCut {
                track_id,
                candidates,
            } => {
                if let Some(track) = next.tracks.iter_mut().find(|t| t.id == track_id && !t.locked)
                {
                    let mut merged: Vec<TimelineItem> =
                        track.items.iter().filter(|i| i.pinned).cloned().collect();
                    for cand in candidates {
                        let cand_end = cand.start_ticks.0 + cand.duration_ticks.0;
                        let overlaps_pinned = merged.iter().any(|p| {
                            let p_end = p.start_ticks.0 + p.duration_ticks.0;
                            cand.start_ticks.0 < p_end && cand_end > p.start_ticks.0
                        });
                        if !overlaps_pinned {
                            merged.push(cand);
                        }
                    }
                    merged.sort_by_key(|i| i.start_ticks.0);
                    track.items = merged;
                }
            }
        }

        next.validate_invariants()?;
        Ok(next)
    }

    /// Section 3 & 12: Atomic save with .bak backup beside the project file.
    pub fn save_atomic(&self, target_path: &Path) -> std::io::Result<()> {
        self.validate_invariants()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;

        let tmp_path = target_path.with_extension("beatgem.tmp");
        let bak_path = target_path.with_extension("beatgem.bak");
        let serialized = serde_json::to_string_pretty(self)?;

        {
            let mut file = fs::File::create(&tmp_path)?;
            file.write_all(serialized.as_bytes())?;
            file.sync_all()?;
        }

        if target_path.exists() {
            let _ = fs::copy(target_path, &bak_path);
        }
        fs::rename(&tmp_path, target_path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_rate_divides_common_frame_and_sample_rates_evenly() {
        for fps in [24_i64, 25, 30, 50, 60, 120] {
            assert_eq!(TICKS_PER_SECOND % fps, 0, "Tick rate must divide {} fps", fps);
        }
        for sr in [44_100_i64, 48_000] {
            assert_eq!(TICKS_PER_SECOND % sr, 0, "Tick rate must divide {} Hz", sr);
        }
    }
}
