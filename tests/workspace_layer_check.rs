//! Workspace Architecture Layer Enforcement Test (Section 11.3)
//!
//! Verifies that:
//! 1. Lower crates never import upward (e.g. `core` never depends on `audio`, `media`, `platform`, `render`, `engine`, `app`, or `cli`).
//! 2. Nothing below `beatgem-app` depends on the interface toolkit (`egui`, `eframe`, `winit`).
//! 3. Nothing outside `beatgem-platform` names a codec binding (`ffmpeg-next`, `rsmpeg`) or vendor hardware API.

use std::fs;
use std::path::Path;

#[derive(Debug)]
struct CrateRule {
    crate_dir: &'static str,
    allowed_workspace_deps: &'static [&'static str],
    allow_ui_toolkit: bool,
    allow_codec_bindings: bool,
}

const LAYER_RULES: &[CrateRule] = &[
    CrateRule {
        crate_dir: "crates/core",
        allowed_workspace_deps: &[],
        allow_ui_toolkit: false,
        allow_codec_bindings: false,
    },
    CrateRule {
        crate_dir: "crates/audio",
        allowed_workspace_deps: &["beatgem-core"],
        allow_ui_toolkit: false,
        allow_codec_bindings: false,
    },
    CrateRule {
        crate_dir: "crates/platform",
        allowed_workspace_deps: &["beatgem-core"],
        allow_ui_toolkit: false,
        allow_codec_bindings: true,
    },
    CrateRule {
        crate_dir: "crates/media",
        allowed_workspace_deps: &["beatgem-core", "beatgem-platform"],
        allow_ui_toolkit: false,
        allow_codec_bindings: false,
    },
    CrateRule {
        crate_dir: "crates/render",
        allowed_workspace_deps: &["beatgem-core", "beatgem-platform"],
        allow_ui_toolkit: false,
        allow_codec_bindings: false,
    },
    CrateRule {
        crate_dir: "crates/engine",
        allowed_workspace_deps: &[
            "beatgem-core",
            "beatgem-audio",
            "beatgem-media",
            "beatgem-platform",
            "beatgem-render",
        ],
        allow_ui_toolkit: false,
        allow_codec_bindings: false,
    },
    CrateRule {
        crate_dir: "crates/app",
        allowed_workspace_deps: &[
            "beatgem-core",
            "beatgem-audio",
            "beatgem-media",
            "beatgem-platform",
            "beatgem-render",
            "beatgem-engine",
        ],
        allow_ui_toolkit: true,
        allow_codec_bindings: false,
    },
    CrateRule {
        crate_dir: "crates/cli",
        allowed_workspace_deps: &[
            "beatgem-core",
            "beatgem-audio",
            "beatgem-media",
            "beatgem-platform",
            "beatgem-render",
            "beatgem-engine",
        ],
        allow_ui_toolkit: false,
        allow_codec_bindings: false,
    },
];

#[test]
fn enforce_workspace_dependency_direction_and_borders() {
    let all_workspace_crates = [
        "beatgem-core",
        "beatgem-audio",
        "beatgem-platform",
        "beatgem-media",
        "beatgem-render",
        "beatgem-engine",
        "beatgem-app",
        "beatgem-cli",
    ];

    for rule in LAYER_RULES {
        let cargo_toml_path = Path::new(rule.crate_dir).join("Cargo.toml");
        let manifest = fs::read_to_string(&cargo_toml_path)
            .unwrap_or_else(|_| panic!("Missing Cargo.toml at {:?}", cargo_toml_path));

        for candidate in &all_workspace_crates {
            if manifest.contains(candidate)
                && !manifest.contains(&format!("name = \"{}\"", candidate))
                && !rule.allowed_workspace_deps.contains(candidate)
            {
                panic!(
                    "Layer violation in {}: forbidden upward dependency on {}",
                    rule.crate_dir, candidate
                );
            }
        }

        if !rule.allow_ui_toolkit {
            for ui_crate in ["egui", "eframe", "winit"] {
                assert!(
                    !manifest.contains(ui_crate),
                    "Layer violation in {}: lower module must never depend on UI toolkit '{}'",
                    rule.crate_dir,
                    ui_crate
                );
            }
        }

        if !rule.allow_codec_bindings {
            for codec_crate in ["ffmpeg-next", "ffmpeg-sys-next", "rsmpeg"] {
                assert!(
                    !manifest.contains(codec_crate),
                    "Layer violation in {}: only beatgem-platform may reference codec library '{}'",
                    rule.crate_dir,
                    codec_crate
                );
            }
        }
    }
}
