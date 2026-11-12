import {
  TICKS_PER_SECOND,
  Tick,
  secondsToTicks,
  snapTicksToFrame,
} from './ticks';
import {
  CapabilityReport,
  ClipTransform,
  EffectInstance,
  ExportSettings,
  Keyframe,
  MediaAsset,
  OpenDecisionsState,
  PlannerSettings,
  ProjectState,
  ShortcutProfile,
  SongAnalysis,
  TimelineItem,
  TimelineMarker,
  Track,
  TrackKind,
  TransitionKind,
  TransitionSpec,
} from './types';

/**
 * Deterministic 32-bit FNV-1a hash formatted as 16-char hex content key
 */
export function fnv1aHash(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x45d9f3b;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `ca_${hex1}${hex2}`;
}

/**
 * Section 10.4: Canonical text description of an effect stack so equal stacks always describe themselves identically.
 */
export function canonicalEffectStackDescription(effects: EffectInstance[]): string {
  const active = effects.filter((e) => e.enabled);
  if (active.length === 0) return 'fx:none';
  return active
    .map(
      (e) =>
        `${e.kind.toLowerCase().replace(/\s+/g, '_')}:${e.amount.toFixed(1)}:${e.secondaryParam ?? 'std'}:${
          e.gpuAccelerated ? 'gpu' : 'cpu'
        }`
    )
    .join('|');
}

/**
 * Section 10.5: Content-addressed render cache key.
 * Hash of source identity, ranges, properties, keyframes, effect stack description, transition kind, and capability report.
 */
export function computeItemCacheKey(
  item: Omit<TimelineItem, 'cacheKey' | 'cacheStatus'>,
  assetFingerprint: string,
  capabilityHash: string
): string {
  const t = item.transform;
  const transformDesc = `tx:${t.positionX},${t.positionY},sc:${t.scale},rot:${t.rotation},anc:${t.anchorX},${t.anchorY},crop:${t.cropTop},${t.cropBottom},${t.cropLeft},${t.cropRight}`;
  const fxDesc = canonicalEffectStackDescription(item.effects);
  const kfDesc = item.keyframes
    .slice()
    .sort((a, b) => Number(a.offsetTicks - b.offsetTicks))
    .map((k) => `${k.property}@${k.offsetTicks.toString()}=${k.value.toFixed(2)}(${k.interpolation})`)
    .join(';');
  const transDesc = `${item.transitionIn.kind}:${item.transitionIn.durationTicks.toString()}:${
    item.transitionIn.dipColor ?? 'none'
  }`;
  const textDesc = item.textPayload
    ? `${item.textPayload.text}|${item.textPayload.fontSize}|${item.textPayload.color}|${item.textPayload.style}`
    : '';
  const payload = [
    assetFingerprint,
    item.sourceInTicks.toString(),
    item.durationTicks.toString(),
    item.speed.toFixed(3),
    item.opacity.toFixed(1),
    item.fitMode,
    item.blendMode,
    item.freezeFrameTicks?.toString() ?? 'live',
    transformDesc,
    fxDesc,
    kfDesc,
    transDesc,
    textDesc,
    capabilityHash,
  ].join('||');
  return fnv1aHash(payload);
}

/**
 * Section 12: Content fingerprint from file size + sampled bytes from head, middle, and tail.
 */
export async function computeFileFingerprint(file: File): Promise<string> {
  const size = file.size;
  const sampleSize = Math.min(256, size);
  const readSlice = async (start: number, len: number) => {
    if (len <= 0) return '';
    const buf = await file.slice(start, start + len).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let acc = '';
    for (let i = 0; i < bytes.length; i += 8) {
      acc += bytes[i].toString(16).padStart(2, '0');
    }
    return acc;
  };
  const head = await readSlice(0, sampleSize);
  const mid = await readSlice(Math.floor(size / 2), sampleSize);
  const tail = await readSlice(Math.max(0, size - sampleSize), sampleSize);
  return `fp_${size}_${fnv1aHash(`${size}:${head}:${mid}:${tail}`).slice(3, 15)}`;
}

/**
 * Section 12: Model Invariants Validation.
 * Enforces:
 * 1. Item identifiers are unique across all tracks.
 * 2. Items on a track are sorted by startTicks and never overlapping.
 * 3. Every item duration is strictly positive (durationTicks > 0n).
 * 4. Every media item points at a known asset in project.assets.
 */
export interface InvariantValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProjectInvariants(state: ProjectState): InvariantValidationResult {
  const errors: string[] = [];
  const seenItemIds = new Set<string>();
  const knownAssetIds = new Set(state.assets.map((a) => a.id));
  knownAssetIds.add('__text__');
  knownAssetIds.add('__adj__');

  for (const track of state.tracks) {
    let prevEnd: Tick = -1n;
    for (let i = 0; i < track.items.length; i++) {
      const item = track.items[i];
      if (seenItemIds.has(item.id)) {
        errors.push(`Invariant violation: Duplicate item ID "${item.id}" on track "${track.name}".`);
      }
      seenItemIds.add(item.id);

      if (item.durationTicks <= 0n) {
        errors.push(`Invariant violation: Item "${item.name}" (${item.id}) has non-positive duration (${item.durationTicks} ticks).`);
      }

      if (item.startTicks < 0n) {
        errors.push(`Invariant violation: Item "${item.name}" has negative start position (${item.startTicks} ticks).`);
      }

      if (!knownAssetIds.has(item.assetId)) {
        errors.push(`Invariant violation: Item "${item.name}" references unknown asset ID "${item.assetId}".`);
      }

      if (prevEnd !== -1n && item.startTicks < prevEnd) {
        errors.push(
          `Invariant violation: Track "${track.name}" has overlapping or unsorted items at "${item.name}" (starts at ${item.startTicks} before previous end ${prevEnd}).`
        );
      }
      prevEnd = item.startTicks + item.durationTicks;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Recompute content-addressed cache keys for all items in a project state.
 * Undoing an edit restores the earlier cached state automatically if its key is in knownRenderCacheKeys.
 */
export function refreshProjectCacheKeys(state: ProjectState): ProjectState {
  const assetMap = new Map(state.assets.map((a) => [a.id, a]));
  const capHash = state.capabilityReport.capabilityHash;

  const updatedTracks = state.tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      const asset = assetMap.get(item.assetId);
      const fp = asset ? asset.fingerprint : item.assetId;
      const key = computeItemCacheKey(item, fp, capHash);
      const isKnownReady = Boolean(state.knownRenderCacheKeys[key]);
      return {
        ...item,
        cacheKey: key,
        cacheStatus: isKnownReady ? ('ready' as const) : ('pending' as const),
      };
    }),
  }));

  return {
    ...state,
    tracks: updatedTracks,
  };
}

export function defaultClipTransform(): ClipTransform {
  return {
    positionX: 0,
    positionY: 0,
    scale: 100,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    cropTop: 0,
    cropBottom: 0,
    cropLeft: 0,
    cropRight: 0,
  };
}

/**
 * Typed Engine Commands (Section 11.3: Every user action and planner action is a command value)
 */
export type EngineCommand =
  | { type: 'IMPORT_ASSETS'; assets: MediaAsset[] }
  | { type: 'REMOVE_ASSET'; assetId: string }
  | { type: 'SET_ASSET_TRIMS'; assetId: string; introTrimTicks: Tick; outroTrimTicks: Tick }
  | { type: 'TOGGLE_ASSET_MISSING'; assetId: string; missing: boolean }
  | { type: 'RELINK_ASSET_BY_FINGERPRINT'; fingerprint: string; newPathHint: string; newName?: string }
  | { type: 'SELECT_SONGS'; songAssetIds: string[] }
  | { type: 'SET_SONG_ANALYSIS'; analysis: SongAnalysis }
  | {
      type: 'UPDATE_ASSET_ANALYSIS';
      assetId: string;
      stage: 0 | 1 | 2;
      stage1Progress: number;
      stage2Progress: number;
      scenes?: MediaAsset['scenes'];
      blackRanges?: MediaAsset['blackRanges'];
      motionCurve?: MediaAsset['motionCurve'];
      bestMoments?: MediaAsset['bestMoments'];
    }
  | { type: 'CANCEL_ASSET_ANALYSIS'; assetId: string }
  | { type: 'UPDATE_PLANNER_SETTINGS'; settings: Partial<PlannerSettings> }
  | { type: 'APPLY_PLANNER_CUT'; items: TimelineItem[]; isRefinement: boolean }
  | { type: 'TOGGLE_PIN_ITEM'; itemId: string }
  | { type: 'MOVE_ITEM'; itemId: string; newStartTicks: Tick }
  | { type: 'TRIM_ITEM'; itemId: string; newStartTicks: Tick; newDurationTicks: Tick; newSourceInTicks: Tick }
  | { type: 'SPLIT_ITEM'; itemId: string; splitTick: Tick }
  | { type: 'SWAP_ITEM_SOURCE'; itemId: string; newAssetId: string }
  | { type: 'SWAP_ITEM_POSITIONS'; itemAId: string; itemBId: string }
  | { type: 'DELETE_ITEM'; itemId: string; ripple: boolean }
  | { type: 'TOGGLE_ENABLE_ITEM'; itemId: string }
  | { type: 'SET_FREEZE_FRAME'; itemId: string; freezeTickOffset: Tick | null }
  | { type: 'UPDATE_ITEM_TRANSFORM'; itemId: string; transform: Partial<ClipTransform>; speed?: number; volumeDb?: number; opacity?: number }
  | { type: 'SET_ITEM_TRANSITION'; itemId: string; transition: TransitionSpec }
  | { type: 'ADD_ITEM_EFFECT'; itemId: string; effect: EffectInstance }
  | { type: 'UPDATE_ITEM_EFFECT'; itemId: string; effectId: string; updates: Partial<EffectInstance> }
  | { type: 'REMOVE_ITEM_EFFECT'; itemId: string; effectId: string }
  | { type: 'UPSERT_KEYFRAME'; itemId: string; keyframe: Keyframe }
  | { type: 'REMOVE_KEYFRAME'; itemId: string; keyframeId: string }
  | { type: 'ADD_TRACK'; kind: TrackKind; name: string }
  | { type: 'TOGGLE_TRACK_STATE'; trackId: string; field: 'muted' | 'locked' | 'solo' }
  | { type: 'ADD_TEXT_ITEM'; trackId: string; startTicks: Tick; durationTicks: Tick; text: string; style: 'title' | 'caption' | 'kinetic' }
  | { type: 'DRAFT_LYRIC_CAPTIONS'; lyrics: SongAnalysis['draftedLyrics'] }
  | { type: 'NORMALIZE_CLIP_AUDIO' }
  | { type: 'ADD_MARKER'; marker: TimelineMarker }
  | { type: 'REMOVE_MARKER'; markerId: string }
  | { type: 'MARK_CACHE_KEYS_READY'; keys: string[] }
  | { type: 'PURGE_DERIVED_CACHE' }
  | { type: 'UPDATE_EXPORT_SETTINGS'; settings: Partial<ExportSettings> }
  | { type: 'UPDATE_OPEN_DECISIONS'; updates: Partial<OpenDecisionsState> }
  | { type: 'EXTRACT_CUT_TEMPLATE'; name: string };

/**
 * Deep clone ProjectState supporting BigInt values cleanly.
 */
export function cloneProjectState(state: ProjectState): ProjectState {
  return structuredClone(state);
}

/**
 * Apply an EngineCommand via clone -> apply -> validate -> commit.
 */
export function executeEngineCommand(
  currentState: ProjectState,
  command: EngineCommand
): { nextState: ProjectState; validation: InvariantValidationResult; commandDescription: string } {
  const draft = cloneProjectState(currentState);
  let desc: string = command.type;

  switch (command.type) {
    case 'IMPORT_ASSETS': {
      const existingIds = new Set(draft.assets.map((a) => a.id));
      for (const asset of command.assets) {
        if (!existingIds.has(asset.id)) {
          draft.assets.push(asset);
        }
      }
      if (draft.selectedSongAssetIds.length === 0) {
        const firstSong = draft.assets.find((a) => a.kind === 'audio');
        if (firstSong) draft.selectedSongAssetIds = [firstSong.id];
      }
      desc = `Import ${command.assets.length} media asset(s)`;
      break;
    }

    case 'REMOVE_ASSET': {
      draft.assets = draft.assets.filter((a) => a.id !== command.assetId);
      draft.selectedSongAssetIds = draft.selectedSongAssetIds.filter((id) => id !== command.assetId);
      for (const track of draft.tracks) {
        track.items = track.items.filter((i) => i.assetId !== command.assetId);
      }
      desc = `Remove asset ${command.assetId}`;
      break;
    }

    case 'SET_ASSET_TRIMS': {
      const asset = draft.assets.find((a) => a.id === command.assetId);
      if (asset) {
        const maxIntro = asset.probe.durationTicks - command.outroTrimTicks - TICKS_PER_SECOND / 2n;
        asset.introTrimTicks = command.introTrimTicks < 0n ? 0n : command.introTrimTicks > maxIntro ? maxIntro : command.introTrimTicks;
        asset.outroTrimTicks = command.outroTrimTicks < 0n ? 0n : command.outroTrimTicks;
        desc = `Set intro/outro trims on ${asset.name}`;
      }
      break;
    }

    case 'TOGGLE_ASSET_MISSING': {
      const asset = draft.assets.find((a) => a.id === command.assetId);
      if (asset) {
        asset.missing = command.missing;
        desc = `${command.missing ? 'Simulate moved file' : 'Restore file'} for ${asset.name}`;
      }
      break;
    }

    case 'RELINK_ASSET_BY_FINGERPRINT': {
      const asset = draft.assets.find((a) => a.fingerprint === command.fingerprint);
      if (asset) {
        asset.missing = false;
        asset.pathHint = command.newPathHint;
        if (command.newName) asset.name = command.newName;
        desc = `Relinked ${asset.name} by content fingerprint ${command.fingerprint}`;
      }
      break;
    }

    case 'SELECT_SONGS': {
      draft.selectedSongAssetIds = command.songAssetIds;
      desc = `Select ${command.songAssetIds.length} song(s) for beat timeline`;
      break;
    }

    case 'SET_SONG_ANALYSIS': {
      draft.songAnalysis = command.analysis;
      desc = `Analyze song structure (${command.analysis.bpm.toFixed(1)} BPM)`;
      break;
    }

    case 'UPDATE_ASSET_ANALYSIS': {
      const asset = draft.assets.find((a) => a.id === command.assetId);
      if (asset && !asset.cancelled) {
        asset.analysisStage = command.stage;
        asset.stage1Progress = command.stage1Progress;
        asset.stage2Progress = command.stage2Progress;
        if (command.scenes) asset.scenes = command.scenes;
        if (command.blackRanges) asset.blackRanges = command.blackRanges;
        if (command.motionCurve) asset.motionCurve = command.motionCurve;
        if (command.bestMoments) asset.bestMoments = command.bestMoments;
        desc = `Update analysis Stage ${command.stage} for ${asset.name}`;
      }
      break;
    }

    case 'CANCEL_ASSET_ANALYSIS': {
      const asset = draft.assets.find((a) => a.id === command.assetId);
      if (asset) {
        asset.cancelled = true;
        desc = `Cancel analysis for ${asset.name}`;
      }
      break;
    }

    case 'UPDATE_PLANNER_SETTINGS': {
      draft.plannerSettings = {
        ...draft.plannerSettings,
        ...command.settings,
      };
      desc = `Update planner generation controls`;
      break;
    }

    case 'APPLY_PLANNER_CUT': {
      const videoTrack = draft.tracks.find((t) => t.kind === 'video');
      if (videoTrack && !videoTrack.locked) {
        // Section 8.3: Refinement contract - Pinned clips survive regeneration byte-for-byte!
        const pinnedItems = videoTrack.items.filter((i) => i.pinned);
        const merged: TimelineItem[] = [...pinnedItems];

        for (const candidate of command.items) {
          // Check if candidate overlaps any pinned item
          const candEnd = candidate.startTicks + candidate.durationTicks;
          const overlapsPinned = merged.some((p) => {
            const pEnd = p.startTicks + p.durationTicks;
            return candidate.startTicks < pEnd && candEnd > p.startTicks;
          });
          if (!overlapsPinned) {
            merged.push(candidate);
          }
        }

        merged.sort((a, b) => (a.startTicks < b.startTicks ? -1 : a.startTicks > b.startTicks ? 1 : 0));
        videoTrack.items = merged;
        desc = command.isRefinement
          ? `Refine cut with Stage 2 exact frames (${pinnedItems.length} pinned preserved)`
          : `Generate beat-synced cut (seed ${draft.plannerSettings.seed})`;
      }
      break;
    }

    case 'TOGGLE_PIN_ITEM': {
      for (const track of draft.tracks) {
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.pinned = !item.pinned;
          if (item.pinned) item.provisional = false;
          desc = `${item.pinned ? 'Pin' : 'Unpin'} clip "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'MOVE_ITEM': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const idx = track.items.findIndex((i) => i.id === command.itemId);
        if (idx !== -1) {
          const item = track.items[idx];
          const targetStart = command.newStartTicks < 0n ? 0n : snapTicksToFrame(command.newStartTicks, 30);
          item.startTicks = targetStart;
          item.pinned = true; // User touched it -> pinned per Section 3 & 8.3
          item.provisional = false;
          track.items.sort((a, b) => (a.startTicks < b.startTicks ? -1 : a.startTicks > b.startTicks ? 1 : 0));
          // Prevent overlap by pushing subsequent items if needed
          for (let i = 0; i < track.items.length - 1; i++) {
            const currEnd = track.items[i].startTicks + track.items[i].durationTicks;
            if (track.items[i + 1].startTicks < currEnd) {
              track.items[i + 1].startTicks = currEnd;
            }
          }
          desc = `Move clip "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'TRIM_ITEM': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item && command.newDurationTicks > 0n) {
          item.startTicks = command.newStartTicks < 0n ? 0n : command.newStartTicks;
          item.durationTicks = command.newDurationTicks;
          item.sourceInTicks = command.newSourceInTicks < 0n ? 0n : command.newSourceInTicks;
          item.pinned = true;
          item.provisional = false;
          desc = `Trim clip "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'SPLIT_ITEM': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const idx = track.items.findIndex((i) => i.id === command.itemId);
        if (idx !== -1) {
          const item = track.items[idx];
          const relTick = command.splitTick - item.startTicks;
          const minDuration = TICKS_PER_SECOND / 6n;
          if (relTick >= minDuration && item.durationTicks - relTick >= minDuration) {
            const rightDuration = item.durationTicks - relTick;
            const leftDuration = relTick;
            item.durationTicks = leftDuration;
            item.pinned = true;
            item.provisional = false;

            const rightClone: TimelineItem = {
              ...structuredClone(item),
              id: `${item.id}_split_${Date.now().toString(36)}`,
              name: `${item.name} (B)`,
              startTicks: item.startTicks + leftDuration,
              durationTicks: rightDuration,
              sourceInTicks: item.sourceInTicks + leftDuration,
              pinned: true,
              provisional: false,
            };
            track.items.splice(idx + 1, 0, rightClone);
            desc = `Split clip "${item.name}"`;
          }
          break;
        }
      }
      break;
    }

    case 'SWAP_ITEM_SOURCE': {
      const newAsset = draft.assets.find((a) => a.id === command.newAssetId);
      if (newAsset) {
        for (const track of draft.tracks) {
          if (track.locked) continue;
          const item = track.items.find((i) => i.id === command.itemId);
          if (item) {
            item.assetId = newAsset.id;
            item.name = newAsset.name;
            item.sourceInTicks = newAsset.introTrimTicks;
            item.pinned = true;
            item.provisional = false;
            desc = `Swap source of clip to "${newAsset.name}"`;
            break;
          }
        }
      }
      break;
    }

    case 'SWAP_ITEM_POSITIONS': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const idxA = track.items.findIndex((i) => i.id === command.itemAId);
        const idxB = track.items.findIndex((i) => i.id === command.itemBId);
        if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
          const firstIdx = Math.min(idxA, idxB);
          const secondIdx = Math.max(idxA, idxB);
          const itemFirst = track.items[firstIdx];
          const itemSecond = track.items[secondIdx];

          // Rebuild positions cleanly in order without overlap
          const swapped = [...track.items];
          swapped[firstIdx] = { ...itemSecond, pinned: true, provisional: false };
          swapped[secondIdx] = { ...itemFirst, pinned: true, provisional: false };

          let cursor = swapped[0].startTicks;
          for (let i = 0; i < swapped.length; i++) {
            swapped[i].startTicks = cursor;
            cursor += swapped[i].durationTicks;
          }
          track.items = swapped;
          desc = `Swap positions of "${itemFirst.name}" and "${itemSecond.name}"`;
          break;
        }
      }
      break;
    }

    case 'DELETE_ITEM': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const idx = track.items.findIndex((i) => i.id === command.itemId);
        if (idx !== -1) {
          const removed = track.items[idx];
          const shiftTicks = removed.durationTicks;
          track.items.splice(idx, 1);
          if (command.ripple) {
            for (let i = idx; i < track.items.length; i++) {
              track.items[i].startTicks =
                track.items[i].startTicks >= shiftTicks ? track.items[i].startTicks - shiftTicks : 0n;
            }
          }
          desc = `${command.ripple ? 'Ripple delete' : 'Delete'} clip "${removed.name}"`;
          break;
        }
      }
      break;
    }

    case 'TOGGLE_ENABLE_ITEM': {
      for (const track of draft.tracks) {
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.enabled = !item.enabled;
          item.pinned = true;
          desc = `${item.enabled ? 'Enable' : 'Disable'} clip "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'SET_FREEZE_FRAME': {
      for (const track of draft.tracks) {
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.freezeFrameTicks = command.freezeTickOffset;
          item.pinned = true;
          item.provisional = false;
          desc = command.freezeTickOffset !== null ? `Freeze frame on "${item.name}"` : `Clear freeze frame on "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'UPDATE_ITEM_TRANSFORM': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.transform = { ...item.transform, ...command.transform };
          if (command.speed !== undefined) item.speed = command.speed;
          if (command.volumeDb !== undefined) item.volumeDb = command.volumeDb;
          if (command.opacity !== undefined) item.opacity = command.opacity;
          item.pinned = true;
          item.provisional = false;
          desc = `Update transform/properties on "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'SET_ITEM_TRANSITION': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.transitionIn = command.transition;
          item.pinned = true;
          item.provisional = false;
          if (!draft.recentTransitions.includes(command.transition.kind)) {
            draft.recentTransitions = [command.transition.kind, ...draft.recentTransitions.slice(0, 5)];
          }
          desc = `Set transition "${command.transition.kind}" on "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'ADD_ITEM_EFFECT': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.effects.push(command.effect);
          item.pinned = true;
          item.provisional = false;
          desc = `Add effect "${command.effect.kind}" to "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'UPDATE_ITEM_EFFECT': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          const fx = item.effects.find((e) => e.id === command.effectId);
          if (fx) {
            Object.assign(fx, command.updates);
            item.pinned = true;
            item.provisional = false;
            desc = `Update effect "${fx.kind}" on "${item.name}"`;
          }
          break;
        }
      }
      break;
    }

    case 'REMOVE_ITEM_EFFECT': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.effects = item.effects.filter((e) => e.id !== command.effectId);
          item.pinned = true;
          desc = `Remove effect from "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'UPSERT_KEYFRAME': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          const existingIdx = item.keyframes.findIndex(
            (k) => k.id === command.keyframe.id || (k.property === command.keyframe.property && k.offsetTicks === command.keyframe.offsetTicks)
          );
          if (existingIdx !== -1) {
            item.keyframes[existingIdx] = command.keyframe;
          } else {
            item.keyframes.push(command.keyframe);
          }
          item.keyframes.sort((a, b) => (a.offsetTicks < b.offsetTicks ? -1 : 1));
          item.pinned = true;
          desc = `Set keyframe (${command.keyframe.property}) on "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'REMOVE_KEYFRAME': {
      for (const track of draft.tracks) {
        if (track.locked) continue;
        const item = track.items.find((i) => i.id === command.itemId);
        if (item) {
          item.keyframes = item.keyframes.filter((k) => k.id !== command.keyframeId);
          desc = `Remove keyframe from "${item.name}"`;
          break;
        }
      }
      break;
    }

    case 'ADD_TRACK': {
      const id = `trk_${command.kind}_${Date.now().toString(36)}`;
      draft.tracks.push({
        id,
        name: command.name,
        kind: command.kind,
        muted: false,
        locked: false,
        solo: false,
        blendMode: command.kind === 'overlay' ? 'screen' : 'normal',
        items: [],
      });
      desc = `Add ${command.kind} track "${command.name}"`;
      break;
    }

    case 'TOGGLE_TRACK_STATE': {
      const track = draft.tracks.find((t) => t.id === command.trackId);
      if (track) {
        track[command.field] = !track[command.field];
        desc = `Toggle ${command.field} on track "${track.name}"`;
      }
      break;
    }

    case 'ADD_TEXT_ITEM': {
      let textTrack = draft.tracks.find((t) => t.id === command.trackId || t.kind === 'text');
      if (!textTrack) {
        textTrack = {
          id: 'trk_text_main',
          name: 'Text & Titles',
          kind: 'text',
          muted: false,
          locked: false,
          solo: false,
          blendMode: 'normal',
          items: [],
        };
        draft.tracks.push(textTrack);
      }
      // Ensure non-overlapping placement on text track
      let start = command.startTicks;
      for (const existing of textTrack.items) {
        const exEnd = existing.startTicks + existing.durationTicks;
        if (start < exEnd && start + command.durationTicks > existing.startTicks) {
          start = exEnd;
        }
      }
      const newItem: TimelineItem = {
        id: `txt_${Date.now().toString(36)}`,
        assetId: '__text__',
        trackId: textTrack.id,
        name: command.text.slice(0, 22),
        startTicks: start,
        durationTicks: command.durationTicks,
        sourceInTicks: 0n,
        pinned: true,
        provisional: false,
        enabled: true,
        freezeFrameTicks: null,
        transform: defaultClipTransform(),
        speed: 1.0,
        volumeDb: 0,
        opacity: 100,
        fitMode: 'crop',
        blendMode: 'normal',
        transitionIn: { kind: 'Cross Dissolve', durationTicks: TICKS_PER_SECOND / 5n },
        effects: [],
        keyframes: [],
        textPayload: {
          text: command.text,
          fontSize: command.style === 'title' ? 42 : 26,
          color: '#FFFFFF',
          style: command.style,
        },
        cacheKey: '',
        cacheStatus: 'pending',
      };
      textTrack.items.push(newItem);
      textTrack.items.sort((a, b) => (a.startTicks < b.startTicks ? -1 : 1));
      desc = `Add manual text "${command.text}"`;
      break;
    }

    case 'DRAFT_LYRIC_CAPTIONS': {
      let textTrack = draft.tracks.find((t) => t.kind === 'text');
      if (!textTrack) {
        textTrack = {
          id: 'trk_text_main',
          name: 'Text & Captions',
          kind: 'text',
          muted: false,
          locked: false,
          solo: false,
          blendMode: 'normal',
          items: [],
        };
        draft.tracks.push(textTrack);
      }
      textTrack.items = command.lyrics.map((line, i) => ({
        id: `lyric_${i}_${Date.now().toString(36)}`,
        assetId: '__text__',
        trackId: textTrack!.id,
        name: line.text.slice(0, 24),
        startTicks: line.startTicks,
        durationTicks: line.endTicks - line.startTicks,
        sourceInTicks: 0n,
        pinned: true,
        provisional: false,
        enabled: true,
        freezeFrameTicks: null,
        transform: { ...defaultClipTransform(), positionY: 34 },
        speed: 1.0,
        volumeDb: 0,
        opacity: 100,
        fitMode: 'crop',
        blendMode: 'normal',
        transitionIn: { kind: 'Hard Cut', durationTicks: 0n },
        effects: [],
        keyframes: [],
        textPayload: {
          text: line.text,
          fontSize: 28,
          color: '#14B8A6',
          style: 'caption',
        },
        cacheKey: '',
        cacheStatus: 'pending',
      }));
      desc = `Draft ${command.lyrics.length} local lyric captions onto editable track`;
      break;
    }

    case 'NORMALIZE_CLIP_AUDIO': {
      for (const track of draft.tracks) {
        if (track.kind === 'video' || track.kind === 'audio') {
          for (const item of track.items) {
            item.volumeDb = -6.0; // Normalized against song master
          }
        }
      }
      desc = `Normalize clip audio levels to -6.0 dB target`;
      break;
    }

    case 'ADD_MARKER': {
      draft.markers.push(command.marker);
      draft.markers.sort((a, b) => (a.startTicks < b.startTicks ? -1 : 1));
      desc = `Add timeline marker "${command.marker.name}"`;
      break;
    }

    case 'REMOVE_MARKER': {
      draft.markers = draft.markers.filter((m) => m.id !== command.markerId);
      desc = `Remove timeline marker`;
      break;
    }

    case 'MARK_CACHE_KEYS_READY': {
      for (const k of command.keys) {
        draft.knownRenderCacheKeys[k] = true;
      }
      desc = `Commit ${command.keys.length} rendered segment(s) to content-addressed cache`;
      break;
    }

    case 'PURGE_DERIVED_CACHE': {
      draft.knownRenderCacheKeys = {};
      desc = `Purge derived render and analysis cache home`;
      break;
    }

    case 'UPDATE_EXPORT_SETTINGS': {
      draft.exportSettings = { ...draft.exportSettings, ...command.settings };
      desc = `Update export configuration`;
      break;
    }

    case 'UPDATE_OPEN_DECISIONS': {
      draft.openDecisions = { ...draft.openDecisions, ...command.updates };
      desc = `Update owner open decision gate`;
      break;
    }

    case 'EXTRACT_CUT_TEMPLATE': {
      const videoTrack = draft.tracks.find((t) => t.kind === 'video');
      const bpm = draft.songAnalysis?.bpm ?? 128;
      const beatSeconds = 60 / bpm;
      const beatTicks = secondsToTicks(beatSeconds);
      if (videoTrack && videoTrack.items.length > 0 && beatTicks > 0n) {
        const pattern = videoTrack.items.map((item) => {
          const beats = Math.max(1, Math.round(Number(item.durationTicks) / Number(beatTicks)));
          return beats;
        });
        draft.plannerSettings.cutTemplate = pattern;
        draft.plannerSettings.cutTemplateName = command.name;
        desc = `Extract cut template "${command.name}" (${pattern.length} intervals)`;
      }
      break;
    }
  }

  const withCacheKeys = refreshProjectCacheKeys(draft);
  const validation = validateProjectInvariants(withCacheKeys);

  if (!validation.valid) {
    // Reject invalid command commitment per Section 11.3 & Rule 4
    return {
      nextState: currentState,
      validation,
      commandDescription: `REJECTED (${desc}): ${validation.errors[0]}`,
    };
  }

  return {
    nextState: withCacheKeys,
    validation,
    commandDescription: desc,
  };
}

/**
 * Create preloaded Demo Pool & Initial Project State
 */
export function createInitialDemoAssets(): MediaAsset[] {
  return [
    {
      id: 'vid_cyber_sprint',
      name: '01_Cybernetic_Alley_Sprint_4K.mp4',
      pathHint: 'D:/Footage/AMV_Source/01_Cybernetic_Alley_Sprint_4K.mp4',
      kind: 'video',
      fingerprint: 'fp_48291040_9a8c4e12b031',
      fileSize: 48_291_040,
      probe: {
        durationTicks: secondsToTicks(18.0),
        width: 1920,
        height: 1080,
        fps: 60,
        codec: 'H.264 (High@L4.2)',
        container: 'MP4',
        rotation: 0,
      },
      introTrimTicks: secondsToTicks(1.0), // Skip studio bumper
      outroTrimTicks: secondsToTicks(1.0),
      analysisStage: 0,
      stage1Progress: 0,
      stage2Progress: 0,
      cancelled: false,
      missing: false,
      scenes: [],
      blackRanges: [],
      motionCurve: [],
      bestMoments: [],
      filmstrip: ['#0f766e', '#14b8a6', '#0d9488', '#115e59', '#2dd4bf', '#0f766e'],
      proceduralTheme: 'cyber_sprint',
      accentColor: '#14B8A6',
    },
    {
      id: 'vid_neon_drift',
      name: '02_Midnight_Touge_Drift_Chase.mkv',
      pathHint: 'D:/Footage/AMV_Source/02_Midnight_Touge_Drift_Chase.mkv',
      kind: 'video',
      fingerprint: 'fp_64120880_3f71d904c218',
      fileSize: 64_120_880,
      probe: {
        durationTicks: secondsToTicks(22.0),
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'HEVC (Main10)',
        container: 'MKV',
        rotation: 0,
      },
      introTrimTicks: secondsToTicks(1.5),
      outroTrimTicks: secondsToTicks(1.5),
      analysisStage: 0,
      stage1Progress: 0,
      stage2Progress: 0,
      cancelled: false,
      missing: false,
      scenes: [],
      blackRanges: [],
      motionCurve: [],
      bestMoments: [],
      filmstrip: ['#1d4ed8', '#3b82f6', '#2563eb', '#60a5fa', '#1e40af', '#3b82f6'],
      proceduralTheme: 'neon_drift',
      accentColor: '#3B82F6',
    },
    {
      id: 'vid_mecha_launch',
      name: '03_Valkyrie_Mecha_Catapult_Launch.mp4',
      pathHint: 'D:/Footage/AMV_Source/03_Valkyrie_Mecha_Catapult_Launch.mp4',
      kind: 'video',
      fingerprint: 'fp_91450200_7c2e8a55f109',
      fileSize: 91_450_200,
      probe: {
        durationTicks: secondsToTicks(24.0),
        width: 1920,
        height: 1080,
        fps: 24,
        codec: 'H.264 (High@L4.1)',
        container: 'MP4',
        rotation: 0,
      },
      introTrimTicks: secondsToTicks(2.0), // Skip studio logo intro
      outroTrimTicks: secondsToTicks(2.0), // Skip episode credit tail
      analysisStage: 0,
      stage1Progress: 0,
      stage2Progress: 0,
      cancelled: false,
      missing: false,
      scenes: [],
      blackRanges: [],
      motionCurve: [],
      bestMoments: [],
      filmstrip: ['#b45309', '#f59e0b', '#d97706', '#fbbf24', '#92400e', '#f59e0b'],
      proceduralTheme: 'mecha_launch',
      accentColor: '#F59E0B',
    },
    {
      id: 'vid_orbital_strike',
      name: '04_Orbital_Laser_Convergence_Scene.mov',
      pathHint: 'D:/Footage/AMV_Source/04_Orbital_Laser_Convergence_Scene.mov',
      kind: 'video',
      fingerprint: 'fp_77310400_5b9a11e8d442',
      fileSize: 77_310_400,
      probe: {
        durationTicks: secondsToTicks(20.0),
        width: 1920,
        height: 1080,
        fps: 60,
        codec: 'ProRes 422',
        container: 'MOV',
        rotation: 0,
      },
      introTrimTicks: secondsToTicks(0.5),
      outroTrimTicks: secondsToTicks(1.0),
      analysisStage: 0,
      stage1Progress: 0,
      stage2Progress: 0,
      cancelled: false,
      missing: false,
      scenes: [],
      blackRanges: [],
      motionCurve: [],
      bestMoments: [],
      filmstrip: ['#7e22ce', '#a855f7', '#9333ea', '#c084fc', '#6b21a8', '#a855f7'],
      proceduralTheme: 'orbital_strike',
      accentColor: '#A855F7',
    },
    {
      id: 'vid_rooftop_parkour',
      name: '05_Skyline_Rain_Duel_FinalCut.mp4',
      pathHint: 'D:/Footage/AMV_Source/05_Skyline_Rain_Duel_FinalCut.mp4',
      kind: 'video',
      fingerprint: 'fp_53900120_1e4f66a9c871',
      fileSize: 53_900_120,
      probe: {
        durationTicks: secondsToTicks(19.0),
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'AV1 (Main)',
        container: 'MP4',
        rotation: 0,
      },
      introTrimTicks: secondsToTicks(1.0),
      outroTrimTicks: secondsToTicks(1.0),
      analysisStage: 0,
      stage1Progress: 0,
      stage2Progress: 0,
      cancelled: false,
      missing: false,
      scenes: [],
      blackRanges: [],
      motionCurve: [],
      bestMoments: [],
      filmstrip: ['#be123c', '#f43f5e', '#e11d48', '#fb7185', '#9f1239', '#f43f5e'],
      proceduralTheme: 'rooftop_parkour',
      accentColor: '#F43F5E',
    },
    {
      id: 'song_shatter_horizon',
      name: 'Shatter_The_Horizon_128BPM_Master.flac',
      pathHint: 'D:/Music/Masters/Shatter_The_Horizon_128BPM_Master.flac',
      kind: 'audio',
      fingerprint: 'fp_31840200_a4d892f011c3',
      fileSize: 31_840_200,
      probe: {
        durationTicks: secondsToTicks(24.0),
        width: 0,
        height: 0,
        fps: 0,
        codec: 'FLAC (Symphonia Pure Rust Decode)',
        container: 'FLAC',
        rotation: 0,
        sampleRate: 48000,
        channels: 2,
      },
      introTrimTicks: 0n,
      outroTrimTicks: 0n,
      analysisStage: 2,
      stage1Progress: 1,
      stage2Progress: 1,
      cancelled: false,
      missing: false,
      scenes: [],
      blackRanges: [],
      motionCurve: [],
      bestMoments: [],
      filmstrip: [],
      accentColor: '#14B8A6',
    },
    {
      id: 'song_afterglow_coda',
      name: 'Afterglow_Breakbeat_Outrun_128BPM.wav',
      pathHint: 'D:/Music/Masters/Afterglow_Breakbeat_Outrun_128BPM.wav',
      kind: 'audio',
      fingerprint: 'fp_19420000_c91e04b77a12',
      fileSize: 19_420_000,
      probe: {
        durationTicks: secondsToTicks(12.0),
        width: 0,
        height: 0,
        fps: 0,
        codec: 'PCM 24-bit (Symphonia Pure Rust Decode)',
        container: 'WAV',
        rotation: 0,
        sampleRate: 48000,
        channels: 2,
      },
      introTrimTicks: 0n,
      outroTrimTicks: 0n,
      analysisStage: 2,
      stage1Progress: 1,
      stage2Progress: 1,
      cancelled: false,
      missing: false,
      scenes: [],
      blackRanges: [],
      motionCurve: [],
      bestMoments: [],
      filmstrip: [],
      accentColor: '#0EA5E9',
    },
  ];
}

export function createInitialCapabilityReport(): CapabilityReport {
  return {
    adapterName: 'NVIDIA GeForce GTX 1650 Max-Q + Intel UHD Graphics 630 (Switchable Dual-GPU)',
    backend: 'Direct3D 12 / WGPU',
    dualGpuDetected: true,
    integratedDecodeApi: 'Windows Media Foundation (D3D11VA Hardware Decode Verified)',
    trialDecodeVerified: true,
    trialEncodeResults: [
      {
        codec: 'H.264',
        requestedName: 'h264',
        resolvedName: 'h264_qsv (Intel QuickSync Trial Verified) / libx264 (Software Floor)',
        hardwareAccelerated: true,
        trialPassed: true,
      },
      {
        codec: 'H.265',
        requestedName: 'hevc',
        resolvedName: 'hevc_qsv (Intel QuickSync Trial Verified)',
        hardwareAccelerated: true,
        trialPassed: true,
      },
      {
        codec: 'AV1',
        requestedName: 'av1',
        resolvedName: 'libsvtav1 (Resolved Software Tenant — No HW AV1 Encoder on Adapter)',
        hardwareAccelerated: false,
        trialPassed: true,
      },
      {
        codec: 'VP9',
        requestedName: 'vp9',
        resolvedName: 'libvpx-vp9 (Resolved Software Tenant)',
        hardwareAccelerated: false,
        trialPassed: true,
      },
    ],
    capabilityHash: 'cap_d3d12_wgpu_qsv_1650mq',
  };
}

export function createInitialProjectState(): ProjectState {
  const assets = createInitialDemoAssets();
  const cap = createInitialCapabilityReport();

  const state: ProjectState = {
    schemaVersion: 1,
    projectName: 'Shatter_Horizon_AMV.beatgem.json',
    lastSavedAt: '2026-11-11 07:40:00',
    backupSavedAt: '2026-11-11 07:39:15 (.bak)',
    assets,
    selectedSongAssetIds: ['song_shatter_horizon'],
    songAnalysis: null,
    tracks: [
      {
        id: 'trk_video_main',
        name: 'Video 1 (Primary Beat Cut)',
        kind: 'video',
        muted: false,
        locked: false,
        solo: false,
        blendMode: 'normal',
        items: [],
      },
      {
        id: 'trk_overlay_1',
        name: 'Overlay 1 (PIP & Composite)',
        kind: 'overlay',
        muted: false,
        locked: false,
        solo: false,
        blendMode: 'screen',
        items: [],
      },
      {
        id: 'trk_adj_1',
        name: 'Adjustment Layer (Global Look)',
        kind: 'adjustment',
        muted: false,
        locked: false,
        solo: false,
        blendMode: 'normal',
        items: [],
      },
      {
        id: 'trk_text_main',
        name: 'Text & Lyric Captions',
        kind: 'text',
        muted: false,
        locked: false,
        solo: false,
        blendMode: 'normal',
        items: [],
      },
    ],
    markers: [
      {
        id: 'mrk_1',
        name: 'Verse 1 Kick In',
        color: '#14B8A6',
        startTicks: secondsToTicks(3.75),
        durationTicks: secondsToTicks(1.875),
      },
      {
        id: 'mrk_2',
        name: 'Chorus Drop Impact',
        color: '#F59E0B',
        startTicks: secondsToTicks(11.25),
        durationTicks: secondsToTicks(3.75),
      },
      {
        id: 'mrk_3',
        name: 'Finale Climax',
        color: '#EF4444',
        startTicks: secondsToTicks(18.75),
        durationTicks: secondsToTicks(3.75),
      },
    ],
    plannerSettings: {
      clipVariance: 0.25,
      sourceReuseProtection: 0.7,
      spread: 0.8,
      continueStartPoints: true,
      placementMode: 'windowed_proportional',
      minLengthValue: 2,
      maxLengthValue: 4,
      lengthUnit: 'beats',
      cutOffsetMs: -32, // Cuts land slightly ahead of the beat per Section 7
      snapToScenes: true,
      snapToBlackEdges: true,
      gridPhilosophy: 'transient',
      beatsPerBar: 4,
      seed: 133742,
      cutTemplate: null,
      cutTemplateName: null,
    },
    exportSettings: {
      container: 'MP4',
      codec: 'H.264',
      width: 1920,
      height: 1080,
      fps: 30,
      qualityCrf: 18,
      fitMode: 'crop',
      bypassRenderCache: false,
      audioSongGainDb: 0.0,
      audioClipGainDb: -12.0,
      audioFadeOutMs: 1200,
    },
    exportQueue: [],
    capabilityReport: cap,
    openDecisions: {
      licenseAndExportFloor: 'lgpl_dynamic_openh264',
      fallbackCodecTenant: 'ffmpeg_next_7_pinned',
      lowEndMachineGateVerified: true,
    },
    startupLog: [
      {
        timestamp: '07:40:00.002',
        phase: 'BOOT',
        message: 'BeatGem v0.1.0 starting. Panic-safe file logger attached beside executable.',
      },
      {
        timestamp: '07:40:00.018',
        phase: 'GPU_PROBE',
        message: 'Headless pre-window WGPU probe found dual adapters: Integrated UHD 630 + Discrete GTX 1650 Max-Q.',
      },
      {
        timestamp: '07:40:00.024',
        phase: 'RENDERER_SELECT',
        message: 'Selected accelerated WGPU Direct3D 12 renderer before creating window event loop.',
      },
      {
        timestamp: '07:40:00.089',
        phase: 'TRIAL_CODEC',
        message: 'Trial decode (D3D11VA NV12 frame verified). Trial encode: requested "h264" -> resolved "h264_qsv".',
      },
      {
        timestamp: '07:40:00.112',
        phase: 'WINDOW_INIT',
        message: 'Single event-loop window initialized at 1440x900. Workspace invariants verified.',
      },
    ],
    shortcutProfile: 'BeatGem Default',
    presets: [
      {
        id: 'pre_amv_tight',
        name: 'High-Energy Chorus Cut (1-2 Beats)',
        category: 'planner',
        description: 'Fast transient cuts with -38ms beat anticipation and high spread across sources.',
        payload: {
          minLengthValue: 1,
          maxLengthValue: 2,
          lengthUnit: 'beats',
          cutOffsetMs: -38,
          spread: 0.9,
          gridPhilosophy: 'transient',
        },
      },
      {
        id: 'pre_cinematic_bars',
        name: 'Cinematic Phrase Flow (1-2 Bars)',
        category: 'planner',
        description: 'Longer bar-aligned cuts that continue start points sequentially.',
        payload: {
          minLengthValue: 1,
          maxLengthValue: 2,
          lengthUnit: 'bars',
          cutOffsetMs: -20,
          continueStartPoints: true,
          gridPhilosophy: 'grid',
        },
      },
      {
        id: 'pre_export_master',
        name: '1080p60 Master H.264 (CRF 16)',
        category: 'export',
        description: 'High bitrate MP4 master for archival and local playback.',
        payload: {
          container: 'MP4',
          codec: 'H.264',
          width: 1920,
          height: 1080,
          fps: 60,
          qualityCrf: 16,
        },
      },
    ],
    recentTransitions: ['Crash Zoom', 'Film Dissolve', 'Whip Pan' as TransitionKind, 'Cross Dissolve'].filter(
      (x): x is TransitionKind => x !== ('Whip Pan' as TransitionKind)
    ),
    knownRenderCacheKeys: {},
  };

  return state;
}
