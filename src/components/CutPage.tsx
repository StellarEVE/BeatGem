import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Pin,
  PinOff,
  RefreshCw,
  ArrowRight,
  Share,
  XCircle,
  Sliders,
  Sparkles,
  CopyCheck,
} from 'lucide-react';
import { renderTimelineCompositeFrame } from '../engine/compositorAndOracle';
import {
  Tick,
  formatTicksCompact,
  secondsToTicks,
  ticksToSeconds,
  ticksToTimecode,
} from '../engine/ticks';
import {
  GridPhilosophy,
  LengthUnit,
  PlacementMode,
  PlannerSettings,
  ProjectState,
} from '../engine/types';

interface CutPageProps {
  project: ProjectState;
  playheadTicks: Tick;
  isPlaying: boolean;
  onSetPlayheadTicks: (t: Tick) => void;
  onTogglePlay: () => void;
  onUpdatePlannerSettings: (updates: Partial<PlannerSettings>) => void;
  onRegenerateCut: () => void;
  onTogglePinClip: (itemId: string) => void;
  onCancelAssetAnalysis: (assetId: string) => void;
  onCancelAllAnalysis: () => void;
  onExtractCutTemplate: (name: string) => void;
  onApplyPreset: (presetId: string) => void;
  onExportImmediately: () => void;
  onContinueToEdit: () => void;
  pipelineStatusLine: string;
  pipelineEtaSeconds: number;
  isPipelineRunning: boolean;
  videoElementsMap: Map<string, HTMLVideoElement>;
}

export const CutPage: React.FC<CutPageProps> = ({
  project,
  playheadTicks,
  isPlaying,
  onSetPlayheadTicks,
  onTogglePlay,
  onUpdatePlannerSettings,
  onRegenerateCut,
  onTogglePinClip,
  onCancelAssetAnalysis,
  onCancelAllAnalysis,
  onExtractCutTemplate,
  onApplyPreset,
  onExportImmediately,
  onContinueToEdit,
  pipelineStatusLine,
  pipelineEtaSeconds,
  isPipelineRunning,
  videoElementsMap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoAssets = project.assets.filter((a) => a.kind === 'video' && !a.missing);
  const videoTrack = project.tracks.find((t) => t.kind === 'video');
  const clips = videoTrack?.items ?? [];
  const song = project.songAnalysis;
  const settings = project.plannerSettings;

  const totalDurationTicks =
    clips.length > 0
      ? clips[clips.length - 1].startTicks + clips[clips.length - 1].durationTicks
      : secondsToTicks(24);
  const totalSec = Math.max(1, ticksToSeconds(totalDurationTicks));

  // Weighted overall analysis progress across pool
  const overallProgress =
    videoAssets.length > 0
      ? videoAssets.reduce(
          (acc, v) => acc + v.stage1Progress * 0.35 + v.stage2Progress * 0.65,
          0
        ) / videoAssets.length
      : 1;

  // Render preview canvas whenever playheadTicks or project changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderTimelineCompositeFrame(
      ctx,
      canvas.width,
      canvas.height,
      project,
      playheadTicks,
      videoElementsMap
    );
  }, [project, playheadTicks, videoElementsMap]);

  const pinnedCount = clips.filter((c) => c.pinned).length;
  const provisionalCount = clips.filter((c) => c.provisional && !c.pinned).length;
  const settledCount = clips.filter((c) => !c.provisional || c.pinned).length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0B0D10]">
      {/* Top Status & One-Click Handoff Bar */}
      <div className="flex items-center justify-between gap-6 px-6 py-3.5 bg-[#11141A] border-b border-[#262C36] shrink-0">
        <div>
          <h1 className="text-lg font-bold text-[#E2E8F0] font-display">
            02. Beat Engine & Staged Montage Planner
          </h1>
          <div className="flex items-center gap-3 text-xs text-[#94A3B8] mt-0.5">
            <span className="text-[#14B8A6] font-medium">{pipelineStatusLine}</span>
            {isPipelineRunning && (
              <>
                <span>·</span>
                <span className="font-mono">ETA {pipelineEtaSeconds}s</span>
              </>
            )}
            <span>·</span>
            <span className="font-mono">
              {settledCount} Settled / {provisionalCount} Provisional (Hatched) / {pinnedCount} Pinned
            </span>
          </div>
        </div>

        {/* One-Click Onward Actions (Section 6.2) */}
        <div className="flex items-center gap-3">
          <button
            onClick={onRegenerateCut}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] border border-[#262C36] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#14B8A6]" />
            <span>Rerun Planner ({pinnedCount} Pinned Protected)</span>
          </button>

          <button
            onClick={onExportImmediately}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] border border-[#262C36] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Share className="w-3.5 h-3.5 text-[#14B8A6]" />
            <span>Export Cut Immediately</span>
          </button>

          <button
            onClick={onContinueToEdit}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#0B0D10] bg-[#14B8A6] hover:bg-teal-400 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Continue to Edit Page</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Upper Split: Left = Generation Controls (5 cols), Center/Right = Synced Preview + Staged Pipeline (7 cols) */}
      <div className="flex-1 grid grid-cols-12 gap-5 px-6 pt-4 pb-2 min-h-0 overflow-hidden">
        {/* Left: Planner Generation Controls (Section 7) */}
        <div className="col-span-5 flex flex-col min-h-0 bg-[#11141A] border border-[#262C36] rounded-md overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#171B22] border-b border-[#262C36]">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#14B8A6]" />
              <h2 className="text-xs font-bold text-[#E2E8F0]">
                Generation Controls & Deterministic Seed
              </h2>
            </div>

            {/* Planner Preset Quick Loader */}
            <select
              onChange={(e) => {
                if (e.target.value) onApplyPreset(e.target.value);
              }}
              defaultValue=""
              className="bg-[#0B0D10] border border-[#262C36] text-xs text-[#E2E8F0] rounded px-2 py-1"
            >
              <option value="" disabled>
                Load Planner Preset...
              </option>
              {project.presets
                .filter((p) => p.category === 'planner')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
            {/* Deterministic Seed & Grid Philosophy */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <label className="block text-[11px] text-[#94A3B8] mb-1">
                  Deterministic Seed (Byte-for-Byte)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={settings.seed}
                    onChange={(e) =>
                      onUpdatePlannerSettings({ seed: parseInt(e.target.value || '1', 10) })
                    }
                    className="w-full bg-[#171B22] border border-[#262C36] rounded px-2 py-1 font-mono text-xs text-[#14B8A6]"
                  />
                  <button
                    onClick={() =>
                      onUpdatePlannerSettings({
                        seed: Math.floor(100000 + Math.random() * 899999),
                      })
                    }
                    className="px-2 py-1 bg-[#171B22] hover:bg-[#262C36] border border-[#262C36] rounded text-[11px] text-[#E2E8F0] cursor-pointer"
                    title="Roll a new explicit seed"
                  >
                    Roll
                  </button>
                </div>
              </div>

              <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <label className="block text-[11px] text-[#94A3B8] mb-1">
                  Beat Grid Philosophy (Sec 8.1)
                </label>
                <div className="grid grid-cols-2 gap-1 bg-[#171B22] p-0.5 rounded">
                  {(['transient', 'grid'] as GridPhilosophy[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => onUpdatePlannerSettings({ gridPhilosophy: mode })}
                      className={`py-1 rounded text-[11px] font-medium capitalize cursor-pointer ${
                        settings.gridPhilosophy === mode
                          ? 'bg-[#14B8A6] text-[#0B0D10] font-semibold'
                          : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Min / Max Clip Length in Beats, Bars, or Seconds */}
            <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#94A3B8]">
                  Min / Max Clip Length & Musical Unit
                </span>
                <div className="flex items-center gap-1 bg-[#171B22] p-0.5 rounded">
                  {(['beats', 'bars', 'seconds'] as LengthUnit[]).map((u) => (
                    <button
                      key={u}
                      onClick={() => onUpdatePlannerSettings({ lengthUnit: u })}
                      className={`px-2 py-0.5 rounded text-[11px] capitalize cursor-pointer ${
                        settings.lengthUnit === u
                          ? 'bg-[#14B8A6] text-[#0B0D10] font-semibold'
                          : 'text-[#94A3B8]'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-[11px] text-[#94A3B8]">
                    <span>Min Length</span>
                    <span className="font-mono text-[#E2E8F0]">
                      {settings.minLengthValue} {settings.lengthUnit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={1}
                    value={settings.minLengthValue}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      onUpdatePlannerSettings({
                        minLengthValue: val,
                        maxLengthValue: Math.max(val, settings.maxLengthValue),
                      });
                    }}
                    className="w-full accent-[#14B8A6] cursor-pointer mt-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-[#94A3B8]">
                    <span>Max Length</span>
                    <span className="font-mono text-[#E2E8F0]">
                      {settings.maxLengthValue} {settings.lengthUnit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={settings.maxLengthValue}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      onUpdatePlannerSettings({
                        maxLengthValue: Math.max(settings.minLengthValue, val),
                      });
                    }}
                    className="w-full accent-[#14B8A6] cursor-pointer mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Sliders: Clip Variance, Source Reuse Protection, Spread, Cut Offset */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#94A3B8]">Clip Variance</span>
                  <span className="font-mono text-[#14B8A6]">
                    {Math.round(settings.clipVariance * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.clipVariance}
                  onChange={(e) =>
                    onUpdatePlannerSettings({ clipVariance: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[#14B8A6] cursor-pointer mt-1"
                />
              </div>

              <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#94A3B8]">Reuse Protection</span>
                  <span className="font-mono text-[#14B8A6]">
                    {Math.round(settings.sourceReuseProtection * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.sourceReuseProtection}
                  onChange={(e) =>
                    onUpdatePlannerSettings({
                      sourceReuseProtection: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-[#14B8A6] cursor-pointer mt-1"
                />
              </div>

              <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#94A3B8]">Source Spread</span>
                  <span className="font-mono text-[#14B8A6]">
                    {Math.round(settings.spread * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={settings.spread}
                  onChange={(e) =>
                    onUpdatePlannerSettings({ spread: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[#14B8A6] cursor-pointer mt-1"
                />
              </div>

              <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#94A3B8]">Cut Offset (Lead Beat)</span>
                  <span className="font-mono text-[#14B8A6]">{settings.cutOffsetMs} ms</span>
                </div>
                <input
                  type="range"
                  min={-80}
                  max={40}
                  step={4}
                  value={settings.cutOffsetMs}
                  onChange={(e) =>
                    onUpdatePlannerSettings({ cutOffsetMs: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-[#14B8A6] cursor-pointer mt-1"
                />
              </div>
            </div>

            {/* Placement Mode, Snap Switches & Cut Template Extractor */}
            <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#94A3B8]">Placement Mode</span>
                <select
                  value={settings.placementMode}
                  onChange={(e) =>
                    onUpdatePlannerSettings({
                      placementMode: e.target.value as PlacementMode,
                    })
                  }
                  className="bg-[#171B22] border border-[#262C36] rounded px-2 py-1 text-xs text-[#E2E8F0]"
                >
                  <option value="windowed_proportional">Windowed Proportional Walk</option>
                  <option value="evenly_spaced">Evenly Spaced Source Windows</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.continueStartPoints}
                    onChange={(e) =>
                      onUpdatePlannerSettings({ continueStartPoints: e.target.checked })
                    }
                    className="accent-[#14B8A6]"
                  />
                  <span className="text-[11px] text-[#E2E8F0]">Continue Start Points</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.snapToScenes}
                    onChange={(e) =>
                      onUpdatePlannerSettings({ snapToScenes: e.target.checked })
                    }
                    className="accent-[#14B8A6]"
                  />
                  <span className="text-[11px] text-[#E2E8F0]">Snap to Scenes</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.snapToBlackEdges}
                    onChange={(e) =>
                      onUpdatePlannerSettings({ snapToBlackEdges: e.target.checked })
                    }
                    className="accent-[#14B8A6]"
                  />
                  <span className="text-[11px] text-[#E2E8F0]">Avoid Black Ranges</span>
                </label>
              </div>

              {/* Cut Template Extractor (Section 7) */}
              <div className="flex items-center justify-between pt-2 border-t border-[#262C36]">
                <div className="text-[11px] text-[#94A3B8]">
                  Cut Template:{' '}
                  <span className="font-mono text-[#E2E8F0]">
                    {settings.cutTemplateName ?? 'Dynamic Song Structure'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onExtractCutTemplate(`Pattern_${clips.length}Cuts`)}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-[#171B22] hover:bg-[#262C36] border border-[#262C36] rounded text-[11px] text-[#14B8A6] cursor-pointer"
                  >
                    <CopyCheck className="w-3 h-3" />
                    <span>Extract Current Pattern</span>
                  </button>
                  {settings.cutTemplate && (
                    <button
                      onClick={() =>
                        onUpdatePlannerSettings({ cutTemplate: null, cutTemplateName: null })
                      }
                      className="px-2 py-1 bg-[#171B22] border border-[#262C36] rounded text-[11px] text-[#94A3B8] cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Synced Cut Preview Player + Staged Analysis Per-Asset Progress */}
        <div className="col-span-7 flex flex-col gap-4 min-h-0">
          {/* Preview Player */}
          <div className="flex-1 bg-[#11141A] border border-[#262C36] rounded-md flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between px-4 py-2 bg-[#171B22] border-b border-[#262C36]">
              <span className="text-xs font-semibold text-[#E2E8F0]">
                Beat-Synced Cut Preview (WGPU / Canvas Compositor)
              </span>
              <span className="text-xs font-mono text-[#14B8A6]">
                {ticksToTimecode(playheadTicks, 30)} / {ticksToTimecode(totalDurationTicks, 30)}
              </span>
            </div>

            <div className="flex-1 flex items-center justify-center bg-[#07090C] p-2 min-h-0">
              <canvas
                ref={canvasRef}
                width={640}
                height={360}
                className="max-h-full max-w-full aspect-video rounded border border-[#262C36] shadow-lg"
              />
            </div>

            {/* Transport Controls */}
            <div className="flex items-center gap-4 px-4 py-2.5 bg-[#171B22] border-t border-[#262C36]">
              <button
                onClick={onTogglePlay}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#14B8A6] text-[#0B0D10] hover:bg-teal-400 cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play with synced beat synth'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              </button>

              <button
                onClick={() => onSetPlayheadTicks(0n)}
                className="p-1.5 text-[#94A3B8] hover:text-[#E2E8F0] rounded-md cursor-pointer"
                title="Return to start (00:00:00:00)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <input
                type="range"
                min={0}
                max={Number(totalSec.toFixed(2))}
                step={0.03}
                value={Number(ticksToSeconds(playheadTicks).toFixed(2))}
                onChange={(e) => onSetPlayheadTicks(secondsToTicks(parseFloat(e.target.value)))}
                className="flex-1 accent-[#14B8A6] cursor-pointer"
              />
            </div>
          </div>

          {/* Staged Footage Analysis Pipeline (Section 8.2 & 8.3: Breadth before Depth) */}
          <div className="h-44 bg-[#11141A] border border-[#262C36] rounded-md flex flex-col overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-4 py-2 bg-[#171B22] border-b border-[#262C36]">
              <div className="flex items-center gap-2 text-xs">
                <Sparkles className="w-3.5 h-3.5 text-[#14B8A6]" />
                <span className="font-semibold text-[#E2E8F0]">
                  Staged Footage Pipeline (Breadth-First Stage 1 &rarr; Priority Stage 2 Shaders)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-[#14B8A6]">
                  Overall {Math.round(overallProgress * 100)}%
                </span>
                {isPipelineRunning && (
                  <button
                    onClick={onCancelAllAnalysis}
                    className="text-[11px] text-red-400 hover:text-red-300 cursor-pointer"
                  >
                    Cancel Stage
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2.5">
              {videoAssets.map((v) => (
                <div
                  key={v.id}
                  className="px-3 py-2 bg-[#0B0D10] border border-[#262C36] rounded-md flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#E2E8F0] truncate max-w-[170px]">
                      {v.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-[#94A3B8]">
                        {v.cancelled
                          ? 'Cancelled'
                          : v.analysisStage === 2
                          ? 'Stage 2 Settled (1.00)'
                          : v.analysisStage === 1
                          ? `Refining ${(v.stage2Progress * 100).toFixed(0)}%`
                          : `Quick Pass ${(v.stage1Progress * 100).toFixed(0)}%`}
                      </span>
                      {!v.cancelled && v.analysisStage < 2 && (
                        <button
                          onClick={() => onCancelAssetAnalysis(v.id)}
                          title="Cancel analysis for this asset"
                          className="text-[#64748B] hover:text-red-400 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Dual Stage Progress Bar */}
                  <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                    <div>
                      <div className="h-1.5 bg-[#171B22] rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-amber-400 transition-all duration-150"
                          style={{ width: `${Math.round(v.stage1Progress * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-[#64748B] font-mono">S1 Quick</span>
                    </div>
                    <div>
                      <div className="h-1.5 bg-[#171B22] rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-[#14B8A6] transition-all duration-150"
                          style={{ width: `${Math.round(v.stage2Progress * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-[#64748B] font-mono">S2 Shader</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Strip: Beat Engine Grid + Provisional/Settled Cut Strip with Pin Toggles */}
      <div className="h-44 mx-6 mb-4 bg-[#11141A] border border-[#262C36] rounded-md flex flex-col overflow-hidden shrink-0">
        <div className="flex items-center justify-between px-4 py-2 bg-[#171B22] border-b border-[#262C36] text-xs">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-[#E2E8F0]">
              Beat Grid & Provisional / Settled Cut Strip
            </span>
            <span className="text-[#94A3B8]">
              Click any clip&apos;s Pin icon to lock it permanently against Stage 2 refinement or re-generation
            </span>
          </div>
          <span className="font-mono text-[#14B8A6]">
            {clips.length} Cuts Synced to {song?.bpm.toFixed(1) ?? '128.0'} BPM
          </span>
        </div>

        {/* Interactive Beat & Clip Strip */}
        <div
          className="flex-1 relative overflow-x-auto overflow-y-hidden p-3 flex flex-col justify-between select-none"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onSetPlayheadTicks(secondsToTicks(ratio * totalSec));
          }}
        >
          {/* Change Point & Multiband Onset Strip */}
          <div className="h-8 relative bg-[#0B0D10] border border-[#262C36] rounded-sm overflow-hidden">
            {song?.changePoints.map((cp, idx) => {
              const leftPct = (ticksToSeconds(cp.tick) / totalSec) * 100;
              return (
                <div
                  key={idx}
                  className="absolute top-0 bottom-0 border-l border-[#14B8A6] px-1.5 flex items-center text-[10px] font-mono text-[#14B8A6] bg-[#14B8A6]/10"
                  style={{ left: `${leftPct}%` }}
                >
                  {cp.label}
                </div>
              );
            })}
            {song?.onsets.map((onset, idx) => {
              const leftPct = (ticksToSeconds(onset.tick) / totalSec) * 100;
              if (leftPct > 100) return null;
              return (
                <div
                  key={idx}
                  className="absolute bottom-0 w-[2px] bg-[#14B8A6]/70"
                  style={{
                    left: `${leftPct}%`,
                    height: `${Math.round(onset.strength * 100)}%`,
                  }}
                />
              );
            })}
          </div>

          {/* Generated Clips Strip (Provisional = dimmed & hatched; Pinned = Teal badge) */}
          <div className="h-16 relative bg-[#0B0D10] border border-[#262C36] rounded-sm overflow-hidden flex">
            {clips.map((clip) => {
              const leftPct = (ticksToSeconds(clip.startTicks) / totalSec) * 100;
              const widthPct = Math.max(
                1.5,
                (ticksToSeconds(clip.durationTicks) / totalSec) * 100
              );
              const isProvisional = clip.provisional && !clip.pinned;

              return (
                <div
                  key={clip.id}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                  className={`absolute top-0 bottom-0 border-r border-[#0B0D10] px-2 py-1.5 flex flex-col justify-between transition-all ${
                    clip.pinned
                      ? 'bg-teal-950/80 border-t-2 border-t-[#14B8A6]'
                      : isProvisional
                      ? 'provisional-hatch opacity-80 border-t-2 border-t-amber-400'
                      : 'bg-[#171B22] border-t-2 border-t-emerald-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold text-[#E2E8F0] truncate">
                      {clip.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePinClip(clip.id);
                      }}
                      title={
                        clip.pinned
                          ? 'Pinned: Protected from regeneration and refinement'
                          : 'Click to pin clip'
                      }
                      className={`p-1 rounded transition-colors cursor-pointer ${
                        clip.pinned
                          ? 'bg-[#14B8A6] text-[#0B0D10]'
                          : 'bg-[#0B0D10]/70 text-[#94A3B8] hover:text-[#E2E8F0]'
                      }`}
                    >
                      {clip.pinned ? (
                        <Pin className="w-3 h-3" />
                      ) : (
                        <PinOff className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[#94A3B8] truncate">
                    <span>
                      {clip.pinned
                        ? 'PINNED'
                        : isProvisional
                        ? 'PROVISIONAL'
                        : 'SETTLED'}
                    </span>
                    <span>{formatTicksCompact(clip.durationTicks)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Playhead Vertical Line */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-[#14B8A6] pointer-events-none z-20"
            style={{
              left: `${Math.min(100, (ticksToSeconds(playheadTicks) / totalSec) * 100)}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
};
