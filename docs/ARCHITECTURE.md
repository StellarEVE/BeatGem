# BeatGem — Complete Architectural Breakdown & Specification

This document specifies the design, module boundaries, exact integer time representation, staged analysis pipeline, owned dual compositor, hardware capability ladder, and non-negotiable engineering rules of **BeatGem**.

## 1. What BeatGem Is

BeatGem is a desktop video editor specialised in making music videos whose cuts land on the music. You bring one song and a pile of source videos. BeatGem analyses the structure of the song, studies the footage, and generates a first cut that is already synced to the beat. It then hands you a real timeline editor to make that cut yours, and exports the finished video through a graphics-accelerated pipeline that has been preparing your edit in the background while you worked.

- **Local files only, permanently**: Media comes from the user's own disks and never leaves them. Zero accounts, zero telemetry, zero watermarks, zero cloud services.
- **Open source under Apache 2.0**: Self-contained shipping as a portable archive and installer.
- **Four full-screen pages**: `Media`, `Cut`, `Edit`, `Export`, navigated exclusively through wide tabs in the bottom footer bar.

## 2. Ten Non-Negotiable Architecture Rules

1. **Local disk import only.** No external media service, no accounts, no uploads, ever.
2. **Composition is owned; translation is rented behind traits.** No codec work outside `beatgem-platform`; no external subprocess decoding or encoding.
3. **Exact integer time.** All edit mathematics runs in fixed integer ticks at `254,016,000,000` per second (`Tick(i64)`). No floating-point seconds in positions or durations.
4. **Every edit is a command** applied by `clone -> apply -> validate_invariants -> commit`. Invalid timelines must be unconstructable.
5. **Analysis is staged:** Stage 0 probe on import, Stage 1 sparse quick pass across the whole pool, then Stage 2 single full decode per file analyzed by WGPU shaders and reported per chunk. Rough cut early; refinement never touches a clip the user has touched or pinned (**The Pinned Clip Rule**).
6. **Graphics first, never graphics only.** Every graphics path has a correct software path, and the Reference CPU Compositor is the oracle the WGPU shader compositor must match ($\le 1$ channel step delta).
7. **Hardware capability is proven by trials** with real frames and real encodes, never by names or probes alone, and the resolved encoder name is always reported honestly.
8. **One project file (`ProjectDocument`),** readable JSON, schema-versioned with forward migrations; atomic saves with a `.bak` backup; media identified by content fingerprint (file size + BLAKE3 hash of head, middle, and tail windows); all derived data in one disposable cache home with a user-facing purge.
9. **The interface is a shell over commands.** Nothing below `beatgem-app` depends on its UI toolkit (`egui`/`eframe`). Page tabs live only in the footer. No control may pretend to work.
10. **Strict scope & open decision transparency.** Refused features remain refused; owner open decisions (Licence & Export Floor and Fallback Codec Tenant) are surfaced transparently.
