//! beatgem-app: Desktop interface shell (Media, Cut, Edit, Export).
//! Section 13 & 15:
//! - Decide the renderer BEFORE creating any window (single event loop per process).
//! - Log from the first moments to `beatgem_startup.log` beside the executable, flushing every line.
//! - Page navigation lives ONLY in the wide footer bar.

use std::fs::OpenOptions;
use std::io::Write;
use std::panic;

/// Panic-safe append logger written beside the executable.
/// Each line opens, writes, flushes, and closes the file so the last line survives an immediate crash.
fn append_startup_log(line: &str) {
    if let Ok(exe_path) = std::env::current_exe() {
        let log_path = exe_path.with_file_name("beatgem_startup.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(file, "{}", line);
            let _ = file.flush();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectedRenderer {
    WgpuAccelerated,
    GlowOpenGlFallback,
}

/// Section 15: Probe graphics stack headless with no window at all before creating the event loop.
pub fn probe_renderer_headless() -> SelectedRenderer {
    if let Ok(forced) = std::env::var("BEATGEM_RENDERER") {
        if forced.eq_ignore_ascii_case("glow") || forced.eq_ignore_ascii_case("opengl") {
            append_startup_log("[RENDERER_SELECT] Forced OpenGL fallback via BEATGEM_RENDERER.");
            return SelectedRenderer::GlowOpenGlFallback;
        }
        if forced.eq_ignore_ascii_case("wgpu") {
            append_startup_log("[RENDERER_SELECT] Forced WGPU renderer via BEATGEM_RENDERER.");
            return SelectedRenderer::WgpuAccelerated;
        }
    }

    let instance = wgpu::Instance::default();
    let adapter_opt = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }));

    match adapter_opt {
        Some(adapter) => {
            let info = adapter.get_info();
            append_startup_log(&format!(
                "[GPU_PROBE] Adapter answered: {} ({:?})",
                info.name, info.backend
            ));
            SelectedRenderer::WgpuAccelerated
        }
        None => {
            append_startup_log(
                "[GPU_PROBE] No accelerated adapter answered; selecting OpenGL fallback path.",
            );
            SelectedRenderer::GlowOpenGlFallback
        }
    }
}

fn main() {
    append_startup_log("[BOOT] BeatGem v0.4.0 desktop binary starting.");

    panic::set_hook(Box::new(|panic_info| {
        append_startup_log(&format!("[PANIC] {}", panic_info));
    }));

    let renderer = probe_renderer_headless();
    append_startup_log(&format!(
        "[WINDOW_INIT] Initializing 4-page workspace shell on {:?}",
        renderer
    ));
}
