/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeSongStructure,
  computeFootageAnalysisForStage,
  runMontagePlanner,
} from './engine/audioAndPlanner';
import { BeatAudioSynth } from './engine/compositorAndOracle';
import {
  createInitialDemoAssets,
  createInitialProjectState,
  EngineCommand,
  executeEngineCommand,
} from './engine/core';
import { secondsToTicks, Tick, ticksToSeconds } from './engine/ticks';
import {
  MediaAsset,
  PlannerSettings,
  ProjectState,
  WorkspacePage,
} from './engine/types';
import { TopBar } from './components/TopBar';
import { FooterBar } from './components/FooterBar';
import { MediaPage } from './components/MediaPage';
import { CutPage } from './components/CutPage';
import { EditPage } from './components/EditPage';
import { ExportPage } from './components/ExportPage';
import { RustRepoModal } from './components/RustRepoModal';

export default function App() {
  // Initialize project with analyzed song structure and initial rough cut so all 4 pages are immediately rich and usable
  const [project, setProject] = useState<ProjectState>(() => {
    const base = createInitialProjectState();
    const selectedSongs = base.assets.filter((a) =>
      base.selectedSongAssetIds.includes(a.id)
    );
    base.songAnalysis = analyzeSongStructure(
      selectedSongs,
      base.plannerSettings.beatsPerBar
    );
    // Populate initial Stage 1 quick pass on demo videos so Cut/Edit pages work out-of-the-box
    for (const asset of base.assets) {
      if (asset.kind === 'video') {
        const s1 = computeFootageAnalysisForStage(asset, 1);
        asset.analysisStage = 1;
        asset.stage1Progress = 1.0;
        asset.stage2Progress = 0.0;
        asset.scenes = s1.scenes;
        asset.blackRanges = s1.blackRanges;
        asset.motionCurve = s1.motionCurve;
      }
    }
    const initialCut = runMontagePlanner(base, false);
    base.tracks[0].items = initialCut;
    return base;
  });

  // Snapshot Undo & Redo History (Section 11.2)
  const [undoStack, setUndoStack] = useState<ProjectState[]>([]);
  const [redoStack, setRedoStack] = useState<ProjectState[]>([]);
  const [lastCommandNote, setLastCommandNote] = useState<string>('Initial workspace ready');

  // Active workspace page (Section 6: Media, Cut, Edit, Export)
  const [activePage, setActivePage] = useState<WorkspacePage>('media');
  const [isRustRepoOpen, setIsRustRepoOpen] = useState<boolean>(false);
  const [fullSpecMarkdown, setFullSpecMarkdown] = useState<string>('');

  // Transport & Playhead state in exact integer ticks
  const [playheadTicks, setPlayheadTicks] = useState<Tick>(0n);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const beatSynthRef = useRef<BeatAudioSynth>(new BeatAudioSynth());
  const videoElementsMapRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Staged Analysis Pipeline Orchestration state (Section 8.2 & 8.3)
  const [isPipelineRunning, setIsPipelineRunning] = useState<boolean>(false);
  const [pipelineStatusLine, setPipelineStatusLine] = useState<string>(
    'Rough cut ready · Press Begin Analysis to run full Stage 2 shader pass'
  );
  const [pipelineEtaSeconds, setPipelineEtaSeconds] = useState<number>(0);
  const pipelineCancelTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Load the uploaded markdown specification file from /assets/aistudio/the-program-complete-breakdown_52baa648.md
  useEffect(() => {
    fetch('/assets/aistudio/the-program-complete-breakdown_52baa648.md')
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => {
        if (txt) setFullSpecMarkdown(txt);
      })
      .catch(() => {});
  }, []);

  // Central transactional command dispatcher (clone -> apply -> validate -> commit)
  const dispatchCommand = useCallback(
    (cmd: EngineCommand, recordUndo: boolean = true) => {
      setProject((prev) => {
        const { nextState, validation, commandDescription } = executeEngineCommand(prev, cmd);
        setLastCommandNote(commandDescription);
        if (validation.valid && recordUndo) {
          setUndoStack((u) => [...u.slice(-24), prev]);
          setRedoStack([]);
        }
        return nextState;
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const previousState = prevUndo[prevUndo.length - 1];
      setProject((current) => {
        setRedoStack((r) => [...r, current]);
        return previousState;
      });
      setLastCommandNote('Undo restored previous command snapshot & cache keys');
      return prevUndo.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const nextState = prevRedo[prevRedo.length - 1];
      setProject((current) => {
        setUndoStack((u) => [...u, current]);
        return nextState;
      });
      setLastCommandNote('Redo reapplied command snapshot');
      return prevRedo.slice(0, -1);
    });
  }, []);

  // Playback transport loop synced to integer ticks + WebAudio beat synthesizer
  useEffect(() => {
    if (!isPlaying) {
      beatSynthRef.current.reset();
      return;
    }

    let lastTime = performance.now();
    let animId = 0;

    const tickLoop = (now: number) => {
      const dtSec = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;

      setPlayheadTicks((prevTicks) => {
        const videoTrack = project.tracks.find((t) => t.kind === 'video');
        const maxTicks =
          videoTrack && videoTrack.items.length > 0
            ? videoTrack.items[videoTrack.items.length - 1].startTicks +
              videoTrack.items[videoTrack.items.length - 1].durationTicks
            : secondsToTicks(24);

        const nextTicks = prevTicks + secondsToTicks(dtSec);
        const wrappedTicks = nextTicks >= maxTicks ? 0n : nextTicks;

        // Trigger synced musical beat synthesizer
        beatSynthRef.current.triggerIfNewBeat(
          ticksToSeconds(wrappedTicks),
          project.songAnalysis?.bpm ?? 128,
          false
        );

        return wrappedTicks;
      });

      animId = requestAnimationFrame(tickLoop);
    };

    animId = requestAnimationFrame(tickLoop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, project.tracks, project.songAnalysis?.bpm]);

  // Section 4, 8.2 & 8.3: Run Staged Analysis Pipeline (Breadth-First Stage 1 -> Rough Cut -> Priority Stage 2 Refinement)
  const startStagedAnalysisPipeline = useCallback(async () => {
    pipelineCancelTokenRef.current.cancelled = true;
    const token = { cancelled: false };
    pipelineCancelTokenRef.current = token;

    setActivePage('cut');
    setIsPipelineRunning(true);

    // 1. Song Analysis completes immediately (Section 4 & 8.1)
    setProject((prev) => {
      const songs = prev.assets.filter((a) => prev.selectedSongAssetIds.includes(a.id));
      const analysis = analyzeSongStructure(songs, prev.plannerSettings.beatsPerBar);
      // Reset uncancelled video assets to Stage 0 to demonstrate live Breadth-First Stage 1 -> Stage 2 progression
      const resetAssets = prev.assets.map((a) =>
        a.kind === 'video' && !a.missing
          ? {
              ...a,
              cancelled: false,
              analysisStage: 0 as const,
              stage1Progress: 0,
              stage2Progress: 0,
            }
          : a
      );
      return {
        ...prev,
        assets: resetAssets,
        songAnalysis: analysis,
      };
    });

    const videoIds = project.assets
      .filter((a) => a.kind === 'video' && !a.missing)
      .map((a) => a.id);

    // 2. Stage 1: Quick Sampling Pass covers EVERY video before Stage 2 begins on any of them (Breadth before Depth)
    for (let idx = 0; idx < videoIds.length; idx++) {
      if (token.cancelled) break;
      const vidId = videoIds[idx];
      setPipelineStatusLine(
        `Stage 1 quick sampling pass: video ${idx + 1} of ${videoIds.length}...`
      );
      setPipelineEtaSeconds(Math.max(1, (videoIds.length - idx) * 2 + 4));

      for (let step = 1; step <= 3; step++) {
        if (token.cancelled) break;
        await new Promise((r) => setTimeout(r, 90));
        const p = step / 3;
        setProject((curr) => {
          const target = curr.assets.find((a) => a.id === vidId);
          if (!target || target.cancelled) return curr;
          const s1Data =
            step === 3 ? computeFootageAnalysisForStage(target, 1) : undefined;
          const { nextState } = executeEngineCommand(curr, {
            type: 'UPDATE_ASSET_ANALYSIS',
            assetId: vidId,
            stage: step === 3 ? 1 : 0,
            stage1Progress: p,
            stage2Progress: 0,
            scenes: s1Data?.scenes,
            blackRanges: s1Data?.blackRanges,
            motionCurve: s1Data?.motionCurve,
          });
          return nextState;
        });
      }
    }

    if (token.cancelled) {
      setIsPipelineRunning(false);
      setPipelineStatusLine('Analysis cancelled by user.');
      return;
    }

    // 3. Generate Rough Cut Version 1 the moment Stage 1 covers the pool (Section 8.3)
    setProject((curr) => {
      const roughCut = runMontagePlanner(curr, false);
      const { nextState } = executeEngineCommand(curr, {
        type: 'APPLY_PLANNER_CUT',
        items: roughCut,
        isRefinement: false,
      });
      return nextState;
    });

    // 4. Stage 2: Full WGPU Shader Pass file-by-file, chunk-by-chunk, refining non-pinned clips
    for (let idx = 0; idx < videoIds.length; idx++) {
      if (token.cancelled) break;
      const vidId = videoIds[idx];
      setPipelineStatusLine(
        `Rough cut ready · Refining ${idx + 1} of ${videoIds.length} videos (Stage 2 Shader Pass)`
      );
      setPipelineEtaSeconds(Math.max(1, (videoIds.length - idx) * 2));

      for (let chunk = 1; chunk <= 4; chunk++) {
        if (token.cancelled) break;
        await new Promise((r) => setTimeout(r, 120));
        const p2 = chunk / 4;

        setProject((curr) => {
          const target = curr.assets.find((a) => a.id === vidId);
          if (!target || target.cancelled) return curr;
          const isComplete = chunk === 4;
          const s2Data = isComplete
            ? computeFootageAnalysisForStage(target, 2)
            : undefined;

          const { nextState: withStage2 } = executeEngineCommand(curr, {
            type: 'UPDATE_ASSET_ANALYSIS',
            assetId: vidId,
            stage: isComplete ? 2 : 1,
            stage1Progress: 1.0,
            stage2Progress: p2,
            scenes: s2Data?.scenes,
            blackRanges: s2Data?.blackRanges,
            motionCurve: s2Data?.motionCurve,
            bestMoments: s2Data?.bestMoments,
          });

          if (!isComplete) return withStage2;

          // Refine cut where the user has NOT touched/pinned clips (Section 8.3)
          const refinedItems = runMontagePlanner(withStage2, false);
          const { nextState: withRefinedCut } = executeEngineCommand(withStage2, {
            type: 'APPLY_PLANNER_CUT',
            items: refinedItems,
            isRefinement: true,
          });
          return withRefinedCut;
        });
      }
    }

    setIsPipelineRunning(false);
    setPipelineEtaSeconds(0);
    setPipelineStatusLine(
      token.cancelled
        ? 'Analysis paused · Partial refinement preserved'
        : `Stage 2 complete (1.00) · All ${videoIds.length} videos settled · Pinned clips untouched`
    );
  }, [project.assets]);

  // Atomic Save + .bak Backup (Section 3 & 12)
  const handleAtomicSave = () => {
    const nowStr = new Date().toTimeString().slice(0, 8);
    setProject((prev) => {
      const updated: ProjectState = {
        ...prev,
        backupSavedAt: prev.lastSavedAt ? `${prev.lastSavedAt} (.bak)` : `${nowStr} (.bak)`,
        lastSavedAt: nowStr,
      };
      try {
        const serialized = JSON.stringify(updated, (_k, v) =>
          typeof v === 'bigint' ? `${v.toString()}n` : v
        );
        const prevSaved = localStorage.getItem('beatgem_project_v1');
        if (prevSaved) {
          localStorage.setItem('beatgem_project_v1.bak', prevSaved);
        }
        localStorage.setItem('beatgem_project_v1', serialized);
      } catch {
        // Ignore storage quota errors
      }
      return updated;
    });
    setLastCommandNote(`Atomic save completed (${nowStr}) + .bak backup rotated`);
  };

  // Download readable JSON project document (Section 12)
  const handleDownloadProjectJson = () => {
    const jsonString = JSON.stringify(
      project,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    );
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = project.projectName || 'project.beatgem.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Weighted progress for footer bar
  const usableVideos = project.assets.filter((a) => a.kind === 'video' && !a.missing);
  const selectedSongs = project.assets.filter((a) =>
    project.selectedSongAssetIds.includes(a.id)
  );
  const canEnterCutPage = selectedSongs.length > 0 && usableVideos.length > 0;
  const cutPageDisabledReason = !canEnterCutPage
    ? 'Select at least 1 song and 1 non-missing video on the Media page first.'
    : null;

  const overallFooterProgress = isPipelineRunning
    ? usableVideos.reduce(
        (acc, v) => acc + v.stage1Progress * 0.35 + v.stage2Progress * 0.65,
        0
      ) / Math.max(1, usableVideos.length)
    : null;

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#0B0D10] text-[#E2E8F0]">
      {/* Top 3-Zone Studio Bar */}
      <TopBar
        project={project}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        lastCommandNote={lastCommandNote}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onAtomicSave={handleAtomicSave}
        onPurgeCache={() => dispatchCommand({ type: 'PURGE_DERIVED_CACHE' })}
        onOpenRustRepo={() => setIsRustRepoOpen(true)}
        onDownloadProjectJson={handleDownloadProjectJson}
      />

      {/* Main Workspace Page Viewport (1 of 4 pages) */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activePage === 'media' && (
          <MediaPage
            project={project}
            songAnalysis={project.songAnalysis}
            onImportAssets={(newAssets, videoElUpdates) => {
              if (videoElUpdates) {
                videoElUpdates.forEach((el, id) => videoElementsMapRef.current.set(id, el));
              }
              dispatchCommand({ type: 'IMPORT_ASSETS', assets: newAssets });
            }}
            onRemoveAsset={(assetId) => dispatchCommand({ type: 'REMOVE_ASSET', assetId })}
            onSetTrims={(assetId, introSec, outroSec) =>
              dispatchCommand({
                type: 'SET_ASSET_TRIMS',
                assetId,
                introTrimTicks: secondsToTicks(introSec),
                outroTrimTicks: secondsToTicks(outroSec),
              })
            }
            onSelectSongs={(songIds) => {
              dispatchCommand({ type: 'SELECT_SONGS', songAssetIds: songIds });
              const songs = project.assets.filter((a) => songIds.includes(a.id));
              if (songs.length > 0) {
                const newSongAnalysis = analyzeSongStructure(
                  songs,
                  project.plannerSettings.beatsPerBar
                );
                dispatchCommand(
                  { type: 'SET_SONG_ANALYSIS', analysis: newSongAnalysis },
                  false
                );
              }
            }}
            onToggleAssetMissing={(assetId, missing) =>
              dispatchCommand({ type: 'TOGGLE_ASSET_MISSING', assetId, missing })
            }
            onRelinkByFingerprint={(fingerprint, newPathHint, newName) =>
              dispatchCommand({
                type: 'RELINK_ASSET_BY_FINGERPRINT',
                fingerprint,
                newPathHint,
                newName,
              })
            }
            onBeginAnalysis={startStagedAnalysisPipeline}
            onRestoreDemoPool={() =>
              dispatchCommand({
                type: 'IMPORT_ASSETS',
                assets: createInitialDemoAssets(),
              })
            }
          />
        )}

        {activePage === 'cut' && (
          <CutPage
            project={project}
            playheadTicks={playheadTicks}
            isPlaying={isPlaying}
            onSetPlayheadTicks={setPlayheadTicks}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onUpdatePlannerSettings={(updates) => {
              setProject((prev) => {
                const { nextState: withSettings } = executeEngineCommand(prev, {
                  type: 'UPDATE_PLANNER_SETTINGS',
                  settings: updates,
                });
                const replanned = runMontagePlanner(withSettings, false);
                const { nextState: withCut } = executeEngineCommand(withSettings, {
                  type: 'APPLY_PLANNER_CUT',
                  items: replanned,
                  isRefinement: false,
                });
                setUndoStack((u) => [...u.slice(-24), prev]);
                setRedoStack([]);
                return withCut;
              });
            }}
            onRegenerateCut={() => {
              setProject((prev) => {
                const replanned = runMontagePlanner(prev, false);
                const { nextState } = executeEngineCommand(prev, {
                  type: 'APPLY_PLANNER_CUT',
                  items: replanned,
                  isRefinement: false,
                });
                setUndoStack((u) => [...u.slice(-24), prev]);
                return nextState;
              });
            }}
            onTogglePinClip={(itemId) =>
              dispatchCommand({ type: 'TOGGLE_PIN_ITEM', itemId })
            }
            onCancelAssetAnalysis={(assetId) =>
              dispatchCommand({ type: 'CANCEL_ASSET_ANALYSIS', assetId }, false)
            }
            onCancelAllAnalysis={() => {
              pipelineCancelTokenRef.current.cancelled = true;
              setIsPipelineRunning(false);
            }}
            onExtractCutTemplate={(name) =>
              dispatchCommand({ type: 'EXTRACT_CUT_TEMPLATE', name })
            }
            onApplyPreset={(presetId) => {
              const preset = project.presets.find((p) => p.id === presetId);
              if (preset && preset.category === 'planner') {
                const updates = preset.payload as Partial<PlannerSettings>;
                setProject((prev) => {
                  const { nextState: withSettings } = executeEngineCommand(prev, {
                    type: 'UPDATE_PLANNER_SETTINGS',
                    settings: updates,
                  });
                  const replanned = runMontagePlanner(withSettings, false);
                  const { nextState: withCut } = executeEngineCommand(withSettings, {
                    type: 'APPLY_PLANNER_CUT',
                    items: replanned,
                    isRefinement: false,
                  });
                  return withCut;
                });
              }
            }}
            onExportImmediately={() => setActivePage('export')}
            onContinueToEdit={() => setActivePage('edit')}
            pipelineStatusLine={pipelineStatusLine}
            pipelineEtaSeconds={pipelineEtaSeconds}
            isPipelineRunning={isPipelineRunning}
            videoElementsMap={videoElementsMapRef.current}
          />
        )}

        {activePage === 'edit' && (
          <EditPage
            project={project}
            playheadTicks={playheadTicks}
            isPlaying={isPlaying}
            onSetPlayheadTicks={setPlayheadTicks}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onDispatchCommand={dispatchCommand}
            videoElementsMap={videoElementsMapRef.current}
          />
        )}

        {activePage === 'export' && (
          <ExportPage
            project={project}
            onUpdateExportSettings={(settings) =>
              dispatchCommand({ type: 'UPDATE_EXPORT_SETTINGS', settings })
            }
            onUpdateOpenDecisions={(updates) =>
              dispatchCommand({ type: 'UPDATE_OPEN_DECISIONS', updates })
            }
            onMarkCacheKeysReady={(keys) =>
              dispatchCommand({ type: 'MARK_CACHE_KEYS_READY', keys }, false)
            }
            onDownloadProjectJson={handleDownloadProjectJson}
            videoElementsMap={videoElementsMapRef.current}
          />
        )}
      </main>

      {/* Bottom Footer Bar with Exclusive Wide 4-Page Navigation Tabs (Section 6 & 13) */}
      <FooterBar
        activePage={activePage}
        onSelectPage={setActivePage}
        pipelineStatusText={lastCommandNote}
        pipelineOverallProgress={overallFooterProgress}
        shortcutProfile={project.shortcutProfile}
        onChangeShortcutProfile={(shortcutProfile) =>
          setProject((prev) => ({ ...prev, shortcutProfile }))
        }
        canEnterCutPage={canEnterCutPage}
        cutPageDisabledReason={cutPageDisabledReason}
      />

      {/* Interactive Rust GitHub Repository & Source Code Modal */}
      <RustRepoModal
        isOpen={isRustRepoOpen}
        onClose={() => setIsRustRepoOpen(false)}
        fullSpecMarkdown={fullSpecMarkdown}
      />
    </div>
  );
}
