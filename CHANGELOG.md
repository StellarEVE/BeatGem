# Changelog — BeatGem

## [v0.1.0] — 2026-11-12

First official Windows Portable and Installer release (`v0.1.0`) of **BeatGem**, the structural beat-synced desktop video editor written in Rust and WGSL.

### Release Downloads (Windows x64)
- **`BeatGem-v0.1.0-Windows-x64-Portable.zip`**: Self-contained portable archive containing `beatgem-app.exe`, `beatgem-cli.exe`, and dynamically linked codec libraries beside the executables. No installation required.
- **`BeatGem-v0.1.0-Windows-x64-Setup.exe`**: Standard Windows x64 installer built with Inno Setup 6.

### Key Highlights in v0.1.0
- **Core Engine (`beatgem-core`)**:
  - Fixed 64-bit integer tick rate at `254,016,000,000` ticks per second (`Tick(i64)`), dividing evenly into `23.976`, `24`, `25`, `29.97`, `30`, `50`, `59.94`, `60`, `120` fps and `44,100 Hz` / `48,000 Hz` audio.
  - Transactional command execution (`clone -> apply -> validate_invariants -> commit`) with snapshot undo/redo and atomic `.beatgem.tmp` -> `.beatgem.json` saves with `.beatgem.bak` backups.
- **Song & Staged Footage Analysis (`beatgem-audio`, `beatgem-media`)**:
  - Multiband spectral flux onset detection (`Low`, `Mid`, `High` bands), autocorrelation tempo estimation verified against the synthetic `120.0 BPM` click-train fixture, and loudness regime change point detection.
  - Content fingerprinting via file size + BLAKE3 hash of head, middle, and tail 4KB byte windows.
  - Breadth-Before-Depth staged footage analysis: Stage 0 fast container probe, Stage 1 sparse sampling pass across all clips, and Stage 2 full WGPU shader pass.
- **Deterministic Montage Planner (`beatgem-engine`)**:
  - Explicit SplitMix64 seed determinism (`PlannerWrapperSettings`), scene boundary snapping, black-range exclusion, source reuse protection, spread, continue-start-points cursor, and the **Pinned Clip Rule** (preserving user-pinned clips byte-for-byte during Stage 2 refinement).
- **Owned Dual Compositor & Content-Addressed Cache (`beatgem-render`, `beatgem-platform`)**:
  - 11 genuine transitions (`Cross Dissolve`, `Dip to Color`, `Film Dissolve` in linear light $\gamma = 2.2$, `Dip to Dissolve`, `Crash Zoom`, `Directional Zoom`, `Twist Wheel`, `Radial Twist`, `Push`, `Slide`, `Split`) plus `Hard Cut`, verified against the processor Reference Oracle Compositor ($\le 1$ channel step delta).
  - Trial-based hardware encoder ladder (`NVENC` -> `QuickSync` -> `AMF` -> `VideoToolbox` -> `Software Floor`) with honest resolved encoder name reporting.
- **Pre-Window Startup Diagnostics (`beatgem-app`, `beatgem-cli`)**:
  - Headless GPU adapter probe prior to window event loop creation, `BEATGEM_RENDERER` override support, and panic-safe per-line flushing to `beatgem_startup.log`.
