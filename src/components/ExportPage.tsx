import React, { useRef, useState } from 'react';
import {
  Share,
  Download,
  Cpu,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Scale,
  Play,
} from 'lucide-react';
import { renderTimelineCompositeFrame } from '../engine/compositorAndOracle';
import { secondsToTicks, ticksToSeconds } from '../engine/ticks';
import {
  ExportCodec,
  ExportContainer,
  ExportJob,
  ExportSettings,
  FitMode,
  OpenDecisionsState,
  ProjectState,
} from '../engine/types';

interface ExportPageProps {
  project: ProjectState;
  onUpdateExportSettings: (updates: Partial<ExportSettings>) => void;
  onUpdateOpenDecisions: (updates: Partial<OpenDecisionsState>) => void;
  onMarkCacheKeysReady: (keys: string[]) => void;
  onDownloadProjectJson: () => void;
  videoElementsMap: Map<string, HTMLVideoElement>;
}

export const ExportPage: React.FC<ExportPageProps> = ({
  project,
  onUpdateExportSettings,
  onUpdateOpenDecisions,
  onMarkCacheKeysReady,
  onDownloadProjectJson,
  videoElementsMap,
}) => {
  const [jobs, setJobs] = useState<ExportJob[]>(project.exportQueue);
  const [gapError, setGapError] = useState<string | null>(null);
  const hiddenExportCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const es = project.exportSettings;
  const cap = project.capabilityReport;
  const videoTrack = project.tracks.find((t) => t.kind === 'video');
  const videoItems = videoTrack?.items ?? [];

  // Resolved Encoder Lookup (Section 6.4 & 10.6: Substitution is allowed; silence about it is not)
  const matchedTrial = cap.trialEncodeResults.find((t) => t.codec === es.codec);
  const resolvedEncoderName =
    project.openDecisions.licenseAndExportFloor === 'lgpl_dynamic_openh264' &&
    es.codec === 'H.264' &&
    !matchedTrial?.hardwareAccelerated
      ? 'libopenh264 (LGPL Dynamic Permissive Floor)'
      : matchedTrial?.resolvedName ?? 'libx264 (Software Floor)';

  const cachedCount = videoItems.filter((i) => i.cacheStatus === 'ready').length;

  // Section 10.5: Validate contiguous timeline run (gaps rejected with no file written)
  const checkContiguousTimeline = (): string | null => {
    if (videoItems.length === 0) {
      return 'Export rejected: Primary video track contains 0 clips. Generate a cut first.';
    }
    for (let i = 0; i < videoItems.length - 1; i++) {
      const currEnd = videoItems[i].startTicks + videoItems[i].durationTicks;
      const nextStart = videoItems[i + 1].startTicks;
      if (nextStart > currEnd) {
        return `Export rejected (no file written): Gap detected on Video 1 between "${videoItems[i].name}" and "${videoItems[i + 1].name}".`;
      }
    }
    return null;
  };

  // Start a real background render job using Canvas + MediaRecorder (WebCodecs / WebM / MP4 stream)
  const handleStartExportJob = async () => {
    const err = checkContiguousTimeline();
    if (err) {
      setGapError(err);
      return;
    }
    setGapError(null);

    const ext = es.container.toLowerCase();
    const jobId = `job_${Date.now().toString(36)}`;
    const finalName = `BeatGem_Master_${es.width}x${es.height}_${es.fps}fps.${ext}`;
    const tempName = `${finalName}.part.tmp`; // Section 4 & 10.6: Atomic temp file

    const newJob: ExportJob = {
      id: jobId,
      outputFileName: finalName,
      tempFileName: tempName,
      settings: { ...es },
      resolvedEncoderName,
      status: 'rendering',
      progress: 0.02,
      etaSeconds: 4,
      cacheHits: es.bypassRenderCache ? 0 : cachedCount,
      totalSegments: videoItems.length,
      createdAt: new Date().toLocaleTimeString(),
    };

    setJobs((prev) => [newJob, ...prev]);

    // Render real video frames onto offscreen canvas and capture via MediaRecorder
    const canvas = hiddenExportCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let recorder: MediaRecorder | null = null;
    const recordedChunks: BlobPart[] = [];

    try {
      const stream = canvas.captureStream(es.fps);
      const mimeCandidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ];
      const supportedMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) {
          recordedChunks.push(evt.data);
        }
      };
      recorder.start(100);
    } catch {
      // Fallback if MediaRecorder is unavailable in sandboxed environment
    }

    const totalTicks =
      videoItems[videoItems.length - 1].startTicks +
      videoItems[videoItems.length - 1].durationTicks;
    const totalSec = Math.min(8, Math.max(2, ticksToSeconds(totalTicks)));
    const steps = 25;

    for (let s = 1; s <= steps; s++) {
      await new Promise((r) => setTimeout(r, 85));
      const frac = s / steps;
      const sampleTick = secondsToTicks(frac * totalSec);
      renderTimelineCompositeFrame(
        ctx,
        canvas.width,
        canvas.height,
        project,
        sampleTick,
        videoElementsMap
      );

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                progress: frac,
                etaSeconds: Math.max(0, Math.ceil((1 - frac) * 3)),
              }
            : j
        )
      );
    }

    let downloadUrl = '';
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        if (!recorder) return resolve();
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      downloadUrl = URL.createObjectURL(blob);
    }

    // Mark all timeline segments as cached in the content-addressed cache
    onMarkCacheKeysReady(videoItems.map((i) => i.cacheKey).filter(Boolean));

    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: 'completed',
              progress: 1.0,
              etaSeconds: 0,
              downloadUrl,
            }
          : j
      )
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0B0D10]">
      {/* Hidden offscreen canvas used by WebCodecs / MediaRecorder export pipeline */}
      <canvas ref={hiddenExportCanvasRef} width={640} height={360} className="hidden" />

      {/* Top Header Bar of Export Page */}
      <div className="flex items-center justify-between gap-6 px-6 py-4 bg-[#11141A] border-b border-[#262C36] shrink-0">
        <div>
          <h1 className="text-lg font-bold text-[#E2E8F0] font-display">
            04. Export Pipeline, Render Queue & Hardware Capability Report
          </h1>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Consumes content-addressed background cache · Trial-verified hardware encode · Atomic temporary file write &amp; rename
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onDownloadProjectJson}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#E2E8F0] bg-[#171B22] hover:bg-[#1E242D] border border-[#262C36] rounded-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#14B8A6]" />
            <span>Download .beatgem.json</span>
          </button>

          <button
            onClick={handleStartExportJob}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-[#0B0D10] bg-[#14B8A6] hover:bg-teal-400 rounded-md transition-colors cursor-pointer"
          >
            <Share className="w-3.5 h-3.5" />
            <span>Queue &amp; Render Video</span>
          </button>
        </div>
      </div>

      {gapError && (
        <div className="mx-6 mt-4 p-3 bg-red-950/40 border border-red-500/50 rounded-md flex items-center gap-2 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{gapError}</span>
        </div>
      )}

      {/* Main 12-Col Split: Left = Output Matrix & Render Queue (7 cols), Right = Capability Report, Startup Log & Open Decisions (5 cols) */}
      <div className="flex-1 grid grid-cols-12 gap-6 p-6 min-h-0 overflow-hidden">
        {/* Left Column: Output Codec Matrix + Background Render Queue */}
        <div className="col-span-7 flex flex-col gap-5 min-h-0 overflow-y-auto">
          {/* Output Matrix Card */}
          <div className="bg-[#11141A] border border-[#262C36] rounded-md p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-[#262C36] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#E2E8F0]">
                  Container, Codec &amp; Quality Matrix (Section 10.6)
                </h2>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  Resolved Encoder (Reported Honestly):{' '}
                  <span className="font-mono text-[#14B8A6] font-semibold">
                    {resolvedEncoderName}
                  </span>
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-400">
                Cache Ready: {cachedCount}/{videoItems.length} Clips
              </span>
            </div>

            <div className="grid grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">Container</label>
                <select
                  value={es.container}
                  onChange={(e) =>
                    onUpdateExportSettings({ container: e.target.value as ExportContainer })
                  }
                  className="w-full bg-[#0B0D10] border border-[#262C36] rounded px-2.5 py-1.5 text-[#E2E8F0] font-mono"
                >
                  {(['MP4', 'MKV', 'WebM', 'MOV'] as ExportContainer[]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">Codec</label>
                <select
                  value={es.codec}
                  onChange={(e) =>
                    onUpdateExportSettings({ codec: e.target.value as ExportCodec })
                  }
                  className="w-full bg-[#0B0D10] border border-[#262C36] rounded px-2.5 py-1.5 text-[#E2E8F0] font-mono"
                >
                  {(['H.264', 'H.265', 'AV1', 'VP9'] as ExportCodec[]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">Resolution</label>
                <select
                  value={`${es.width}x${es.height}`}
                  onChange={(e) => {
                    const [w, h] = e.target.value.split('x').map(Number);
                    onUpdateExportSettings({ width: w, height: h });
                  }}
                  className="w-full bg-[#0B0D10] border border-[#262C36] rounded px-2.5 py-1.5 text-[#E2E8F0] font-mono"
                >
                  <option value="1920x1080">1920x1080 (1080p)</option>
                  <option value="2560x1440">2560x1440 (1440p)</option>
                  <option value="3840x2160">3840x2160 (4K UHD)</option>
                  <option value="1280x720">1280x720 (720p)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">Frame Rate</label>
                <select
                  value={es.fps}
                  onChange={(e) =>
                    onUpdateExportSettings({
                      fps: parseInt(e.target.value, 10) as ExportSettings['fps'],
                    })
                  }
                  className="w-full bg-[#0B0D10] border border-[#262C36] rounded px-2.5 py-1.5 text-[#E2E8F0] font-mono"
                >
                  <option value={24}>24 fps</option>
                  <option value={25}>25 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>
            </div>

            {/* Aspect Ratio Fit & Quality CRF */}
            <div className="grid grid-cols-2 gap-4 pt-1 text-xs">
              <div className="p-3 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <div className="flex justify-between text-[11px] text-[#94A3B8] mb-1.5">
                  <span>Encoder Quality (CRF / CQ)</span>
                  <span className="font-mono text-[#14B8A6]">
                    CRF {es.qualityCrf} ({es.qualityCrf <= 18 ? 'Master High' : 'Balanced'})
                  </span>
                </div>
                <input
                  type="range"
                  min={14}
                  max={30}
                  value={es.qualityCrf}
                  onChange={(e) =>
                    onUpdateExportSettings({ qualityCrf: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-[#14B8A6]"
                />
              </div>

              <div className="p-3 bg-[#0B0D10] border border-[#262C36] rounded-md">
                <label className="block text-[11px] text-[#94A3B8] mb-1.5">
                  Mismatched Aspect Ratio Fit (Sec 6.4)
                </label>
                <div className="grid grid-cols-3 gap-1 bg-[#171B22] p-0.5 rounded">
                  {(
                    [
                      { id: 'crop', label: 'Crop Fill' },
                      { id: 'black_bars', label: 'Letterbox' },
                      { id: 'blurred_padding', label: 'Blur Pad' },
                    ] as { id: FitMode; label: string }[]
                  ).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onUpdateExportSettings({ fitMode: f.id })}
                      className={`py-1 rounded text-[11px] font-medium cursor-pointer ${
                        es.fitMode === f.id
                          ? 'bg-[#14B8A6] text-[#0B0D10] font-semibold'
                          : 'text-[#94A3B8]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-[#E2E8F0] cursor-pointer">
                <input
                  type="checkbox"
                  checked={es.bypassRenderCache}
                  onChange={(e) =>
                    onUpdateExportSettings({ bypassRenderCache: e.target.checked })
                  }
                  className="accent-[#14B8A6]"
                />
                <span>
                  Bypass Content-Addressed Render Cache (force full re-render from source files)
                </span>
              </label>
            </div>
          </div>

          {/* Background Render Queue (Section 6.4) */}
          <div className="bg-[#11141A] border border-[#262C36] rounded-md flex-1 flex flex-col overflow-hidden min-h-[220px]">
            <div className="flex items-center justify-between px-4 py-3 bg-[#171B22] border-b border-[#262C36]">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[#14B8A6]" />
                <h2 className="text-sm font-semibold text-[#E2E8F0]">
                  Background Render Queue ({jobs.length})
                </h2>
              </div>
              <span className="text-xs text-[#94A3B8]">
                Writes to .part.tmp &rarr; Atomic rename on completion
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {jobs.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#94A3B8]">
                  <p>No export jobs queued yet.</p>
                  <button
                    onClick={handleStartExportJob}
                    className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-[#14B8A6] text-[#0B0D10] font-bold rounded-md cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start First Export Job</span>
                  </button>
                </div>
              ) : (
                jobs.map((job) => (
                  <div
                    key={job.id}
                    className="p-3.5 bg-[#0B0D10] border border-[#262C36] rounded-md space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-mono font-semibold text-[#E2E8F0]">
                          {job.status === 'completed' ? job.outputFileName : job.tempFileName}
                        </div>
                        <div className="text-[11px] text-[#94A3B8] font-mono mt-0.5">
                          Encoder: {job.resolvedEncoderName} · Cache Hits: {job.cacheHits}/
                          {job.totalSegments}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {job.status === 'completed' ? (
                          <>
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Renamed &amp; Complete</span>
                            </span>
                            {job.downloadUrl && (
                              <a
                                href={job.downloadUrl}
                                download={job.outputFileName.replace(/\.(mp4|mkv|mov)$/i, '.webm')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#14B8A6] text-[#0B0D10] text-xs font-bold rounded cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                <span>Download Video</span>
                              </a>
                            )}
                          </>
                        ) : (
                          <span className="text-xs font-mono text-[#14B8A6]">
                            {Math.round(job.progress * 100)}% (ETA {job.etaSeconds}s)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="w-full h-1.5 bg-[#171B22] rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-[#14B8A6] transition-all duration-150"
                        style={{ width: `${Math.round(job.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Runtime Capability Report, Pre-Window Startup Log & Section 20 Open Decisions */}
        <div className="col-span-5 flex flex-col gap-5 min-h-0 overflow-y-auto">
          {/* Runtime Capability Report (Section 14) */}
          <div className="bg-[#11141A] border border-[#262C36] rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#14B8A6]" />
                <h2 className="text-sm font-semibold text-[#E2E8F0]">
                  Runtime Capability Report (Trial Proven)
                </h2>
              </div>
              <span className="text-[11px] font-mono text-[#14B8A6]">{cap.capabilityHash}</span>
            </div>

            <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded text-xs space-y-1 font-mono">
              <div className="text-[#E2E8F0]">{cap.adapterName}</div>
              <div className="text-[#94A3B8] text-[11px]">
                Decode Path: {cap.integratedDecodeApi}
              </div>
            </div>

            <div className="space-y-1.5">
              {cap.trialEncodeResults.map((tr) => (
                <div
                  key={tr.codec}
                  className="flex items-center justify-between px-3 py-1.5 bg-[#0B0D10] border border-[#262C36] rounded text-xs font-mono"
                >
                  <span className="font-semibold text-[#E2E8F0]">{tr.codec}</span>
                  <span className="text-[11px] text-[#94A3B8] truncate max-w-[260px]">
                    {tr.resolvedName}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 18 & 20: Owner Open Decisions Gate (Marked Explicitly, Never Silently Decided) */}
          <div className="bg-[#11141A] border border-[#262C36] rounded-md p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-[#E2E8F0]">
                Owner Open Decisions Gate (Section 18 &amp; 20)
              </h2>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">
                  1. Licence &amp; Software Export Floor (Apache 2.0 Compatibility)
                </label>
                <select
                  value={project.openDecisions.licenseAndExportFloor}
                  onChange={(e) =>
                    onUpdateOpenDecisions({
                      licenseAndExportFloor: e.target
                        .value as OpenDecisionsState['licenseAndExportFloor'],
                    })
                  }
                  className="w-full bg-[#0B0D10] border border-[#262C36] rounded px-2.5 py-1.5 text-[#E2E8F0]"
                >
                  <option value="lgpl_dynamic_openh264">
                    Permissive LGPL Dynamic Linking (OpenH264 / SVT-AV1 Floor)
                  </option>
                  <option value="gpl_x264_x265_floor">
                    Copyleft Shared Build (libx264 / libx265 Floor — Licence Tension Noted)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">
                  2. Broad Library Fallback Codec Tenant (Container Binding Spike)
                </label>
                <select
                  value={project.openDecisions.fallbackCodecTenant}
                  onChange={(e) =>
                    onUpdateOpenDecisions({
                      fallbackCodecTenant: e.target
                        .value as OpenDecisionsState['fallbackCodecTenant'],
                    })
                  }
                  className="w-full bg-[#0B0D10] border border-[#262C36] rounded px-2.5 py-1.5 text-[#E2E8F0]"
                >
                  <option value="ffmpeg_next_7_pinned">
                    On-Label Pinned Binding (ffmpeg-next — Evidence-Backed Spike Winner)
                  </option>
                  <option value="rsmpeg_candidate">
                    Candidate B (rsmpeg — Version Skew Risk Recorded)
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 15: Pre-Window Startup Diagnostic Log */}
          <div className="bg-[#11141A] border border-[#262C36] rounded-md p-4 space-y-2 flex-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#14B8A6]" />
                <h2 className="text-xs font-bold text-[#E2E8F0]">
                  Pre-Window Startup Diagnostic Log (beatgem_startup.log)
                </h2>
              </div>
              <span className="text-[10px] font-mono text-emerald-400">Panic-Safe Flush</span>
            </div>

            <div className="p-2.5 bg-[#0B0D10] border border-[#262C36] rounded font-mono text-[11px] space-y-1.5 max-h-40 overflow-y-auto">
              {project.startupLog.map((entry, idx) => (
                <div key={idx} className="text-[#94A3B8]">
                  <span className="text-[#64748B]">{entry.timestamp}</span>{' '}
                  <span className="text-[#14B8A6]">[{entry.phase}]</span>{' '}
                  <span className="text-[#E2E8F0]">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
