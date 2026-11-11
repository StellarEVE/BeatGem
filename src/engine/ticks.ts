/**
 * BeatGem Core Tick Mathematics
 * Section 3 & 12: All edit mathematics runs on fixed integer ticks at 254,016,000,000 ticks per second
 * over a signed 64-bit integer. Floating point seconds are banned from edit positions and durations.
 */

export type Tick = bigint;

export const TICKS_PER_SECOND: Tick = 254_016_000_000n;
export const TICKS_PER_MILLISECOND: Tick = 254_016_000n;

// Exact integer ticks per frame for common frame rates
export const TICKS_PER_FRAME: Record<number, Tick> = {
  24: 10_584_000_000n,
  25: 10_160_640_000n,
  30: 8_467_200_000n,
  50: 5_080_320_000n,
  60: 4_233_600_000n,
  120: 2_116_800_000n,
};

// Exact integer ticks per audio sample
export const TICKS_PER_SAMPLE_44100: Tick = 5_760_000n;
export const TICKS_PER_SAMPLE_48000: Tick = 5_292_000n;

/**
 * Convert floating-point seconds (from external media probe or audio analysis) into exact integer ticks.
 * Used ONLY at ingestion boundaries; edit math operates strictly on Tick.
 */
export function secondsToTicks(seconds: number): Tick {
  const micros = Math.round(seconds * 1_000_000);
  return (BigInt(micros) * TICKS_PER_SECOND) / 1_000_000n;
}

/**
 * Convert exact integer ticks to display seconds (for UI canvas rendering / WebAudio scheduling).
 */
export function ticksToSeconds(ticks: Tick): number {
  const micros = (ticks * 1_000_000n) / TICKS_PER_SECOND;
  return Number(micros) / 1_000_000;
}

/**
 * Snap a tick position to the nearest exact frame boundary at the given frame rate.
 */
export function snapTicksToFrame(ticks: Tick, fps: number = 30): Tick {
  const frameTicks = TICKS_PER_FRAME[fps] ?? TICKS_PER_SECOND / BigInt(Math.round(fps));
  if (frameTicks <= 0n) return ticks;
  const half = frameTicks / 2n;
  return ((ticks + half) / frameTicks) * frameTicks;
}

/**
 * Convert beats at a given BPM to exact integer ticks.
 */
export function beatsToTicks(beats: number, bpm: number): Tick {
  if (bpm <= 0) return TICKS_PER_SECOND;
  const secondsPerBeat = 60 / bpm;
  return secondsToTicks(beats * secondsPerBeat);
}

/**
 * Convert bars to exact integer ticks.
 */
export function barsToTicks(bars: number, bpm: number, beatsPerBar: number = 4): Tick {
  return beatsToTicks(bars * beatsPerBar, bpm);
}

/**
 * Convert milliseconds offset (e.g., Cut Offset) to exact integer ticks.
 */
export function msToTicks(ms: number): Tick {
  return BigInt(Math.round(ms)) * TICKS_PER_MILLISECOND;
}

/**
 * Format exact integer ticks as SMPTE timecode HH:MM:SS:FF.
 */
export function ticksToTimecode(ticks: Tick, fps: number = 30): string {
  const safeTicks = ticks < 0n ? 0n : ticks;
  const totalSeconds = Number(safeTicks / TICKS_PER_SECOND);
  const remainderTicks = safeTicks % TICKS_PER_SECOND;
  const frameTicks = TICKS_PER_FRAME[fps] ?? TICKS_PER_SECOND / BigInt(fps);
  const frames = Number(remainderTicks / frameTicks);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}:${pad2(frames)}`;
}

/**
 * Format exact integer ticks as compact MM:SS.ms string.
 */
export function formatTicksCompact(ticks: Tick): string {
  const sec = ticksToSeconds(ticks < 0n ? 0n : ticks);
  const mins = Math.floor(sec / 60);
  const remSec = (sec % 60).toFixed(2).padStart(5, '0');
  return `${mins.toString().padStart(2, '0')}:${remSec}`;
}

/**
 * Format raw integer tick count with thousand separators for technical inspection.
 */
export function formatRawTicks(ticks: Tick): string {
  return ticks.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
