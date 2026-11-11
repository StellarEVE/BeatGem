import { Tick } from './ticks';

export type WorkspacePage = 'media' | 'cut' | 'edit' | 'export';

export type AssetKind = 'video' | 'audio';

export type ProceduralTheme =
  | 'cyber_sprint'
  | 'neon_drift'
  | 'mecha_launch'
  | 'orbital_strike'
  | 'rooftop_parkour';

export interface ProbeMetadata {
  durationTicks: Tick;
  width: number;
  height: number;
  fps: number;
  codec: string;
  container: string;
  rotation: 0 | 90 | 180 | 270;
  sampleRate?: number;
  channels?: number;
}

export interface SceneBoundary {
  tick: Tick;
  confidence: number; // 0..1
  exactFrame: boolean; // false in Stage 1, true in Stage 2
}

export interface BlackRange {
  startTicks: Tick;
  endTicks: Tick;
}

export interface MotionSample {
  tick: Tick;
  magnitude: number; // 0..1
}

export interface BestMoment {
  startTicks: Tick;
  endTicks: Tick;
  score: number; // 0..1
  reason: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  pathHint: string;
  kind: AssetKind;
  fingerprint: string; // size + head/mid/tail content hash
  fileSize: number;
  probe: ProbeMetadata;
  introTrimTicks: Tick;
  outroTrimTicks: Tick;
  analysisStage: 0 | 1 | 2;
  stage1Progress: number; // 0..1
  stage2Progress: number; // 0..1
  cancelled: boolean;
  missing: boolean;
  scenes: SceneBoundary[];
  blackRanges: BlackRange[];
  motionCurve: MotionSample[];
  bestMoments: BestMoment[];
  filmstrip: string[]; // SVG or data URL colors/frames
  proceduralTheme?: ProceduralTheme;
  objectUrl?: string; // if imported from local disk
  accentColor: string;
}

export interface OnsetEvent {
  tick: Tick;
  strength: number; // 0..1 overall
  lowBand: number; // kick / sub 20-250Hz
  midBand: number; // snare / body 250-2000Hz
  highBand: number; // hats / transients 2k-16kHz
}

export interface ChangePoint {
  tick: Tick;
  label: string; // e.g., 'Intro', 'Verse 1', 'Chorus Drop', 'Bridge', 'Finale'
  energy: number; // 0..1 regime energy
}

export interface LyricLine {
  id: string;
  startTicks: Tick;
  endTicks: Tick;
  text: string;
}

export interface SongAnalysis {
  assetId: string;
  bpm: number;
  beatsPerBar: number;
  beatGridTicks: Tick[];
  barTicks: Tick[];
  phraseTicks: Tick[];
  onsets: OnsetEvent[];
  changePoints: ChangePoint[];
  waveformPeaks: number[];
  integratedLufs: number;
  draftedLyrics: LyricLine[];
}

/**
 * Section 10.3: Eleven named transitions plus Hard Cut, implemented as genuine forms in both compositors.
 */
export type TransitionKind =
  | 'Hard Cut'
  | 'Cross Dissolve'
  | 'Dip to Color'
  | 'Film Dissolve'
  | 'Dip to Dissolve'
  | 'Crash Zoom'
  | 'Directional Zoom'
  | 'Twist Wheel'
  | 'Radial Twist'
  | 'Push'
  | 'Slide'
  | 'Split';

export interface TransitionSpec {
  kind: TransitionKind;
  durationTicks: Tick;
  dipColor?: '#000000' | '#FFFFFF';
}

/**
 * Section 10.4: Processor core effects + full target vocabulary.
 */
export type EffectKind =
  | 'Brightness'
  | 'Contrast'
  | 'Saturation'
  | 'Blur'
  | 'Sharpen'
  | 'Zoom'
  | 'Shake'
  | 'Stutter'
  | 'Strobe'
  | 'RGB Shift'
  | 'Glitch'
  | 'Tunnel'
  | 'Invert'
  | 'Echo'
  | 'Hue Shift'
  | 'Flash'
  | 'Beat Pulse'
  | 'Color Look'
  | 'Split Screen';

export interface EffectInstance {
  id: string;
  kind: EffectKind;
  enabled: boolean;
  amount: number; // -100 to +100 or 0 to 100
  secondaryParam?: string; // e.g. LUT name or Split Screen mode
  gpuAccelerated: boolean; // graduated to shader under oracle rule
}

export type AnimatableProperty = 'scale' | 'positionX' | 'positionY' | 'rotation' | 'opacity' | 'volumeDb';

export type CurveInterpolation = 'linear' | 'easeIn' | 'easeOut' | 'bezier';

export interface Keyframe {
  id: string;
  property: AnimatableProperty;
  offsetTicks: Tick; // relative to clip start
  value: number;
  interpolation: CurveInterpolation;
  // Cubic Bezier control points (normalized 0..1)
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
}

export interface ClipTransform {
  positionX: number;
  positionY: number;
  scale: number; // 100 = 100%
  rotation: number; // degrees
  anchorX: number; // 0.5 = center
  anchorY: number; // 0.5 = center
  cropTop: number;
  cropBottom: number;
  cropLeft: number;
  cropRight: number;
}

export type FitMode = 'crop' | 'black_bars' | 'blurred_padding';
export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'add';

export interface TimelineItem {
  id: string;
  assetId: string; // references MediaAsset.id (or '__text__' / '__adj__' for synthetic items)
  trackId: string;
  name: string;
  startTicks: Tick;
  durationTicks: Tick;
  sourceInTicks: Tick;
  pinned: boolean; // Section 3 & 8.3: Pinned clips survive regeneration untouched
  provisional: boolean; // Section 6.2 & 8.3: Stage 1 rough cut = true, Stage 2 settled = false
  enabled: boolean;
  freezeFrameTicks: Tick | null;
  transform: ClipTransform;
  speed: number; // 1.0 = 100%
  volumeDb: number; // 0 dB = unity
  opacity: number; // 0..100
  fitMode: FitMode;
  blendMode: BlendMode;
  transitionIn: TransitionSpec;
  effects: EffectInstance[];
  keyframes: Keyframe[];
  textPayload?: {
    text: string;
    fontSize: number;
    color: string;
    style: 'title' | 'caption' | 'kinetic';
  };
  scoreBreakdown?: {
    total: number;
    sceneSnap: number;
    motionMatch: number;
    bestMoment: number;
    reusePenalty: number;
  };
  cacheKey: string; // Content-addressed hash (Section 10.5)
  cacheStatus: 'ready' | 'rendering' | 'pending';
}

export type TrackKind = 'video' | 'overlay' | 'adjustment' | 'text' | 'audio';

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  blendMode: BlendMode;
  items: TimelineItem[];
}

export interface TimelineMarker {
  id: string;
  name: string;
  color: '#14B8A6' | '#F59E0B' | '#EF4444' | '#3B82F6' | '#A855F7';
  startTicks: Tick;
  durationTicks: Tick;
}

/**
 * Section 7 & 9: Planner Wrapper Settings Type
 */
export type PlacementMode = 'windowed_proportional' | 'evenly_spaced';
export type LengthUnit = 'beats' | 'bars' | 'seconds';
export type GridPhilosophy = 'transient' | 'grid';

export interface PlannerSettings {
  clipVariance: number; // 0..1
  sourceReuseProtection: number; // 0..1 penalty weight
  spread: number; // 0..1 distant section preference
  continueStartPoints: boolean; // resume source where last clip stopped
  placementMode: PlacementMode;
  minLengthValue: number;
  maxLengthValue: number;
  lengthUnit: LengthUnit;
  cutOffsetMs: number; // negative = ahead of beat (e.g., -35ms)
  snapToScenes: boolean;
  snapToBlackEdges: boolean;
  gridPhilosophy: GridPhilosophy;
  beatsPerBar: number;
  seed: number; // Explicit deterministic seed
  cutTemplate: number[] | null; // Extracted beat-multiplier pattern
  cutTemplateName: string | null;
}

export type ExportContainer = 'MP4' | 'MKV' | 'WebM' | 'MOV';
export type ExportCodec = 'H.264' | 'H.265' | 'AV1' | 'VP9';

export interface ExportSettings {
  container: ExportContainer;
  codec: ExportCodec;
  width: number;
  height: number;
  fps: 24 | 25 | 30 | 60;
  qualityCrf: number; // 14 (Lossless-like) to 32 (Compact)
  fitMode: FitMode;
  bypassRenderCache: boolean;
  audioSongGainDb: number;
  audioClipGainDb: number;
  audioFadeOutMs: number;
}

export interface ExportJob {
  id: string;
  outputFileName: string;
  tempFileName: string; // Atomic export: writes to .tmp, renames on completion
  settings: ExportSettings;
  resolvedEncoderName: string; // Section 10.6: Never hidden when substituted
  status: 'queued' | 'rendering' | 'completed' | 'cancelled' | 'failed';
  progress: number; // 0..1
  etaSeconds: number;
  cacheHits: number;
  totalSegments: number;
  createdAt: string;
  downloadUrl?: string;
}

/**
 * Section 14, 15, 18, 20: Hardware Capability Report & Owner Open Decisions
 */
export interface CapabilityReport {
  adapterName: string;
  backend: 'Vulkan / WGPU Accelerated' | 'Direct3D 12 / WGPU' | 'OpenGL Fallback Path';
  dualGpuDetected: boolean;
  integratedDecodeApi: string;
  trialDecodeVerified: boolean;
  trialEncodeResults: {
    codec: ExportCodec;
    requestedName: string;
    resolvedName: string;
    hardwareAccelerated: boolean;
    trialPassed: boolean;
  }[];
  capabilityHash: string;
}

export interface OpenDecisionsState {
  licenseAndExportFloor: 'lgpl_dynamic_openh264' | 'gpl_x264_x265_floor';
  fallbackCodecTenant: 'ffmpeg_next_7_pinned' | 'rsmpeg_candidate';
  lowEndMachineGateVerified: boolean;
}

export interface StartupLogEntry {
  timestamp: string;
  phase: 'BOOT' | 'GPU_PROBE' | 'RENDERER_SELECT' | 'TRIAL_CODEC' | 'WINDOW_INIT' | 'PIPELINE' | 'SAVE';
  message: string;
}

export type ShortcutProfile = 'BeatGem Default' | 'DaVinci Resolve' | 'Premiere Pro' | 'CapCut';

export interface PresetItem {
  id: string;
  name: string;
  category: 'planner' | 'export' | 'effect';
  description: string;
  payload: Partial<PlannerSettings> | Partial<ExportSettings> | EffectInstance[];
}

export interface ProjectState {
  schemaVersion: 1;
  projectName: string;
  lastSavedAt: string | null;
  backupSavedAt: string | null;
  assets: MediaAsset[];
  selectedSongAssetIds: string[]; // Supports single song or multiple stitched songs (Section 6.1)
  songAnalysis: SongAnalysis | null;
  tracks: Track[];
  markers: TimelineMarker[];
  plannerSettings: PlannerSettings;
  exportSettings: ExportSettings;
  exportQueue: ExportJob[];
  capabilityReport: CapabilityReport;
  openDecisions: OpenDecisionsState;
  startupLog: StartupLogEntry[];
  shortcutProfile: ShortcutProfile;
  presets: PresetItem[];
  recentTransitions: TransitionKind[];
  knownRenderCacheKeys: Record<string, boolean>; // Simulates persistent content-addressed cache directory
}
