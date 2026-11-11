import React from 'react';
import {
  Film,
  Scissors,
  Sliders,
  Share,
  Keyboard,
} from 'lucide-react';
import { ShortcutProfile, WorkspacePage } from '../engine/types';

interface FooterBarProps {
  activePage: WorkspacePage;
  onSelectPage: (page: WorkspacePage) => void;
  pipelineStatusText: string;
  pipelineOverallProgress: number | null;
  shortcutProfile: ShortcutProfile;
  onChangeShortcutProfile: (profile: ShortcutProfile) => void;
  canEnterCutPage: boolean;
  cutPageDisabledReason: string | null;
}

export const FooterBar: React.FC<FooterBarProps> = ({
  activePage,
  onSelectPage,
  pipelineStatusText,
  pipelineOverallProgress,
  shortcutProfile,
  onChangeShortcutProfile,
  canEnterCutPage,
  cutPageDisabledReason,
}) => {
  const pages: { id: WorkspacePage; label: string; icon: React.ReactNode }[] = [
    { id: 'media', label: '01. Media', icon: <Film className="w-4 h-4" /> },
    { id: 'cut', label: '02. Cut', icon: <Scissors className="w-4 h-4" /> },
    { id: 'edit', label: '03. Edit', icon: <Sliders className="w-4 h-4" /> },
    { id: 'export', label: '04. Export', icon: <Share className="w-4 h-4" /> },
  ];

  return (
    <footer className="flex items-center justify-between gap-4 px-6 py-2 bg-[#0B0D10] border-t border-[#262C36] shrink-0">
      {/* Left: Real Background Job Status (Never fake telemetry) */}
      <div className="flex items-center gap-3 min-w-[260px] max-w-[340px]">
        <div className="flex flex-col w-full">
          <div className="flex items-center justify-between text-[11px] text-[#94A3B8] truncate">
            <span className="truncate">{pipelineStatusText}</span>
            {pipelineOverallProgress !== null && (
              <span className="font-mono text-[#14B8A6] ml-2">
                {Math.round(pipelineOverallProgress * 100)}%
              </span>
            )}
          </div>
          {pipelineOverallProgress !== null && (
            <div className="w-full h-1 bg-[#171B22] rounded-sm overflow-hidden mt-1">
              <div
                className="h-full bg-[#14B8A6] transition-all duration-150"
                style={{ width: `${Math.max(2, Math.round(pipelineOverallProgress * 100))}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Center: Wide 4-Page Navigation Tabs (Section 6 & 13: Page navigation lives ONLY in the footer bar) */}
      <div className="flex items-center flex-1 max-w-2xl gap-2">
        {pages.map((p) => {
          const isActive = activePage === p.id;
          const isCutLocked = p.id === 'cut' && !canEnterCutPage;
          return (
            <button
              key={p.id}
              onClick={() => {
                if (isCutLocked) return;
                onSelectPage(p.id);
              }}
              disabled={isCutLocked}
              title={isCutLocked && cutPageDisabledReason ? cutPageDisabledReason : `Switch to ${p.label} page`}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                isActive
                  ? 'bg-[#14B8A6] text-[#0B0D10] shadow-sm'
                  : 'bg-[#171B22] text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E242D] border border-[#262C36]'
              }`}
            >
              {p.icon}
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Right: Shortcut Binding Profile Selector (Section 6.3) */}
      <div className="flex items-center justify-end gap-2 min-w-[240px]">
        <Keyboard className="w-3.5 h-3.5 text-[#94A3B8]" />
        <label htmlFor="shortcut-profile-select" className="text-[11px] text-[#94A3B8] whitespace-nowrap">
          Keymap:
        </label>
        <select
          id="shortcut-profile-select"
          value={shortcutProfile}
          onChange={(e) => onChangeShortcutProfile(e.target.value as ShortcutProfile)}
          className="bg-[#171B22] border border-[#262C36] text-[#E2E8F0] text-xs rounded-md px-2.5 py-1 focus:outline-none focus:border-[#14B8A6]"
        >
          <option value="BeatGem Default">BeatGem Default</option>
          <option value="DaVinci Resolve">DaVinci Resolve</option>
          <option value="Premiere Pro">Premiere Pro</option>
          <option value="CapCut">CapCut</option>
        </select>
      </div>
    </footer>
  );
};
