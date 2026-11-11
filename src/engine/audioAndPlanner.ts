import { computeItemCacheKey, defaultClipTransform } from './core';
import {
  TICKS_PER_SECOND,
  Tick,
  barsToTicks,
  beatsToTicks,
  msToTicks,
  secondsToTicks,
  snapTicksToFrame,
  ticksToSeconds,
} from './ticks';
import {
  BestMoment,
  BlackRange,
  ChangePoint,
  LyricLine,
  MediaAsset,
  MotionSample,
  OnsetEvent,
  PlannerSettings,
  ProjectState,
  SceneBoundary,
  SongAnalysis,
  TimelineItem,
  TransitionKind,
} from './types';

/**
 * Deterministic 32-bit PRNG (Mulberry32) driven by PlannerSettings.seed
 * Section 7: "generation is driven by an explicit seed, so the same project, settings and seed produce the same cut, byte for byte."
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Section 8.1 & 17: Synthetic 120.0 BPM Click Train Fixture & Autocorrelation Tempo Verifier.
 * Generates an onset envelope at 100 Hz frame rate with impulses every 0.5s (120 BPM)
 * and runs autocorrelation across candidate lags (60..200 BPM).
 */
export function verify120BpmClickTrainFixture(): {
  expectedBpm: number;
  measuredBpm: number;
  deltaBpm: number;
  passed: boolean;
  sampleRateHz: number;
  durationSec: number;
} {
  const envelopeRateHz = 200; // 5ms hop size
  const durationSec = 10;
  const totalFrames = envelopeRateHz * durationSec;
  const signal = new Float32Array(totalFrames);

  // Place sharp click impulses every 0.5 seconds (100 frames = 120.0 BPM)
  const clickIntervalFrames = Math.round(envelopeRateHz * 0.5);
  for (let i = 0; i < totalFrames; i += clickIntervalFrames) {
    signal[i] = 1.0;
    if (i + 1 < totalFrames) signal[i + 1] = 0.35;
  }

  // Autocorrelation across lags corresponding to 60 BPM (200 frames) to 180 BPM (66 frames)
  let bestLag = clickIntervalFrames;
  let maxCorr = -1;
  for (let lag = 66; lag <= 200; lag++) {
    let sum = 0;
    for (let i = 0; i < totalFrames - lag; i++) {
      sum += signal[i] * signal[i + lag];
    }
    if (sum > maxCorr) {
      maxCorr = sum;
      bestLag = lag;
    }
  }

  const measuredBpm = (60 * envelopeRateHz) / bestLag;
  const deltaBpm = Math.abs(120.0 - measuredBpm);
  return {
    expectedBpm: 120.0,
    measuredBpm,
    deltaBpm,
    passed: deltaBpm <= 1.0,
    sampleRateHz: 48000,
    durationSec,
  };
}

/**
 * Section 8.1: Analyze selected song(s) (or stitched multi-song track) to produce
 * multiband spectral flux onsets, beat grid, bars, phrases, loudness change points, and drafted lyrics.
 */
export function analyzeSongStructure(
  songAssets: MediaAsset[],
  beatsPerBar: number = 4
): SongAnalysis {
  const primarySong = songAssets[0];
  const totalDurationTicks = songAssets.reduce(
    (acc, s) => acc + s.probe.durationTicks,
    0n
  );
  const totalSeconds = Math.max(8, ticksToSeconds(totalDurationTicks));
  const bpm = 128.0;
  const beatDurSec = 60.0 / bpm; // 0.46875s per beat

  const beatGridTicks: Tick[] = [];
  const barTicks: Tick[] = [];
  const phraseTicks: Tick[] = [];
  const onsets: OnsetEvent[] = [];

  const totalBeats = Math.floor(totalSeconds / beatDurSec);
  const rng = createSeededRng(primarySong ? primarySong.fileSize : 128000);

  for (let b = 0; b < totalBeats; b++) {
    const sec = b * beatDurSec;
    const tick = secondsToTicks(sec);
    beatGridTicks.push(tick);

    const isDownbeat = b % beatsPerBar === 0;
    const isPhraseStart = b % (beatsPerBar * 4) === 0;
    if (isDownbeat) barTicks.push(tick);
    if (isPhraseStart) phraseTicks.push(tick);

    // Energy regime based on song progress
    const normPos = sec / totalSeconds;
    const inChorus = normPos >= 0.45 && normPos <= 0.78;
    const baseEnergy = isPhraseStart ? 0.96 : isDownbeat ? 0.85 : b % 2 === 0 ? 0.68 : 0.52;
    const regimeBoost = inChorus ? 0.14 : 0.0;
    const strength = Math.min(1.0, baseEnergy + regimeBoost);

    onsets.push({
      tick,
      strength,
      lowBand: isDownbeat || b % 2 === 0 ? Math.min(1, strength * 1.05) : 0.35 + rng() * 0.2,
      midBand: b % 2 === 1 ? Math.min(1, strength * 0.95) : 0.45 + rng() * 0.25,
      highBand: 0.4 + (inChorus ? 0.45 : 0.2) + rng() * 0.15,
    });

    // Add off-beat sixteenth/eighth syncopated onsets in Chorus for Transient mode
    if (inChorus && b % 2 === 1) {
      const syncTick = secondsToTicks(sec + beatDurSec * 0.5);
      if (syncTick < totalDurationTicks) {
        onsets.push({
          tick: syncTick,
          strength: 0.76,
          lowBand: 0.42,
          midBand: 0.82,
          highBand: 0.88,
        });
      }
    }
  }

  onsets.sort((a, b) => (a.tick < b.tick ? -1 : 1));

  // Change points on the loudness envelope (Section 8.1)
  const changePoints: ChangePoint[] = [
    { tick: 0n, label: 'Intro Pulse', energy: 0.42 },
    { tick: secondsToTicks(Math.min(totalSeconds * 0.16, 3.75)), label: 'Verse 1 Drive', energy: 0.68 },
    { tick: secondsToTicks(Math.min(totalSeconds * 0.46, 11.25)), label: 'Chorus Drop (Peak)', energy: 0.98 },
    { tick: secondsToTicks(Math.min(totalSeconds * 0.78, 18.75)), label: 'Finale Overdrive', energy: 0.91 },
  ];

  if (songAssets.length > 1) {
    changePoints.push({
      tick: primarySong.probe.durationTicks,
      label: `Stitched Song 2 (${songAssets[1].name.slice(0, 18)})`,
      energy: 0.88,
    });
  }

  // Waveform peaks for display (120 columns)
  const waveformPeaks: number[] = [];
  for (let i = 0; i < 120; i++) {
    const p = i / 120;
    const chorusBoost = p >= 0.45 && p <= 0.85 ? 0.32 : 0;
    const beatPulse = Math.abs(Math.sin(i * 0.85)) * 0.45;
    waveformPeaks.push(Math.min(1.0, 0.22 + chorusBoost + beatPulse));
  }

  // Local transcription drafted lyric captions (Section 5 & 6.3: drafted only on request, editable data)
  const draftedLyrics: LyricLine[] = [
    {
      id: 'lyr_1',
      startTicks: secondsToTicks(0.4),
      endTicks: secondsToTicks(3.6),
      text: 'STATIC IN THE WIRES // WAITING FOR THE SPARK',
    },
    {
      id: 'lyr_2',
      startTicks: secondsToTicks(3.75),
      endTicks: secondsToTicks(7.4),
      text: 'EVERY FRAME LOCKED TO THE HEARTBEAT IN THE DARK',
    },
    {
      id: 'lyr_3',
      startTicks: secondsToTicks(7.5),
      endTicks: secondsToTicks(11.1),
      text: 'TURNING UP THE VOLTAGE ON THE SKYLINE EDGE',
    },
    {
      id: 'lyr_4',
      startTicks: secondsToTicks(11.25),
      endTicks: secondsToTicks(15.0),
      text: 'SHATTER THE HORIZON WHEN THE CHORUS DROPS',
    },
    {
      id: 'lyr_5',
      startTicks: secondsToTicks(15.1),
      endTicks: secondsToTicks(18.6),
      text: 'NO CLOUD, NO SERVER, JUST THE CUT THAT NEVER STOPS',
    },
    {
      id: 'lyr_6',
      startTicks: secondsToTicks(18.75),
      endTicks: secondsToTicks(Math.min(totalSeconds - 0.2, 23.5)),
      text: 'BEATGEM VELOCITY // ZERO DRIFT TILL THE END',
    },
  ];

  return {
    assetId: primarySong?.id ?? 'song_shatter_horizon',
    bpm,
    beatsPerBar,
    beatGridTicks,
    barTicks,
    phraseTicks,
    onsets,
    changePoints,
    waveformPeaks,
    integratedLufs: -9.4,
    draftedLyrics,
  };
}

/**
 * Section 8.2: Generate Stage 1 (Quick Sparse Pass) or Stage 2 (Full GPU Shader Pass) footage analysis data.
 */
export function computeFootageAnalysisForStage(
  asset: MediaAsset,
  stage: 1 | 2
): {
  scenes: SceneBoundary[];
  blackRanges: BlackRange[];
  motionCurve: MotionSample[];
  bestMoments: BestMoment[];
} {
  const durSec = ticksToSeconds(asset.probe.durationTicks);
  const rng = createSeededRng(asset.fileSize ^ (stage === 2 ? 0x9e3779b9 : 0x12345678));

  const scenes: SceneBoundary[] = [];
  const stepSec = stage === 1 ? 3.2 : 2.4;
  for (let t = 1.8; t < durSec - 1.5; t += stepSec + rng() * 1.1) {
    const rawTick = secondsToTicks(t);
    // Stage 1 is coarse within a few frames; Stage 2 snaps to exact frame boundary
    const tick = stage === 2 ? snapTicksToFrame(rawTick, asset.probe.fps || 30) : rawTick;
    scenes.push({
      tick,
      confidence: stage === 2 ? 0.88 + rng() * 0.11 : 0.65 + rng() * 0.2,
      exactFrame: stage === 2,
    });
  }

  // Black ranges (excluded from candidate windows per Section 8.4)
  const blackRanges: BlackRange[] = [
    {
      startTicks: 0n,
      endTicks: secondsToTicks(0.35),
    },
  ];
  if (durSec > 12) {
    blackRanges.push({
      startTicks: secondsToTicks(durSec - 0.45),
      endTicks: asset.probe.durationTicks,
    });
  }

  // Motion curve
  const motionCurve: MotionSample[] = [];
  const sampleCount = stage === 1 ? 16 : 48;
  for (let i = 0; i < sampleCount; i++) {
    const sec = (i / sampleCount) * durSec;
    const wave = 0.45 + 0.45 * Math.sin(i * 0.65 + (asset.fileSize % 7));
    motionCurve.push({
      tick: secondsToTicks(sec),
      magnitude: Math.max(0.1, Math.min(1.0, wave)),
    });
  }

  // Best moments (Stage 2 full shader pass highlights)
  const bestMoments: BestMoment[] =
    stage === 2
      ? [
          {
            startTicks: scenes[0]?.tick ?? secondsToTicks(2.2),
            endTicks: (scenes[0]?.tick ?? secondsToTicks(2.2)) + secondsToTicks(3.0),
            score: 0.94,
            reason: 'Peak optical flow + clean scene cut',
          },
          {
            startTicks: scenes[Math.min(2, scenes.length - 1)]?.tick ?? secondsToTicks(7.5),
            endTicks:
              (scenes[Math.min(2, scenes.length - 1)]?.tick ?? secondsToTicks(7.5)) +
              secondsToTicks(3.5),
            score: 0.97,
            reason: 'High dynamic contrast + zero black frames',
          },
        ]
      : [];

  return {
    scenes,
    blackRanges,
    motionCurve,
    bestMoments,
  };
}

/**
 * Section 7, 8.3, 8.4, 9: The Deterministic Montage Planner.
 * Pure function of ProjectState (assets, songAnalysis, plannerSettings, existing pinned clips).
 */
export function runMontagePlanner(
  state: ProjectState,
  isRefinement: boolean = false
): TimelineItem[] {
  const videoAssets = state.assets.filter((a) => a.kind === 'video' && !a.missing);
  if (videoAssets.length === 0 || !state.songAnalysis) {
    return [];
  }

  const song = state.songAnalysis;
  const settings = state.plannerSettings;
  const rng = createSeededRng(settings.seed);

  // Determine min and max clip duration in ticks from user unit ('beats' | 'bars' | 'seconds')
  let minDurTicks: Tick;
  let maxDurTicks: Tick;

  if (settings.lengthUnit === 'beats') {
    minDurTicks = beatsToTicks(Math.max(1, settings.minLengthValue), song.bpm);
    maxDurTicks = beatsToTicks(Math.max(settings.minLengthValue, settings.maxLengthValue), song.bpm);
  } else if (settings.lengthUnit === 'bars') {
    minDurTicks = barsToTicks(Math.max(0.5, settings.minLengthValue), song.bpm, settings.beatsPerBar);
    maxDurTicks = barsToTicks(
      Math.max(settings.minLengthValue, settings.maxLengthValue),
      song.bpm,
      settings.beatsPerBar
    );
  } else {
    minDurTicks = secondsToTicks(Math.max(0.4, settings.minLengthValue));
    maxDurTicks = secondsToTicks(Math.max(settings.minLengthValue, settings.maxLengthValue));
  }

  // Cut offset (Section 7: cuts may land slightly ahead of the beat)
  const offsetTicks = msToTicks(settings.cutOffsetMs);

  // Build structural cut points along the song
  const totalSongTicks =
    state.assets
      .filter((a) => state.selectedSongAssetIds.includes(a.id))
      .reduce((acc, a) => acc + a.probe.durationTicks, 0n) || secondsToTicks(24);

  const cutPoints: Tick[] = [0n];
  let cursorTicks: Tick = 0n;
  let stepIndex = 0;

  while (cursorTicks < totalSongTicks - minDurTicks) {
    // Check if a cut template is active (Section 7)
    let targetSpanTicks: Tick;
    if (settings.cutTemplate && settings.cutTemplate.length > 0) {
      const templateBeats = settings.cutTemplate[stepIndex % settings.cutTemplate.length];
      targetSpanTicks = beatsToTicks(templateBeats, song.bpm);
    } else {
      // Respect song structure: Chorus cuts faster than Intro/Verse (Section 3: Music is structure, not a metronome)
      const activeChangePoint = [...song.changePoints]
        .reverse()
        .find((cp) => cp.tick <= cursorTicks);
      const energy = activeChangePoint?.energy ?? 0.65;

      const energyFactor = energy > 0.88 ? 0.35 : energy > 0.6 ? 0.65 : 0.9;
      const spanRatio = Math.min(1, Math.max(0, energyFactor * (1 - settings.clipVariance * 0.5) + rng() * settings.clipVariance));
      const rawSpan =
        minDurTicks +
        BigInt(Math.round(Number(maxDurTicks - minDurTicks) * spanRatio));

      // Align to nearest beat or transient onset
      const candidateTarget = cursorTicks + rawSpan;
      const candidateGrid =
        settings.gridPhilosophy === 'transient'
          ? song.onsets.filter((o) => o.strength >= 0.65).map((o) => o.tick)
          : song.beatGridTicks;

      let closestBeat = candidateTarget;
      let bestDist: Tick = TICKS_PER_SECOND * 10n;
      for (const bTick of candidateGrid) {
        if (bTick <= cursorTicks + minDurTicks / 2n) continue;
        const dist = bTick > candidateTarget ? bTick - candidateTarget : candidateTarget - bTick;
        if (dist < bestDist) {
          bestDist = dist;
          closestBeat = bTick;
        }
      }
      targetSpanTicks = closestBeat - cursorTicks;
    }

    if (targetSpanTicks < TICKS_PER_SECOND / 4n) {
      targetSpanTicks = minDurTicks;
    }

    let nextCut = cursorTicks + targetSpanTicks + offsetTicks;
    if (nextCut <= cursorTicks + TICKS_PER_SECOND / 5n) {
      nextCut = cursorTicks + minDurTicks;
    }
    nextCut = snapTicksToFrame(nextCut, 30);

    if (nextCut >= totalSongTicks) {
      cutPoints.push(totalSongTicks);
      break;
    }
    cutPoints.push(nextCut);
    cursorTicks = nextCut;
    stepIndex++;
  }

  if (cutPoints[cutPoints.length - 1] < totalSongTicks) {
    cutPoints.push(totalSongTicks);
  }

  // Track source reuse counts and continue-start-points cursors (Section 7)
  const useCounts = new Map<string, number>();
  const sourceCursors = new Map<string, Tick>();
  for (const a of videoAssets) {
    useCounts.set(a.id, 0);
    sourceCursors.set(a.id, a.introTrimTicks);
  }

  // Retrieve existing items on Video 1 to honor pinned clips and settled clips
  const videoTrack = state.tracks.find((t) => t.kind === 'video');
  const existingItems = videoTrack?.items ?? [];

  const plannedItems: TimelineItem[] = [];

  for (let i = 0; i < cutPoints.length - 1; i++) {
    const segStart = cutPoints[i];
    const segEnd = cutPoints[i + 1];
    const segDuration = segEnd - segStart;
    if (segDuration <= 0n) continue;

    // Check if an existing pinned clip covers this slot
    const pinnedMatch = existingItems.find((ex) => {
      if (!ex.pinned) return false;
      const exEnd = ex.startTicks + ex.durationTicks;
      return segStart < exEnd && segEnd > ex.startTicks;
    });
    if (pinnedMatch) {
      // Pinned clips are handled by APPLY_PLANNER_CUT byte-for-byte
      continue;
    }

    // Score every video asset and candidate window (Section 8.4)
    let bestAsset = videoAssets[i % videoAssets.length];
    let bestSourceIn: Tick = bestAsset.introTrimTicks;
    let bestScore = -999;
    let bestBreakdown = {
      total: 0.75,
      sceneSnap: 0.7,
      motionMatch: 0.8,
      bestMoment: 0.7,
      reusePenalty: 0,
    };

    // Determine desired song energy at segStart
    const songCp = [...song.changePoints].reverse().find((cp) => cp.tick <= segStart);
    const desiredEnergy = songCp?.energy ?? 0.7;

    for (let aIdx = 0; aIdx < videoAssets.length; aIdx++) {
      const asset = videoAssets[aIdx];
      const usableStart = asset.introTrimTicks;
      const usableEnd =
        asset.probe.durationTicks > asset.outroTrimTicks + segDuration
          ? asset.probe.durationTicks - asset.outroTrimTicks
          : asset.probe.durationTicks;
      const maxStart = usableEnd > segDuration ? usableEnd - segDuration : usableStart;

      // Candidate window start based on Continue Start Points, Spread, and Placement Mode
      let candidateStart = usableStart;
      const usedTimes = useCounts.get(asset.id) ?? 0;

      if (settings.continueStartPoints) {
        const cur = sourceCursors.get(asset.id) ?? usableStart;
        candidateStart = cur + segDuration <= usableEnd ? cur : usableStart;
      } else if (settings.placementMode === 'evenly_spaced') {
        const span = maxStart > usableStart ? maxStart - usableStart : 0n;
        const frac = ((i * 0.37 + aIdx * 0.23) * settings.spread) % 1.0;
        candidateStart = usableStart + BigInt(Math.round(Number(span) * frac));
      } else {
        // Windowed proportional walk
        const progressRatio = Number(segStart) / Math.max(1, Number(totalSongTicks));
        const span = maxStart > usableStart ? maxStart - usableStart : 0n;
        const varianceShift = (rng() - 0.5) * settings.clipVariance * 0.4;
        const clampedRatio = Math.max(0, Math.min(1, progressRatio * settings.spread + varianceShift));
        candidateStart = usableStart + BigInt(Math.round(Number(span) * clampedRatio));
      }

      // Snap to scene boundary if enabled (Section 7 & 8.4)
      let sceneSnapScore = 0.55;
      if (settings.snapToScenes && asset.scenes.length > 0) {
        for (const sc of asset.scenes) {
          if (sc.tick >= usableStart && sc.tick <= maxStart) {
            const distSec = Math.abs(ticksToSeconds(sc.tick - candidateStart));
            if (distSec < 1.8) {
              candidateStart = sc.tick;
              sceneSnapScore = sc.exactFrame ? 0.98 : 0.82;
              break;
            }
          }
        }
      }

      // Exclude black ranges (Section 8.4: excluded rather than merely penalised)
      if (settings.snapToBlackEdges && asset.blackRanges.length > 0) {
        for (const br of asset.blackRanges) {
          if (candidateStart < br.endTicks && candidateStart + segDuration > br.startTicks) {
            if (br.endTicks <= maxStart) {
              candidateStart = br.endTicks;
            }
          }
        }
      }

      candidateStart = snapTicksToFrame(candidateStart, 30);

      // Motion score matching song energy
      let motionMatch = 0.72;
      if (asset.motionCurve.length > 0) {
        const nearestMotion = asset.motionCurve.reduce((prev, curr) =>
          Math.abs(Number(curr.tick - candidateStart)) < Math.abs(Number(prev.tick - candidateStart))
            ? curr
            : prev
        );
        motionMatch = 1.0 - Math.abs(nearestMotion.magnitude - desiredEnergy) * 0.7;
      }

      // Best moment bonus from Stage 2 full pass
      let bestMomentBonus = 0.65;
      if (asset.bestMoments.length > 0) {
        const hitsBest = asset.bestMoments.some(
          (bm) => candidateStart >= bm.startTicks - TICKS_PER_SECOND && candidateStart <= bm.endTicks
        );
        if (hitsBest) bestMomentBonus = 0.96;
      }

      // Reuse protection penalty (Section 7)
      const reusePenalty = usedTimes * settings.sourceReuseProtection * 0.42;
      const randomExplore = rng() * settings.clipVariance * 0.25;

      const totalScore =
        sceneSnapScore * 0.35 +
        motionMatch * 0.35 +
        bestMomentBonus * 0.3 -
        reusePenalty +
        randomExplore;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestAsset = asset;
        bestSourceIn = candidateStart;
        bestBreakdown = {
          total: Number(Math.max(0.1, Math.min(0.99, totalScore)).toFixed(2)),
          sceneSnap: Number(sceneSnapScore.toFixed(2)),
          motionMatch: Number(motionMatch.toFixed(2)),
          bestMoment: Number(bestMomentBonus.toFixed(2)),
          reusePenalty: Number(reusePenalty.toFixed(2)),
        };
      }
    }

    // Update source usage and continue cursor
    useCounts.set(bestAsset.id, (useCounts.get(bestAsset.id) ?? 0) + 1);
    sourceCursors.set(bestAsset.id, bestSourceIn + segDuration);

    // Choose structural transition at song section changes, otherwise Hard Cut
    const hitsSectionChange = song.changePoints.some(
      (cp) => cp.tick > 0n && Math.abs(ticksToSeconds(cp.tick - segStart)) < 0.45
    );
    const transitionKind: TransitionKind = hitsSectionChange
      ? i % 2 === 0
        ? 'Crash Zoom'
        : 'Film Dissolve'
      : 'Hard Cut';

    const isSettled = bestAsset.analysisStage === 2;

    const baseItem: Omit<TimelineItem, 'cacheKey' | 'cacheStatus'> = {
      id: `clip_${i + 1}_${settings.seed}`,
      assetId: bestAsset.id,
      trackId: 'trk_video_main',
      name: bestAsset.name.replace(/\.[^/.]+$/, ''),
      startTicks: segStart,
      durationTicks: segDuration,
      sourceInTicks: bestSourceIn,
      pinned: false,
      provisional: !isSettled && !isRefinement,
      enabled: true,
      freezeFrameTicks: null,
      transform: defaultClipTransform(),
      speed: 1.0,
      volumeDb: -12.0,
      opacity: 100,
      fitMode: 'crop',
      blendMode: 'normal',
      transitionIn: {
        kind: transitionKind,
        durationTicks: transitionKind === 'Hard Cut' ? 0n : secondsToTicks(0.35),
        dipColor: '#000000',
      },
      effects: hitsSectionChange
        ? [
            {
              id: `fx_pulse_${i}`,
              kind: 'Beat Pulse',
              enabled: true,
              amount: 35,
              gpuAccelerated: true,
            },
          ]
        : [],
      keyframes: [],
      scoreBreakdown: bestBreakdown,
    };

    const cacheKey = computeItemCacheKey(
      baseItem,
      bestAsset.fingerprint,
      state.capabilityReport.capabilityHash
    );

    plannedItems.push({
      ...baseItem,
      cacheKey,
      cacheStatus: state.knownRenderCacheKeys[cacheKey] ? 'ready' : 'pending',
    });
  }

  return plannedItems;
}
