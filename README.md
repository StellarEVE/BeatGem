# BeatGem

**An automatic, structural, beat-synced first cut, inside an editor worth finishing it in.**

BeatGem is a native, 100% local desktop video editor written in **Rust** and **WGSL**. You bring one song and a pile of source videos. BeatGem analyses the structure of the song, studies the footage through a staged GPU-accelerated pipeline, and generates a deterministic first cut synced to the beat. It then hands you a real multitrack timeline editor to make that cut yours, and exports the finished video through a content-addressed background render cache.

---

## Core Design Principles

1. **Local files only, permanently**: Media is imported from local disks by file picker or drag and drop. Zero accounts, zero subscriptions, zero watermarks, zero cloud uploads.
2. **The generator proposes, the editor disposes**: Automation produces the first draft only. Whatever clip the user touches or pins is permanently protected from further automated refinement or regeneration (**The Pinned Clip Rule**).
3. **Music is structure, not a metronome**: Multiband spectral flux separates kicks, snares, and high-frequency transients; autocorrelation measures tempo; loudness regime change points mark structural turns (Intro, Verse, Chorus Drop, Bridge, Finale).
4. **Exact integer time**: All edit mathematics runs on fixed 64-bit integer ticks at `254,016,000,000` ticks per second (`i64`). That rate divides evenly by every common video frame rate (`23.976`, `24`, `25`, `29.97`, `30`, `50`, `59.94`, `60`, `120`) and by both `44,100 Hz` and `48,000 Hz` audio. Floating-point seconds are banned from positions and durations.
5. **Composition is owned; translation is rented**: All 11 transitions, effects, and Stage 2 footage analysis passes run as owned WGPU shaders verified against a processor **Reference Oracle Compositor** (maximum channel step delta $\le 1$). Decoding and encoding sit behind traits in `beatgem-platform`.
6. **Hardware capability proven by trial**: Decoders and encoders are verified by real trial frames and trial encodes at startup—never assumed from adapter names—and the resolved encoder name is always reported honestly in the UI.
7. **Crash-proof atomic persistence & startup diagnostics**: Saves write to `.beatgem.tmp` and atomically rename over the target while preserving a `.beatgem.bak` backup. The desktop binary probes the GPU headless *before* opening any window and logs every startup milestone to `beatgem_startup.log`.

---

## Workspace Crate Map

```text
beatgem/
├── Cargo.toml                  # Workspace manifest (8 crates)
├── crates/
│   ├── core/                   # Tick(i64) @ 254,016,000,000/s, ProjectSchemaV1, Command, Invariants, Atomic Save
│   ├── audio/                  # Symphonia decode, multiband spectral flux, autocorrelation BPM, 120 BPM fixture
│   ├── platform/               # Sole home of codec & GPU probing, D3D11VA/VideoToolbox/VAAPI, trial encode
│   ├── media/                  # BLAKE3 head/mid/tail content fingerprinting, Stage 0/1/2 analysis & cache
│   ├── render/                 # Reference CPU Oracle, WGPU shader compositor, 11 transitions, content cache
│   │   └── shaders/
│   │       └── transitions.wgsl
│   ├── engine/                 # Deterministic Montage Planner, wrapper settings, Breadth-Before-Depth pipeline
│   ├── app/                    # Pre-window adapter probe, panic-safe startup logger, 4-page desktop UI shell
│   └── cli/                    # Headless CLI over the same Engine commands & automated verification hooks
├── scripts/
│   └── build-windows-release.ps1
├── tests/
│   └── workspace_layer_check.rs
└── docs/
    └── ARCHITECTURE.md
```

---

## Building on Windows (Dynamic Codec Linking)

The codec binding (`ffmpeg-next`) on Windows does not use Unix `pkg-config`. Point the environment explicitly at the shared development build of FFmpeg and LLVM `libclang`:

```powershell
$env:FFMPEG_DLL_PATH    = "C:\deps\ffmpeg-shared\lib"
$env:FFMPEG_INCLUDE_DIR = "C:\deps\ffmpeg-shared\include"
$env:LIBCLANG_PATH      = "C:\Program Files\LLVM\bin"

# Run full workspace test suite (unit tests, 120 BPM click-train fixture, Oracle parity, and layer check)
cargo test --workspace --locked

# Build release executables (beatgem-app.exe & beatgem-cli.exe)
cargo build --release --workspace --locked
```

Or run the automated release staging script:

```powershell
pwsh ./scripts/build-windows-release.ps1
```

---

## License

Licensed under the **Apache License, Version 2.0** (see [`LICENSE`](./LICENSE)).
