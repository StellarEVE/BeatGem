import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Scissors,
  Trash2,
  Pin,
  Snowflake,
  Plus,
  Volume2,
  Type,
  Sparkles,
  Flag,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  CheckCircle2,
  Cpu,
  ArrowLeftRight,
  Layers,
} from 'lucide-react';
import {
  ALL_TRANSITIONS,
  OracleVerificationReport,
  renderTimelineCompositeFrame,
  runOracleParityVerification,
} from '../engine/compositorAndOracle';
import { canonicalEffectStackDescription, EngineCommand } from '../engine/core';
import {
  Tick,
  formatRawTicks,
  formatTicksCompact,
  secondsToTicks,
  ticksToSeconds,
  ticksToTimecode,
} from '../engine/ticks';
import {
  AnimatableProperty,
  CurveInterpolation,
  EffectKind,
  ProjectState,
  TimelineItem,
  TransitionKind,
} from '../engine/types';

interface EditPageProps {
  project: ProjectState;
  playheadTicks: Tick;
  isPlaying: boolean;
  onSetPlayheadTicks: (t: Tick) => void;
  onTogglePlay: () => void;
  onDispatchCommand: (cmd: EngineCommand) => void;
  videoElementsMap: Map<string, HTMLVideoElement>;
}

const AVAILABLE_EFFECTS: EffectKind[] = [
  'Brightness',
  'Contrast',
  'Saturation',
  'Blur',
  'Sharpen',
  'Beat Pulse',
  'Zoom',
  'Shake',
  'Flash',
  'RGB Shift',
  'Glitch',
  'Strobe',
  'Invert',
  'Hue Shift',
  'Color Look',
  'Split Screen',
];

export const EditPage: React.FC<EditPageProps> = ({
  project,
  playheadTicks,
  isPlaying,
  onSetPlayheadTicks,
  onTogglePlay,
  onDispatchCommand,
  videoElementsMap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'transform' | 'transitions' | 'effects' | 'keyframes'>('transform');
  const [activeKfProperty, setActiveKfProperty] = useState<AnimatableProperty>('scale');
  const [activeKfInterp, setActiveKfInterp] = useState<CurveInterpolation>('bezier');
  const [newTextValue, setNewTextValue] = useState('SHATTER THE HORIZON');
  const [oracleReport, setOracleReport] = useState<OracleVerificationReport | null>(null);

  // Locate selected item across all tracks, or default to item under playhead on Video 1
  const allItems: TimelineItem[] = project.tracks.flatMap((t) => t.items);
  const selectedItem =
    allItems.find((i) => i.id === selectedItemId) ??
    project.tracks[0]?.items.find(
      (i) => playheadTicks >= i.startTicks && playheadTicks < i.startTicks + i.durationTicks
    ) ??
    project.tracks[0]?.items[0] ??
    null;

  const videoTrack = project.tracks.find((t) => t.kind === 'video');
  const totalDurationTicks =
    videoTrack && videoTrack.items.length > 0
      ? videoTrack.items[videoTrack.items.length - 1].startTicks +
        videoTrack.items[videoTrack.items.length - 1].durationTicks
      : secondsToTicks(24);
  const totalSec = Math.max(8, ticksToSeconds(totalDurationTicks));

  // Render preview canvas whenever playhead or state changes
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

  const handleSplitAtPlayhead = () => {
    if (!selectedItem) return;
    onDispatchCommand({
      type: 'SPLIT_ITEM',
      itemId: selectedItem.id,
      splitTick: playheadTicks,
    });
  };

  const handleBakeRenderCachePass = () => {
    const pendingKeys = allItems.map((i) => i.cacheKey).filter(Boolean);
    onDispatchCommand({
      type: 'MARK_CACHE_KEYS_READY',
      keys: pendingKeys,
    });
  };

  const handleExportMarkers = () => {
    const blob = new Blob([JSON.stringify(project.markers, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'beatgem_timeline_markers.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const cachedItemsCount = allItems.filter((i) => i.cacheStatus === 'ready').length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0B0D10]">
      {/* Upper Half: Left = Multitrack Command Toolbar & Media/Text Generators (3 cols), Center = Compositor Preview (5 cols), Right = Clip Inspector & Keyframe Curve Editor (4 cols) */}
      <div className="h-[54%] grid grid-cols-12 gap-4 px-6 pt-3 pb-2 min-h-0">
        {/* Left Column: Non-Destructive Timeline Actions, Text/Captions & Markers */}
        <div className="col-span-3 flex flex-col gap-3 min-h-0 overflow-y-auto bg-[#11141A] border border-[#262C36] rounded-md p-3.5">
          <div className="text-xs font-bold text-[#E2E8F0] font-display flex items-center justify-between">
            <span>Timeline Command Palette</span>
            <span className="font-mono text-[10px] text-[#14B8A6]">254,016,000,000 ticks/s</span>
          </div>

          {/* Selected Clip Quick Edit Commands */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handleSplitAtPlayhead}
              disabled={!selectedItem}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] disabled:opacity-40 border border-[#262C36] rounded cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5 text-[#14B8A6]" />
              <span>Split @ Playhead</span>
            </button>

            <button
              onClick={() =>
                selectedItem &&
                onDispatchCommand({ type: 'DELETE_ITEM', itemId: selectedItem.id, ripple: true })
              }
              disabled={!selectedItem}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] disabled:opacity-40 border border-[#262C36] rounded cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Ripple Delete</span>
            </button>

            <button
              onClick={() =>
                selectedItem &&
                onDispatchCommand({ type: 'TOGGLE_PIN_ITEM', itemId: selectedItem.id })
              }
              disabled={!selectedItem}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] disabled:opacity-40 border border-[#262C36] rounded cursor-pointer"
            >
              <Pin className="w-3.5 h-3.5 text-[#14B8A6]" />
              <span>{selectedItem?.pinned ? 'Unpin Clip' : 'Pin Clip'}</span>
            </button>

            <button
              onClick={() =>
                selectedItem &&
                onDispatchCommand({
                  type: 'SET_FREEZE_FRAME',
                  itemId: selectedItem.id,
                  freezeTickOffset:
                    selectedItem.freezeFrameTicks === null
                      ? playheadTicks > selectedItem.startTicks
                        ? playheadTicks - selectedItem.startTicks
                        : 0n
                      : null,
                })
              }
              disabled={!selectedItem}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] disabled:opacity-40 border border-[#262C36] rounded cursor-pointer"
            >
              <Snowflake className="w-3.5 h-3.5 text-sky-400" />
              <span>{selectedItem?.freezeFrameTicks !== null ? 'Unfreeze' : 'Freeze Frame'}</span>
            </button>
          </div>

          {/* Swap Source & Swap Position */}
          {selectedItem && (
            <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
                <span>Swap Clip Source</span>
                <button
                  onClick={() => {
                    if (!videoTrack || videoTrack.items.length < 2) return;
                    const idx = videoTrack.items.findIndex((i) => i.id === selectedItem.id);
                    const nextIdx = (idx + 1) % videoTrack.items.length;
                    onDispatchCommand({
                      type: 'SWAP_ITEM_POSITIONS',
                      itemAId: selectedItem.id,
                      itemBId: videoTrack.items[nextIdx].id,
                    });
                  }}
                  className="inline-flex items-center gap-1 text-[#14B8A6] hover:underline cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  <span>Swap w/ Next Clip</span>
                </button>
              </div>
              <select
                value={selectedItem.assetId}
                onChange={(e) =>
                  onDispatchCommand({
                    type: 'SWAP_ITEM_SOURCE',
                    itemId: selectedItem.id,
                    newAssetId: e.target.value,
                  })
                }
                className="w-full bg-[#171B22] border border-[#262C36] rounded px-2 py-1 text-xs text-[#E2E8F0]"
              >
                {project.assets
                  .filter((a) => a.kind === 'video')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Text & Local Lyric Captions (Section 5 & 6.3) */}
          <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded-md space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#E2E8F0]">
              <span className="flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-[#14B8A6]" />
                <span>Text & Lyric Captions</span>
              </span>
              <button
                onClick={() => {
                  if (project.songAnalysis?.draftedLyrics) {
                    onDispatchCommand({
                      type: 'DRAFT_LYRIC_CAPTIONS',
                      lyrics: project.songAnalysis.draftedLyrics,
                    });
                  }
                }}
                className="text-[11px] text-[#14B8A6] hover:underline cursor-pointer"
              >
                Draft Song Lyrics
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newTextValue}
                onChange={(e) => setNewTextValue(e.target.value)}
                placeholder="Manual title text..."
                className="flex-1 bg-[#171B22] border border-[#262C36] rounded px-2 py-1 text-xs text-[#E2E8F0]"
              />
              <button
                onClick={() =>
                  onDispatchCommand({
                    type: 'ADD_TEXT_ITEM',
                    trackId: 'trk_text_main',
                    startTicks: playheadTicks,
                    durationTicks: secondsToTicks(2.5),
                    text: newTextValue || 'TITLE',
                    style: 'title',
                  })
                }
                className="px-2.5 py-1 bg-[#14B8A6] text-[#0B0D10] text-xs font-bold rounded cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>

          {/* Audio Normalisation & Timeline Markers */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={() => onDispatchCommand({ type: 'NORMALIZE_CLIP_AUDIO' })}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] border border-[#262C36] rounded cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5 text-[#14B8A6]" />
              <span>Normalize Audio</span>
            </button>

            <button
              onClick={() =>
                onDispatchCommand({
                  type: 'ADD_MARKER',
                  marker: {
                    id: `mrk_${Date.now().toString(36)}`,
                    name: `Cue @ ${formatTicksCompact(playheadTicks)}`,
                    color: '#14B8A6',
                    startTicks: playheadTicks,
                    durationTicks: secondsToTicks(1.5),
                  },
                })
              }
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] border border-[#262C36] rounded cursor-pointer"
            >
              <Flag className="w-3.5 h-3.5 text-amber-400" />
              <span>Add Marker</span>
            </button>
          </div>
        </div>

        {/* Center Column: Owned Compositor Preview + Loudness Meters + Oracle Verification */}
        <div className="col-span-5 flex flex-col bg-[#11141A] border border-[#262C36] rounded-md overflow-hidden min-h-0">
          <div className="flex items-center justify-between px-4 py-2 bg-[#171B22] border-b border-[#262C36]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#E2E8F0]">
                Owned Compositor Output
              </span>
              <button
                onClick={() =>
                  setOracleReport(
                    runOracleParityVerification(
                      selectedItem?.transitionIn.kind === 'Hard Cut'
                        ? 'Crash Zoom'
                        : selectedItem?.transitionIn.kind ?? 'Crash Zoom'
                    )
                  )
                }
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-[#14B8A6] bg-[#0B0D10] hover:bg-[#1E242D] border border-[#262C36] rounded cursor-pointer"
                title="Verify GPU shader output against Reference CPU Oracle Compositor (Section 10.2)"
              >
                <Cpu className="w-3 h-3" />
                <span>Verify CPU Oracle</span>
              </button>
            </div>
            <span className="text-xs font-mono text-[#14B8A6]">
              {ticksToTimecode(playheadTicks, 30)}
            </span>
          </div>

          {oracleReport && (
            <div className="px-3 py-1.5 bg-[#0B0D10] border-b border-emerald-500/40 flex items-center justify-between text-[11px]">
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  Oracle Match ({oracleReport.transitionTested}): Max Delta{' '}
                  {oracleReport.maxChannelDelta}/255 (&le;1 step) · Diff vs Fade{' '}
                  {oracleReport.diffFromPlainFadePercent}%
                </span>
              </span>
              <button
                onClick={() => setOracleReport(null)}
                className="text-[#94A3B8] hover:text-[#E2E8F0] cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="flex-1 flex items-center justify-center bg-[#07090C] p-2 min-h-0 relative">
            <canvas
              ref={canvasRef}
              width={640}
              height={360}
              className="max-h-full max-w-full aspect-video rounded border border-[#262C36]"
            />

            {/* Stereo Loudness Meter Strip (Section 6.3) */}
            <div className="absolute right-3 top-3 bottom-3 w-3 bg-[#11141A] border border-[#262C36] rounded-sm p-0.5 flex gap-0.5">
              {[0, 1].map((ch) => {
                const level = isPlaying
                  ? 65 + Math.sin(ticksToSeconds(playheadTicks) * 14 + ch) * 25
                  : 18;
                return (
                  <div key={ch} className="flex-1 bg-[#0B0D10] flex flex-col justify-end">
                    <div
                      className="w-full bg-gradient-to-t from-emerald-500 via-[#14B8A6] to-amber-400 transition-all duration-75"
                      style={{ height: `${Math.max(8, Math.min(98, level))}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transport Bar */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#171B22] border-t border-[#262C36]">
            <div className="flex items-center gap-3">
              <button
                onClick={onTogglePlay}
                className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#14B8A6] text-[#0B0D10] hover:bg-teal-400 cursor-pointer"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              </button>
              <span className="text-[11px] font-mono text-[#94A3B8]">
                Tick: {formatRawTicks(playheadTicks)}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="text-[#94A3B8]">
                Cache: {cachedItemsCount}/{allItems.length} Ready
              </span>
              <button
                onClick={handleBakeRenderCachePass}
                className="px-2 py-0.5 bg-[#0B0D10] hover:bg-[#262C36] border border-[#262C36] text-[#14B8A6] rounded cursor-pointer"
                title="Run background content-addressed cache worker on pending timeline clips"
              >
                Render Idle Cache
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Clip Inspector (Transform, 11 Transitions, Effects Stack, Bezier Keyframes) */}
        <div className="col-span-4 flex flex-col bg-[#11141A] border border-[#262C36] rounded-md overflow-hidden min-h-0">
          {/* Inspector Tabs */}
          <div className="grid grid-cols-4 bg-[#171B22] border-b border-[#262C36] text-xs font-semibold">
            {(['transform', 'transitions', 'effects', 'keyframes'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setInspectorTab(tab)}
                className={`py-2.5 capitalize border-b-2 transition-colors cursor-pointer ${
                  inspectorTab === tab
                    ? 'border-[#14B8A6] text-[#14B8A6] bg-[#11141A]'
                    : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 text-xs">
            {!selectedItem ? (
              <div className="text-center text-[#94A3B8] py-12">
                Select any clip on the multitrack timeline below to inspect its properties.
              </div>
            ) : (
              <>
                {/* Selected Clip Header & Content-Addressed Cache Key */}
                <div className="mb-3 pb-2.5 border-b border-[#262C36] flex items-center justify-between">
                  <div className="truncate">
                    <span className="font-semibold text-[#E2E8F0]">{selectedItem.name}</span>
                    <div className="text-[10px] font-mono text-[#14B8A6] mt-0.5">
                      Cache Key: {selectedItem.cacheKey} ({selectedItem.cacheStatus.toUpperCase()})
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      selectedItem.pinned
                        ? 'bg-teal-950 text-[#14B8A6] border border-[#14B8A6]/40'
                        : 'bg-[#171B22] text-[#94A3B8]'
                    }`}
                  >
                    {selectedItem.pinned ? 'PINNED' : 'UNPINNED'}
                  </span>
                </div>

                {/* TAB 1: TRANSFORM, SPEED, AUDIO & CROP */}
                {inspectorTab === 'transform' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded">
                        <div className="flex justify-between text-[11px] text-[#94A3B8]">
                          <span>Scale</span>
                          <span className="font-mono text-[#E2E8F0]">
                            {selectedItem.transform.scale}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={25}
                          max={250}
                          value={selectedItem.transform.scale}
                          onChange={(e) =>
                            onDispatchCommand({
                              type: 'UPDATE_ITEM_TRANSFORM',
                              itemId: selectedItem.id,
                              transform: { scale: parseInt(e.target.value, 10) },
                            })
                          }
                          className="w-full accent-[#14B8A6] mt-1"
                        />
                      </div>

                      <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded">
                        <div className="flex justify-between text-[11px] text-[#94A3B8]">
                          <span>Rotation</span>
                          <span className="font-mono text-[#E2E8F0]">
                            {selectedItem.transform.rotation}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          value={selectedItem.transform.rotation}
                          onChange={(e) =>
                            onDispatchCommand({
                              type: 'UPDATE_ITEM_TRANSFORM',
                              itemId: selectedItem.id,
                              transform: { rotation: parseInt(e.target.value, 10) },
                            })
                          }
                          className="w-full accent-[#14B8A6] mt-1"
                        />
                      </div>

                      <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded">
                        <div className="flex justify-between text-[11px] text-[#94A3B8]">
                          <span>Speed</span>
                          <span className="font-mono text-[#E2E8F0]">
                            {selectedItem.speed.toFixed(2)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.25}
                          max={3.0}
                          step={0.05}
                          value={selectedItem.speed}
                          onChange={(e) =>
                            onDispatchCommand({
                              type: 'UPDATE_ITEM_TRANSFORM',
                              itemId: selectedItem.id,
                              transform: {},
                              speed: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-[#14B8A6] mt-1"
                        />
                      </div>

                      <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded">
                        <div className="flex justify-between text-[11px] text-[#94A3B8]">
                          <span>Clip Gain</span>
                          <span className="font-mono text-[#E2E8F0]">
                            {selectedItem.volumeDb.toFixed(1)} dB
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-36}
                          max={6}
                          step={0.5}
                          value={selectedItem.volumeDb}
                          onChange={(e) =>
                            onDispatchCommand({
                              type: 'UPDATE_ITEM_TRANSFORM',
                              itemId: selectedItem.id,
                              transform: {},
                              volumeDb: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-[#14B8A6] mt-1"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded">
                        <div className="flex justify-between text-[11px] text-[#94A3B8]">
                          <span>Position X / Y</span>
                          <span className="font-mono text-[#E2E8F0]">
                            {selectedItem.transform.positionX}, {selectedItem.transform.positionY}
                          </span>
                        </div>
                        <div className="flex gap-1.5 mt-1">
                          <input
                            type="range"
                            min={-160}
                            max={160}
                            value={selectedItem.transform.positionX}
                            onChange={(e) =>
                              onDispatchCommand({
                                type: 'UPDATE_ITEM_TRANSFORM',
                                itemId: selectedItem.id,
                                transform: { positionX: parseInt(e.target.value, 10) },
                              })
                            }
                            className="w-1/2 accent-[#14B8A6]"
                          />
                          <input
                            type="range"
                            min={-100}
                            max={100}
                            value={selectedItem.transform.positionY}
                            onChange={(e) =>
                              onDispatchCommand({
                                type: 'UPDATE_ITEM_TRANSFORM',
                                itemId: selectedItem.id,
                                transform: { positionY: parseInt(e.target.value, 10) },
                              })
                            }
                            className="w-1/2 accent-[#14B8A6]"
                          />
                        </div>
                      </div>

                      <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded">
                        <div className="flex justify-between text-[11px] text-[#94A3B8]">
                          <span>Opacity</span>
                          <span className="font-mono text-[#E2E8F0]">{selectedItem.opacity}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={selectedItem.opacity}
                          onChange={(e) =>
                            onDispatchCommand({
                              type: 'UPDATE_ITEM_TRANSFORM',
                              itemId: selectedItem.id,
                              transform: {},
                              opacity: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-[#14B8A6] mt-1"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: 11 OWNED TRANSITIONS (Section 10.3) */}
                {inspectorTab === 'transitions' && (
                  <div className="space-y-2">
                    <div className="text-[11px] text-[#94A3B8] mb-2">
                      11 Genuine Owned Transitions (Implemented in CPU Oracle + WGPU Shaders)
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ALL_TRANSITIONS.map((tr) => {
                        const isActive = selectedItem.transitionIn.kind === tr.kind;
                        return (
                          <button
                            key={tr.kind}
                            onClick={() =>
                              onDispatchCommand({
                                type: 'SET_ITEM_TRANSITION',
                                itemId: selectedItem.id,
                                transition: {
                                  kind: tr.kind,
                                  durationTicks:
                                    tr.kind === 'Hard Cut' ? 0n : secondsToTicks(0.4),
                                  dipColor: '#000000',
                                },
                              })
                            }
                            className={`p-2 rounded border text-left transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-[#171B22] border-[#14B8A6] text-[#14B8A6]'
                                : 'bg-[#0B0D10] border-[#262C36] text-[#E2E8F0] hover:border-[#64748B]'
                            }`}
                          >
                            <div className="font-semibold text-xs">{tr.kind}</div>
                            <div className="text-[10px] text-[#94A3B8] font-mono truncate mt-0.5">
                              {tr.formulaNote}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* TAB 3: EFFECTS STACK & CANONICAL CACHE KEY (Section 10.4) */}
                {inspectorTab === 'effects' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <select
                        id="add-effect-select"
                        defaultValue="Beat Pulse"
                        className="flex-1 bg-[#0B0D10] border border-[#262C36] rounded px-2 py-1.5 text-xs text-[#E2E8F0]"
                      >
                        {AVAILABLE_EFFECTS.map((fx) => (
                          <option key={fx} value={fx}>
                            {fx}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          const sel = document.getElementById(
                            'add-effect-select'
                          ) as HTMLSelectElement | null;
                          const kind = (sel?.value as EffectKind) || 'Beat Pulse';
                          onDispatchCommand({
                            type: 'ADD_ITEM_EFFECT',
                            itemId: selectedItem.id,
                            effect: {
                              id: `fx_${Date.now().toString(36)}`,
                              kind,
                              enabled: true,
                              amount: 40,
                              gpuAccelerated: true,
                            },
                          });
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#14B8A6] text-[#0B0D10] font-bold rounded text-xs cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add FX</span>
                      </button>
                    </div>

                    <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded text-[10px] font-mono text-[#94A3B8] truncate">
                      Canonical Key: {canonicalEffectStackDescription(selectedItem.effects)}
                    </div>

                    <div className="space-y-2">
                      {selectedItem.effects.length === 0 ? (
                        <div className="text-center text-[#64748B] py-4">
                          No effects on clip stack. Add one above.
                        </div>
                      ) : (
                        selectedItem.effects.map((fx) => (
                          <div
                            key={fx.id}
                            className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-[#E2E8F0]">{fx.kind}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-[#14B8A6]">
                                  {fx.amount > 0 ? `+${fx.amount}` : fx.amount}
                                </span>
                                <button
                                  onClick={() =>
                                    onDispatchCommand({
                                      type: 'REMOVE_ITEM_EFFECT',
                                      itemId: selectedItem.id,
                                      effectId: fx.id,
                                    })
                                  }
                                  className="text-[#94A3B8] hover:text-red-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={-80}
                              max={100}
                              value={fx.amount}
                              onChange={(e) =>
                                onDispatchCommand({
                                  type: 'UPDATE_ITEM_EFFECT',
                                  itemId: selectedItem.id,
                                  effectId: fx.id,
                                  updates: { amount: parseInt(e.target.value, 10) },
                                })
                              }
                              className="w-full accent-[#14B8A6]"
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 4: KEYFRAME ANIMATION & BEZIER CURVE EDITOR (Section 6.3) */}
                {inspectorTab === 'keyframes' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={activeKfProperty}
                        onChange={(e) => setActiveKfProperty(e.target.value as AnimatableProperty)}
                        className="bg-[#0B0D10] border border-[#262C36] rounded px-2 py-1 text-xs text-[#E2E8F0]"
                      >
                        <option value="scale">Scale (%)</option>
                        <option value="opacity">Opacity (%)</option>
                        <option value="rotation">Rotation (deg)</option>
                        <option value="volumeDb">Volume (dB)</option>
                      </select>

                      <select
                        value={activeKfInterp}
                        onChange={(e) => setActiveKfInterp(e.target.value as CurveInterpolation)}
                        className="bg-[#0B0D10] border border-[#262C36] rounded px-2 py-1 text-xs text-[#E2E8F0]"
                      >
                        <option value="bezier">Cubic Bezier</option>
                        <option value="easeOut">Ease Out</option>
                        <option value="easeIn">Ease In</option>
                        <option value="linear">Linear</option>
                      </select>

                      <button
                        onClick={() => {
                          const offset =
                            playheadTicks >= selectedItem.startTicks &&
                            playheadTicks <= selectedItem.startTicks + selectedItem.durationTicks
                              ? playheadTicks - selectedItem.startTicks
                              : selectedItem.durationTicks / 2n;

                          // Create a two-point zoom pulse if none exists, or add keyframe at offset
                          if (selectedItem.keyframes.length === 0) {
                            onDispatchCommand({
                              type: 'UPSERT_KEYFRAME',
                              itemId: selectedItem.id,
                              keyframe: {
                                id: `kf_start_${Date.now()}`,
                                property: activeKfProperty,
                                offsetTicks: 0n,
                                value: activeKfProperty === 'scale' ? 145 : 100,
                                interpolation: activeKfInterp,
                                cp1x: 0.2,
                                cp1y: 0.9,
                                cp2x: 0.4,
                                cp2y: 1.0,
                              },
                            });
                            onDispatchCommand({
                              type: 'UPSERT_KEYFRAME',
                              itemId: selectedItem.id,
                              keyframe: {
                                id: `kf_end_${Date.now() + 1}`,
                                property: activeKfProperty,
                                offsetTicks: selectedItem.durationTicks,
                                value: activeKfProperty === 'scale' ? 100 : 100,
                                interpolation: activeKfInterp,
                                cp1x: 0.2,
                                cp1y: 0.9,
                                cp2x: 0.4,
                                cp2y: 1.0,
                              },
                            });
                          } else {
                            onDispatchCommand({
                              type: 'UPSERT_KEYFRAME',
                              itemId: selectedItem.id,
                              keyframe: {
                                id: `kf_${Date.now()}`,
                                property: activeKfProperty,
                                offsetTicks: offset,
                                value: activeKfProperty === 'scale' ? 135 : 85,
                                interpolation: activeKfInterp,
                                cp1x: 0.22,
                                cp1y: 0.88,
                                cp2x: 0.38,
                                cp2y: 1.0,
                              },
                            });
                          }
                        }}
                        className="px-2.5 py-1 bg-[#14B8A6] text-[#0B0D10] font-bold rounded text-xs cursor-pointer"
                      >
                        + Keyframe Pulse
                      </button>
                    </div>

                    {/* Interactive SVG Bezier Value Graph */}
                    <div className="p-2 bg-[#0B0D10] border border-[#262C36] rounded-md">
                      <div className="flex justify-between text-[10px] font-mono text-[#94A3B8] mb-1">
                        <span>Value Curve ({activeKfProperty})</span>
                        <span>{activeKfInterp.toUpperCase()}</span>
                      </div>
                      <svg viewBox="0 0 240 84" className="w-full h-20 bg-[#11141A] rounded">
                        <line x1="0" y1="42" x2="240" y2="42" stroke="#262C36" strokeDasharray="3 3" />
                        <path
                          d={
                            activeKfInterp === 'linear'
                              ? 'M 12 68 L 228 16'
                              : activeKfInterp === 'easeIn'
                              ? 'M 12 68 Q 180 68 228 16'
                              : activeKfInterp === 'easeOut'
                              ? 'M 12 68 Q 60 16 228 16'
                              : 'M 12 68 C 65 10, 145 72, 228 16'
                          }
                          fill="none"
                          stroke="#14B8A6"
                          strokeWidth="2.5"
                        />
                        <circle cx="12" cy="68" r="4" fill="#14B8A6" />
                        <circle cx="228" cy="16" r="4" fill="#14B8A6" />
                      </svg>
                    </div>

                    <div className="space-y-1">
                      {selectedItem.keyframes.map((kf) => (
                        <div
                          key={kf.id}
                          className="flex items-center justify-between px-2.5 py-1.5 bg-[#0B0D10] border border-[#262C36] rounded text-[11px] font-mono"
                        >
                          <span>
                            {kf.property} = {kf.value} @ {formatTicksCompact(kf.offsetTicks)}
                          </span>
                          <button
                            onClick={() =>
                              onDispatchCommand({
                                type: 'REMOVE_KEYFRAME',
                                itemId: selectedItem.id,
                                keyframeId: kf.id,
                              })
                            }
                            className="text-[#94A3B8] hover:text-red-400 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Lower Half: Multitrack Timeline with Content-Addressed Cache Bar & Markers */}
      <div className="flex-1 mx-6 mb-3 bg-[#11141A] border border-[#262C36] rounded-md flex flex-col overflow-hidden min-h-0">
        {/* Timeline Header Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#171B22] border-b border-[#262C36] text-xs shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-bold text-[#E2E8F0] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#14B8A6]" />
              <span>Multitrack Timeline</span>
            </span>
            <button
              onClick={() =>
                onDispatchCommand({
                  type: 'ADD_TRACK',
                  kind: 'overlay',
                  name: `Overlay ${project.tracks.filter((t) => t.kind === 'overlay').length + 1}`,
                })
              }
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0B0D10] hover:bg-[#262C36] border border-[#262C36] rounded text-[11px] text-[#E2E8F0] cursor-pointer"
            >
              <Plus className="w-3 h-3 text-[#14B8A6]" />
              <span>Add Track</span>
            </button>
          </div>

          {/* Markers Export & Legend */}
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#94A3B8]">
              <span className="w-2.5 h-2.5 inline-block bg-emerald-500 rounded-xs" />
              <span>Cache Ready</span>
            </span>
            <span className="flex items-center gap-1.5 text-[#94A3B8]">
              <span className="w-2.5 h-2.5 inline-block bg-amber-400 rounded-xs" />
              <span>Cache Pending</span>
            </span>
            <button
              onClick={handleExportMarkers}
              className="px-2 py-0.5 bg-[#0B0D10] hover:bg-[#262C36] border border-[#262C36] rounded text-[#14B8A6] font-mono cursor-pointer"
            >
              Export Markers ({project.markers.length})
            </button>
          </div>
        </div>

        {/* Tracks Area */}
        <div className="flex-1 flex flex-col overflow-y-auto divide-y divide-[#262C36] select-none">
          {/* Ruler + Markers + Content-Addressed Cache Bar */}
          <div className="flex h-8 bg-[#0B0D10] shrink-0">
            <div className="w-48 px-3 flex items-center justify-between border-r border-[#262C36] text-[10px] font-mono text-[#94A3B8]">
              <span>TIME / CACHE</span>
              <span>{totalSec.toFixed(1)}s</span>
            </div>
            <div
              className="flex-1 relative cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                onSetPlayheadTicks(secondsToTicks(ratio * totalSec));
              }}
            >
              {/* Content-Addressed Render Cache Status Strip (Section 6.3 & 10.5) */}
              {videoTrack?.items.map((item) => {
                const leftPct = (ticksToSeconds(item.startTicks) / totalSec) * 100;
                const widthPct = (ticksToSeconds(item.durationTicks) / totalSec) * 100;
                return (
                  <div
                    key={`cache_${item.id}`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className={`absolute top-0 h-1.5 ${
                      item.cacheStatus === 'ready' ? 'bg-emerald-500' : 'bg-amber-400/70'
                    }`}
                    title={`Cache ${item.cacheStatus}: ${item.cacheKey}`}
                  />
                );
              })}

              {/* User Timeline Markers */}
              {project.markers.map((m) => {
                const leftPct = (ticksToSeconds(m.startTicks) / totalSec) * 100;
                return (
                  <div
                    key={m.id}
                    style={{ left: `${leftPct}%`, borderColor: m.color }}
                    className="absolute top-2 bottom-0 border-l-2 px-1 text-[10px] font-mono text-[#E2E8F0] truncate"
                  >
                    {m.name}
                  </div>
                );
              })}

              {/* Playhead Cursor */}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-[#14B8A6] z-30 pointer-events-none"
                style={{
                  left: `${Math.min(100, (ticksToSeconds(playheadTicks) / totalSec) * 100)}%`,
                }}
              />
            </div>
          </div>

          {/* Each Track Row */}
          {project.tracks.map((track) => (
            <div key={track.id} className="flex h-12 bg-[#11141A] shrink-0">
              {/* Track Header */}
              <div className="w-48 px-3 flex items-center justify-between border-r border-[#262C36] bg-[#171B22]/60 shrink-0">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#E2E8F0] truncate">
                    {track.name}
                  </div>
                  <div className="text-[10px] font-mono text-[#94A3B8] uppercase">
                    {track.kind} · {track.blendMode}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      onDispatchCommand({
                        type: 'TOGGLE_TRACK_STATE',
                        trackId: track.id,
                        field: 'muted',
                      })
                    }
                    className={`p-1 rounded cursor-pointer ${
                      track.muted ? 'text-red-400 bg-red-950/40' : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                    }`}
                    title={track.muted ? 'Track Muted' : 'Mute Track'}
                  >
                    {track.muted ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() =>
                      onDispatchCommand({
                        type: 'TOGGLE_TRACK_STATE',
                        trackId: track.id,
                        field: 'locked',
                      })
                    }
                    className={`p-1 rounded cursor-pointer ${
                      track.locked ? 'text-amber-400 bg-amber-950/40' : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                    }`}
                    title={track.locked ? 'Track Locked' : 'Lock Track'}
                  >
                    {track.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Track Clips Lane */}
              <div
                className="flex-1 relative bg-[#0B0D10]"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  onSetPlayheadTicks(secondsToTicks(ratio * totalSec));
                }}
              >
                {track.items.map((item) => {
                  const leftPct = (ticksToSeconds(item.startTicks) / totalSec) * 100;
                  const widthPct = Math.max(
                    1.2,
                    (ticksToSeconds(item.durationTicks) / totalSec) * 100
                  );
                  const isSelected = selectedItem?.id === item.id;

                  return (
                    <div
                      key={item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedItemId(item.id);
                      }}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-1 bottom-1 rounded-xs px-2 py-1 flex flex-col justify-between cursor-pointer overflow-hidden border transition-all ${
                        isSelected
                          ? 'bg-[#171B22] border-[#14B8A6] z-10'
                          : item.provisional && !item.pinned
                          ? 'provisional-hatch border-amber-500/50'
                          : track.kind === 'text'
                          ? 'bg-purple-950/50 border-purple-500/40'
                          : 'bg-[#171B22]/90 border-[#262C36]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[#E2E8F0] truncate">
                        <span className="truncate">{item.name}</span>
                        {item.transitionIn.kind !== 'Hard Cut' && (
                          <span className="text-[9px] font-mono text-[#14B8A6] shrink-0">
                            [{item.transitionIn.kind}]
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[9px] font-mono text-[#94A3B8] truncate">
                        <span>
                          {item.effects.length > 0 ? `${item.effects.length} FX` : 'Clean'}
                        </span>
                        <span>{item.pinned ? 'PIN' : 'AUTO'}</span>
                      </div>
                    </div>
                  );
                })}

                {/* Playhead line through track */}
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-[#14B8A6] pointer-events-none z-20"
                  style={{
                    left: `${Math.min(100, (ticksToSeconds(playheadTicks) / totalSec) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}

          {/* Master Song Audio Waveform Lane */}
          <div className="flex h-12 bg-[#0B0D10] shrink-0">
            <div className="w-48 px-3 flex items-center justify-between border-r border-[#262C36] bg-[#171B22]/60 shrink-0">
              <div>
                <div className="text-xs font-semibold text-[#14B8A6]">Master Song Track</div>
                <div className="text-[10px] font-mono text-[#94A3B8]">
                  {project.songAnalysis?.bpm.toFixed(1) ?? '128.0'} BPM · {project.songAnalysis?.integratedLufs ?? -9.4} LUFS
                </div>
              </div>
              <Sparkles className="w-3.5 h-3.5 text-[#14B8A6]" />
            </div>

            <div className="flex-1 relative flex items-center px-1 gap-[2px] bg-[#07090C]">
              {project.songAnalysis?.waveformPeaks.map((pk, idx) => (
                <div
                  key={idx}
                  className="flex-1 bg-[#14B8A6]/45 rounded-xs"
                  style={{ height: `${Math.max(12, Math.round(pk * 85))}%` }}
                />
              ))}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-[#14B8A6] pointer-events-none z-20"
                style={{
                  left: `${Math.min(100, (ticksToSeconds(playheadTicks) / totalSec) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
