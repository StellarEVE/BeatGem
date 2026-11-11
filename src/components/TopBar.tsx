import React from 'react';
import {
  Undo2,
  Redo2,
  Save,
  Trash2,
  FolderGit2,
  Download,
} from 'lucide-react';
import { ProjectState } from '../engine/types';

interface TopBarProps {
  project: ProjectState;
  canUndo: boolean;
  canRedo: boolean;
  lastCommandNote: string;
  onUndo: () => void;
  onRedo: () => void;
  onAtomicSave: () => void;
  onPurgeCache: () => void;
  onOpenRustRepo: () => void;
  onDownloadProjectJson: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  project,
  canUndo,
  canRedo,
  lastCommandNote,
  onUndo,
  onRedo,
  onAtomicSave,
  onPurgeCache,
  onOpenRustRepo,
  onDownloadProjectJson,
}) => {
  const readyCacheCount = Object.keys(project.knownRenderCacheKeys).length;

  return (
    <header className="flex items-center justify-between gap-8 px-6 py-2.5 bg-[#0B0D10] border-b border-[#262C36] shrink-0">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#top"
        onClick={(e) => e.preventDefault()}
        className="text-lg font-bold tracking-tight text-[#E2E8F0] font-display whitespace-nowrap shrink-0"
      >
        BeatGem
      </a>

      {/* Zone 2: 5 concise single-line text utility controls (No page navigation tabs here per Section 6 rule) */}
      <nav className="flex items-center gap-6 text-xs font-medium text-[#94A3B8]">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title={`Undo last command (${lastCommandNote})`}
          className="inline-flex items-center gap-1.5 hover:text-[#E2E8F0] disabled:opacity-35 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span>Undo</span>
        </button>

        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo command"
          className="inline-flex items-center gap-1.5 hover:text-[#E2E8F0] disabled:opacity-35 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
        >
          <Redo2 className="w-3.5 h-3.5" />
          <span>Redo</span>
        </button>

        <button
          onClick={onAtomicSave}
          title={`Atomic write + .bak backup (Last: ${project.lastSavedAt ?? 'Unsaved'})`}
          className="inline-flex items-center gap-1.5 hover:text-[#14B8A6] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Atomic Save</span>
        </button>

        <button
          onClick={onPurgeCache}
          title="Delete disposable content-addressed render & analysis cache home"
          className="inline-flex items-center gap-1.5 hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Purge Cache ({readyCacheCount})</span>
        </button>

        <button
          onClick={onOpenRustRepo}
          className="inline-flex items-center gap-1.5 text-[#14B8A6] hover:text-teal-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FolderGit2 className="w-3.5 h-3.5" />
          <span>Rust Source & Docs</span>
        </button>
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onDownloadProjectJson}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-[#0B0D10] bg-[#14B8A6] hover:bg-teal-400 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Save Project JSON</span>
        </button>
      </div>
    </header>
  );
};
