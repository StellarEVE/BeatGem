import readmeRaw from '../../README.md?raw';
import cargoTomlRaw from '../../Cargo.toml?raw';
import gitattributesRaw from '../../.gitattributes?raw';
import coreLibRaw from '../../crates/core/src/lib.rs?raw';
import audioLibRaw from '../../crates/audio/src/lib.rs?raw';
import platformLibRaw from '../../crates/platform/src/lib.rs?raw';
import mediaLibRaw from '../../crates/media/src/lib.rs?raw';
import renderLibRaw from '../../crates/render/src/lib.rs?raw';
import transitionsWgslRaw from '../../crates/render/shaders/transitions.wgsl?raw';
import engineLibRaw from '../../crates/engine/src/lib.rs?raw';
import appMainRaw from '../../crates/app/src/main.rs?raw';
import cliMainRaw from '../../crates/cli/src/main.rs?raw';
import layerCheckTestRaw from '../../tests/workspace_layer_check.rs?raw';
import windowsReleasePs1Raw from '../../scripts/build-windows-release.ps1?raw';
import archDocRaw from '../../docs/ARCHITECTURE.md?raw';

export interface RustRepoFile {
  path: string;
  crate: string;
  language: 'rust' | 'toml' | 'wgsl' | 'markdown' | 'powershell';
  summary: string;
  lines: number;
  content: string;
}

function makeFileEntry(
  path: string,
  crate: string,
  language: RustRepoFile['language'],
  summary: string,
  content: string
): RustRepoFile {
  return {
    path,
    crate,
    language,
    summary,
    lines: content.split('\n').length,
    content,
  };
}

export const BEATGEM_RUST_REPOSITORY: RustRepoFile[] = [
  makeFileEntry(
    'Cargo.toml',
    'workspace-root',
    'toml',
    'Root Cargo workspace manifest locking the 8 Rust crates and shared dependencies.',
    cargoTomlRaw
  ),
  makeFileEntry(
    'crates/core/src/lib.rs',
    'beatgem-core',
    'rust',
    'Exact integer Tick(i64) at 254,016,000,000/s, ProjectDocument schema v1, EngineCommand apply/validate/commit, and atomic save.',
    coreLibRaw
  ),
  makeFileEntry(
    'crates/audio/src/lib.rs',
    'beatgem-audio',
    'rust',
    'Multiband spectral flux onset detection, autocorrelation tempo estimator, loudness change points, and 120 BPM click-train test.',
    audioLibRaw
  ),
  makeFileEntry(
    'crates/platform/src/lib.rs',
    'beatgem-platform',
    'rust',
    'Sole home of hardware/OS media traits, capability report hash, and trial-based encoder lookup.',
    platformLibRaw
  ),
  makeFileEntry(
    'crates/media/src/lib.rs',
    'beatgem-media',
    'rust',
    'BLAKE3 content fingerprinting (size + head/mid/tail 4KB samples) and staged footage analysis structures.',
    mediaLibRaw
  ),
  makeFileEntry(
    'crates/render/src/lib.rs',
    'beatgem-render',
    'rust',
    'Reference CPU Oracle compositor, 11 transitions, canonical effect stack descriptions, and content-addressed cache keys.',
    renderLibRaw
  ),
  makeFileEntry(
    'crates/render/shaders/transitions.wgsl',
    'beatgem-render',
    'wgsl',
    'Owned WGSL fragment shader implementing Crash Zoom, Film Dissolve in linear light, Twist Wheel, Radial Twist, and Push.',
    transitionsWgslRaw
  ),
  makeFileEntry(
    'crates/engine/src/lib.rs',
    'beatgem-engine',
    'rust',
    'Deterministic SplitMix64 Montage Planner, wrapper settings type, and Pinned Clip byte-for-byte refinement contract.',
    engineLibRaw
  ),
  makeFileEntry(
    'crates/app/src/main.rs',
    'beatgem-app',
    'rust',
    'Desktop binary with pre-window headless WGPU adapter probe, panic-safe beatgem_startup.log writer, and OpenGL fallback.',
    appMainRaw
  ),
  makeFileEntry(
    'crates/cli/src/main.rs',
    'beatgem-cli',
    'rust',
    'Headless command-line interface driving beatgem-engine and beatgem-core for scripted generation and CI verification.',
    cliMainRaw
  ),
  makeFileEntry(
    'tests/workspace_layer_check.rs',
    'workspace-tests',
    'rust',
    'Automated architectural boundary test enforcing upward dependency bans, UI toolkit isolation, and codec trait borders.',
    layerCheckTestRaw
  ),
  makeFileEntry(
    'scripts/build-windows-release.ps1',
    'scripts',
    'powershell',
    'Windows release pipeline setting FFMPEG_DLL_PATH, FFMPEG_INCLUDE_DIR, LIBCLANG_PATH, running workspace gate, and packaging.',
    windowsReleasePs1Raw
  ),
  makeFileEntry(
    '.gitattributes',
    'workspace-root',
    'toml',
    'GitHub Linguist configuration marking all .rs and .wgsl files as primary source code and vendoring the web preview harness.',
    gitattributesRaw
  ),
  makeFileEntry(
    'README.md',
    'workspace-root',
    'markdown',
    'Repository README with workspace crate map, architectural principles, and Windows FFmpeg build instructions.',
    readmeRaw
  ),
  makeFileEntry(
    'docs/ARCHITECTURE.md',
    'docs',
    'markdown',
    'Architectural specification and 10 non-negotiable engineering rules.',
    archDocRaw
  ),
];
