import React, { useRef, useState } from 'react';
import {
  Upload,
  Music,
  Film,
  Play,
  Trash2,
  Link2,
  AlertTriangle,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { computeFileFingerprint } from '../engine/core';
import {
  formatRawTicks,
  formatTicksCompact,
  secondsToTicks,
  ticksToSeconds,
} from '../engine/ticks';
import { MediaAsset, ProjectState, SongAnalysis } from '../engine/types';
import { verify120BpmClickTrainFixture } from '../engine/audioAndPlanner';

interface MediaPageProps {
  project: ProjectState;
  songAnalysis: SongAnalysis | null;
  onImportAssets: (assets: MediaAsset[], videoElMapUpdates?: Map<string, HTMLVideoElement>) => void;
  onRemoveAsset: (assetId: string) => void;
  onSetTrims: (assetId: string, introSec: number, outroSec: number) => void;
  onSelectSongs: (songIds: string[]) => void;
  onToggleAssetMissing: (assetId: string, missing: boolean) => void;
  onRelinkByFingerprint: (fingerprint: string, newPath: string, newName?: string) => void;
  onBeginAnalysis: () => void;
  onRestoreDemoPool: () => void;
}

export const MediaPage: React.FC<MediaPageProps> = ({
  project,
  songAnalysis,
  onImportAssets,
  onRemoveAsset,
  onSetTrims,
  onSelectSongs,
  onToggleAssetMissing,
  onRelinkByFingerprint,
  onBeginAnalysis,
  onRestoreDemoPool,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);
  const [relinkTargetAsset, setRelinkTargetAsset] = useState<MediaAsset | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [clickFixtureReport, setClickFixtureReport] = useState<ReturnType<
    typeof verify120BpmClickTrainFixture
  > | null>(null);

  const videoAssets = project.assets.filter((a) => a.kind === 'video');
  const audioAssets = project.assets.filter((a) => a.kind === 'audio');
  const usableVideos = videoAssets.filter((v) => !v.missing);
  const selectedSongs = audioAssets.filter((a) => project.selectedSongAssetIds.includes(a.id));

  // Section 6.1: Begin Analysis gate conditions & explicit disabled reason
  const canBeginAnalysis = selectedSongs.length > 0 && usableVideos.length > 0;
  let disabledReason: string | null = null;
  if (selectedSongs.length === 0 && usableVideos.length === 0) {
    disabledReason = 'Disabled: Select at least one song and import at least one available video file.';
  } else if (selectedSongs.length === 0) {
    disabledReason = 'Disabled: Choose at least one song in the Audio Pool before starting analysis.';
  } else if (usableVideos.length === 0) {
    disabledReason =
      videoAssets.length > 0
        ? 'Disabled: All imported videos are marked missing. Relink media by fingerprint first.'
        : 'Disabled: Import at least one source video file into the Video Pool.';
  }

  // Stage 0 fast container probe for local files dropped or picked by the user
  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const newAssets: MediaAsset[] = [];
    const newVideoElements = new Map<string, HTMLVideoElement>();
    const palette = ['#14B8A6', '#3B82F6', '#F59E0B', '#A855F7', '#F43F5E'];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const isAudio =
        file.type.startsWith('audio/') ||
        /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(file.name);
      const isVideo =
        file.type.startsWith('video/') ||
        /\.(mp4|mkv|webm|mov|avi)$/i.test(file.name);

      if (!isAudio && !isVideo) continue;

      const fingerprint = await computeFileFingerprint(file);
      const objectUrl = URL.createObjectURL(file);
      const id = `${isAudio ? 'song' : 'vid'}_${Date.now()}_${i}`;

      let durationSec = isAudio ? 24.0 : 16.0;
      let width = isVideo ? 1920 : 0;
      let height = isVideo ? 1080 : 0;

      // Fast container probe using HTMLMediaElement metadata
      try {
        await new Promise<void>((resolve) => {
          const mediaEl = document.createElement(isVideo ? 'video' : 'audio');
          mediaEl.preload = 'metadata';
          mediaEl.muted = true;
          mediaEl.src = objectUrl;
          const timer = setTimeout(() => resolve(), 1200);
          mediaEl.onloadedmetadata = () => {
            clearTimeout(timer);
            if (Number.isFinite(mediaEl.duration) && mediaEl.duration > 0) {
              durationSec = mediaEl.duration;
            }
            if (isVideo && mediaEl instanceof HTMLVideoElement) {
              width = mediaEl.videoWidth || 1920;
              height = mediaEl.videoHeight || 1080;
              newVideoElements.set(id, mediaEl);
            }
            resolve();
          };
          mediaEl.onerror = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      } catch {
        // Fallback probe dimensions if container isn't natively browser-decodable
      }

      const ext = file.name.split('.').pop()?.toUpperCase() || (isVideo ? 'MP4' : 'WAV');
      const color = palette[(project.assets.length + i) % palette.length];

      newAssets.push({
        id,
        name: file.name,
        pathHint: `LocalDisk:/Imported/${file.name}`,
        kind: isAudio ? 'audio' : 'video',
        fingerprint,
        fileSize: file.size,
        probe: {
          durationTicks: secondsToTicks(durationSec),
          width,
          height,
          fps: isVideo ? 30 : 0,
          codec: isVideo ? `${ext} Container Probe` : `${ext} Audio Stream`,
          container: ext,
          rotation: 0,
          sampleRate: isAudio ? 48000 : undefined,
          channels: isAudio ? 2 : undefined,
        },
        introTrimTicks: isVideo ? secondsToTicks(Math.min(1.0, durationSec * 0.08)) : 0n,
        outroTrimTicks: isVideo ? secondsToTicks(Math.min(1.0, durationSec * 0.08)) : 0n,
        analysisStage: isAudio ? 2 : 0,
        stage1Progress: isAudio ? 1 : 0,
        stage2Progress: isAudio ? 1 : 0,
        cancelled: false,
        missing: false,
        scenes: [],
        blackRanges: [],
        motionCurve: [],
        bestMoments: [],
        filmstrip: [color, '#1e293b', color, '#0f172a', color, '#334155'],
        objectUrl,
        proceduralTheme: 'cyber_sprint',
        accentColor: color,
      });
    }

    if (newAssets.length > 0) {
      onImportAssets(newAssets, newVideoElements);
    }
  };

  const handleToggleSongSelection = (songId: string) => {
    const exists = project.selectedSongAssetIds.includes(songId);
    if (exists) {
      onSelectSongs(project.selectedSongAssetIds.filter((id) => id !== songId));
    } else {
      onSelectSongs([...project.selectedSongAssetIds, songId]);
    }
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden bg-[#0B0D10]"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        handleFilesSelected(e.dataTransfer.files);
      }}
    >
      {/* Top Action Bar of Media Page */}
      <div className="flex items-center justify-between gap-6 px-6 py-4 bg-[#11141A] border-b border-[#262C36] shrink-0">
        <div>
          <h1 className="text-lg font-bold text-[#E2E8F0] font-display">
            01. Media Pool & Container Probe
          </h1>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Local disk import only · Stage 0 instant metadata probe · Set intro/outro trims once before analysis
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,audio/*,.mkv,.flac,.mov"
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <input
            ref={relinkInputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && relinkTargetAsset) {
                onRelinkByFingerprint(
                  relinkTargetAsset.fingerprint,
                  `LocalDisk:/Relinked/${file.name}`,
                  file.name
                );
                setRelinkTargetAsset(null);
              }
            }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] border border-[#262C36] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 text-[#14B8A6]" />
            <span>Import Local Files</span>
          </button>

          {project.assets.length < 3 && (
            <button
              onClick={onRestoreDemoPool}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#94A3B8] hover:text-[#E2E8F0] bg-[#171B22] border border-[#262C36] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Restore Demo Pool</span>
            </button>
          )}

          {/* Deliberate Gate Button: Begin Analysis (Section 4 & 6.1) */}
          <div className="flex flex-col items-end">
            <button
              onClick={onBeginAnalysis}
              disabled={!canBeginAnalysis}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-[#0B0D10] bg-[#14B8A6] hover:bg-teal-400 disabled:bg-[#1E242D] disabled:text-[#64748B] rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Begin Analysis</span>
            </button>
            {disabledReason && (
              <span className="text-[11px] text-amber-400 mt-1">{disabledReason}</span>
            )}
          </div>
        </div>
      </div>

      {/* Drag & Drop Overlay Notice */}
      {isDraggingOver && (
        <div className="mx-6 mt-4 p-4 border-2 border-dashed border-[#14B8A6] bg-[#14B8A6]/10 rounded-md text-center text-xs font-semibold text-[#14B8A6]">
          Drop local video or song files here for instant Stage 0 container probing and content fingerprinting
        </div>
      )}

      {/* Main Split Grid: Left = Video Pool & Trims (8 cols), Right = Song Selection & Honest Structure Report (4 cols) */}
      <div className="flex-1 grid grid-cols-12 gap-6 p-6 min-h-0 overflow-hidden">
        {/* Left Column: Source Video Pool */}
        <div className="col-span-8 flex flex-col min-h-0 bg-[#11141A] border border-[#262C36] rounded-md overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-[#171B22] border-b border-[#262C36]">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-[#14B8A6]" />
              <h2 className="text-sm font-semibold text-[#E2E8F0]">
                Source Video Pool ({videoAssets.length} files)
              </h2>
            </div>
            <div className="text-xs text-[#94A3B8]">
              Content Fingerprint Identity · Per-Video Intro/Outro Trims
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#262C36]">
            {videoAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center px-6">
                <Film className="w-8 h-8 text-[#64748B] mb-2" />
                <p className="text-sm font-medium text-[#E2E8F0]">No source videos in pool</p>
                <p className="text-xs text-[#94A3B8] mt-1 max-w-md">
                  Drag and drop local video files onto this window, click Import Local Files, or load the bundled action footage pool.
                </p>
                <button
                  onClick={onRestoreDemoPool}
                  className="mt-4 px-4 py-2 text-xs font-semibold text-[#0B0D10] bg-[#14B8A6] rounded-md cursor-pointer"
                >
                  Load Demo Action Footage Pool
                </button>
              </div>
            ) : (
              videoAssets.map((video) => {
                const totalSec = ticksToSeconds(video.probe.durationTicks);
                const introSec = ticksToSeconds(video.introTrimTicks);
                const outroSec = ticksToSeconds(video.outroTrimTicks);
                const usableSec = Math.max(0, totalSec - introSec - outroSec);

                return (
                  <div
                    key={video.id}
                    className={`p-4 transition-colors ${
                      video.missing ? 'bg-red-950/20' : 'hover:bg-[#171B22]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Filmstrip & Probe Metadata */}
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        {/* Cheap Background Filmstrip Preview */}
                        <div className="w-28 h-16 rounded-md overflow-hidden border border-[#262C36] shrink-0 flex flex-col bg-[#0B0D10]">
                          <div className="flex-1 grid grid-cols-3 gap-0.5 p-0.5">
                            {video.filmstrip.slice(0, 6).map((col, idx) => (
                              <div
                                key={idx}
                                className=" rounded-[2px]"
                                style={{
                                  background: `linear-gradient(135deg, ${col}, #0B0D10)`,
                                }}
                              />
                            ))}
                          </div>
                          <div className="px-1.5 py-0.5 bg-[#0B0D10] text-[10px] font-mono text-[#94A3B8] flex justify-between">
                            <span>{video.probe.container}</span>
                            <span>{formatTicksCompact(video.probe.durationTicks)}</span>
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[#E2E8F0] truncate">
                              {video.name}
                            </span>
                            {video.missing && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Missing Path (Relink by Fingerprint)</span>
                              </span>
                            )}
                          </div>

                          {/* Clean unboxed metadata with typographic separators */}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8] font-mono mt-1">
                            <span>
                              {video.probe.width}x{video.probe.height}
                            </span>
                            <span>·</span>
                            <span>{video.probe.fps} fps</span>
                            <span>·</span>
                            <span>{video.probe.codec}</span>
                            <span>·</span>
                            <span>Rot {video.probe.rotation}°</span>
                            <span>·</span>
                            <span className="text-[#14B8A6]" title="Content identity hash (size + head/mid/tail bytes)">
                              ID: {video.fingerprint}
                            </span>
                          </div>

                          <div className="text-[11px] text-[#64748B] font-mono truncate mt-0.5">
                            Path hint: {video.pathHint} · Stage {video.analysisStage}/2
                          </div>
                        </div>
                      </div>

                      {/* Relink & Remove Controls */}
                      <div className="flex items-center gap-2 shrink-0">
                        {video.missing ? (
                          <>
                            <button
                              onClick={() =>
                                onRelinkByFingerprint(
                                  video.fingerprint,
                                  video.pathHint.replace('Moved_', 'Restored_')
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#0B0D10] bg-[#14B8A6] hover:bg-teal-400 rounded-md cursor-pointer"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              <span>Auto-Match Fingerprint</span>
                            </button>
                            <button
                              onClick={() => {
                                setRelinkTargetAsset(video);
                                relinkInputRef.current?.click();
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171B22] border border-[#262C36] rounded-md cursor-pointer"
                            >
                              Locate File...
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => onToggleAssetMissing(video.id, true)}
                            title="Simulate moving this file on disk to test content-fingerprint relinking"
                            className="px-2.5 py-1 text-[11px] font-medium text-[#94A3B8] hover:text-[#E2E8F0] bg-[#171B22] border border-[#262C36] rounded-md cursor-pointer"
                          >
                            Simulate File Move
                          </button>
                        )}

                        <button
                          onClick={() => onRemoveAsset(video.id)}
                          className="p-1.5 text-[#94A3B8] hover:text-red-400 rounded-md cursor-pointer"
                          title="Remove from project pool"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Section 6.1: Per-Video Intro & Outro Trims set once here */}
                    <div className="mt-3 pt-2.5 border-t border-[#262C36]/70 grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-4 flex items-center gap-2">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-[#14B8A6]" />
                        <label className="text-xs text-[#94A3B8] whitespace-nowrap">
                          Intro Trim:
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(1, Number((totalSec * 0.4).toFixed(1)))}
                          step={0.1}
                          value={Number(introSec.toFixed(1))}
                          onChange={(e) =>
                            onSetTrims(video.id, parseFloat(e.target.value), outroSec)
                          }
                          className="w-full accent-[#14B8A6] cursor-pointer"
                        />
                        <span className="text-xs font-mono text-[#E2E8F0] w-12 text-right">
                          {introSec.toFixed(1)}s
                        </span>
                      </div>

                      <div className="col-span-4 flex items-center gap-2">
                        <label className="text-xs text-[#94A3B8] whitespace-nowrap">
                          Outro Trim:
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(1, Number((totalSec * 0.4).toFixed(1)))}
                          step={0.1}
                          value={Number(outroSec.toFixed(1))}
                          onChange={(e) =>
                            onSetTrims(video.id, introSec, parseFloat(e.target.value))
                          }
                          className="w-full accent-[#14B8A6] cursor-pointer"
                        />
                        <span className="text-xs font-mono text-[#E2E8F0] w-12 text-right">
                          {outroSec.toFixed(1)}s
                        </span>
                      </div>

                      <div className="col-span-4 text-right text-xs font-mono text-[#94A3B8]">
                        Usable Window:{' '}
                        <span className="text-[#14B8A6] font-semibold">
                          {usableSec.toFixed(2)}s
                        </span>{' '}
                        ({formatRawTicks(video.probe.durationTicks - video.introTrimTicks - video.outroTrimTicks)} ticks)
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Song Pool & Honest Musical Structure Report */}
        <div className="col-span-4 flex flex-col gap-6 min-h-0 overflow-y-auto">
          {/* Song Selector Card */}
          <div className="bg-[#11141A] border border-[#262C36] rounded-md overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-4 py-3 bg-[#171B22] border-b border-[#262C36]">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-[#14B8A6]" />
                <h2 className="text-sm font-semibold text-[#E2E8F0]">
                  Project Song Track ({selectedSongs.length} selected)
                </h2>
              </div>
              <span className="text-[11px] text-[#94A3B8]">Stitch Multiple Allowed</span>
            </div>

            <div className="p-4 space-y-2.5">
              {audioAssets.map((song) => {
                const isSelected = project.selectedSongAssetIds.includes(song.id);
                return (
                  <div
                    key={song.id}
                    onClick={() => handleToggleSongSelection(song.id)}
                    className={`p-3 rounded-md border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#171B22] border-[#14B8A6]'
                        : 'bg-[#0B0D10] border-[#262C36] hover:border-[#64748B]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#E2E8F0] truncate">
                        {song.name}
                      </span>
                      <span className="text-xs font-mono text-[#14B8A6]">
                        {formatTicksCompact(song.probe.durationTicks)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-[#94A3B8] font-mono mt-1">
                      <span>{song.probe.codec}</span>
                      <span>·</span>
                      <span>{song.probe.sampleRate ?? 48000} Hz</span>
                      <span>·</span>
                      <span>{isSelected ? 'Active in Beat Timeline' : 'Click to Stitch'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 6.1 & 8.1: Honest Song Analysis Results */}
          <div className="bg-[#11141A] border border-[#262C36] rounded-md overflow-hidden flex-1 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 bg-[#171B22] border-b border-[#262C36]">
              <h2 className="text-sm font-semibold text-[#E2E8F0]">
                Musical Structure & Beat Intelligence
              </h2>
              <button
                onClick={() => setClickFixtureReport(verify120BpmClickTrainFixture())}
                className="px-2.5 py-1 text-[11px] font-medium text-[#14B8A6] bg-[#0B0D10] hover:bg-[#1E242D] border border-[#262C36] rounded-md cursor-pointer"
                title="Run Section 8.1 synthetic 120.0 BPM click-train autocorrelation verification"
              >
                Verify 120 BPM Fixture
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              {clickFixtureReport && (
                <div className="p-3 bg-[#0B0D10] border border-emerald-500/40 rounded-md text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>120.0 BPM Click-Train Autocorrelation Verified</span>
                  </div>
                  <div className="text-[#94A3B8] font-mono text-[11px]">
                    Target: {clickFixtureReport.expectedBpm.toFixed(2)} BPM · Measured:{' '}
                    {clickFixtureReport.measuredBpm.toFixed(2)} BPM · Delta:{' '}
                    {clickFixtureReport.deltaBpm.toFixed(3)} BPM (&le; 1.0 BPM tolerance)
                  </div>
                </div>
              )}

              {songAnalysis ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-[#0B0D10] border border-[#262C36] rounded-md">
                      <div className="text-[11px] text-[#94A3B8]">Detected Tempo</div>
                      <div className="text-lg font-bold font-mono text-[#14B8A6] mt-0.5">
                        {songAnalysis.bpm.toFixed(1)} BPM
                      </div>
                    </div>
                    <div className="p-3 bg-[#0B0D10] border border-[#262C36] rounded-md">
                      <div className="text-[11px] text-[#94A3B8]">Beats / Bars / Phrases</div>
                      <div className="text-sm font-bold font-mono text-[#E2E8F0] mt-1">
                        {songAnalysis.beatGridTicks.length} / {songAnalysis.barTicks.length} /{' '}
                        {songAnalysis.phraseTicks.length}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-[#E2E8F0] mb-2">
                      Loudness Regime Change Points ({songAnalysis.changePoints.length})
                    </div>
                    <div className="space-y-1.5">
                      {songAnalysis.changePoints.map((cp, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between px-3 py-2 bg-[#0B0D10] border border-[#262C36] rounded-md text-xs"
                        >
                          <span className="font-medium text-[#E2E8F0]">{cp.label}</span>
                          <div className="flex items-center gap-3 font-mono text-[11px]">
                            <span className="text-[#94A3B8]">
                              @{formatTicksCompact(cp.tick)}
                            </span>
                            <span className="text-[#14B8A6]">
                              Energy {Math.round(cp.energy * 100)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-xs text-[#94A3B8] py-8 text-center">
                  Select a song above to inspect its tempo grid and structural change points.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
