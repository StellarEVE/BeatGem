# BeatGem v0.1.0 Windows Release Pipeline (Section 16)
# Configures dynamic codec linking, runs workspace tests & layer enforcement, and stages portable + installer packages.
$ErrorActionPreference = "Stop"
$Version = "0.1.0"

Write-Host "==> 1. Configuring Windows dynamic codec linking environment variables (v$Version)..."
if (-not $env:FFMPEG_DLL_PATH) {
    $env:FFMPEG_DLL_PATH = "$PSScriptRoot\..\target\deps\ffmpeg-shared\lib"
}
if (-not $env:FFMPEG_INCLUDE_DIR) {
    $env:FFMPEG_INCLUDE_DIR = "$PSScriptRoot\..\target\deps\ffmpeg-shared\include"
}
if (-not $env:LIBCLANG_PATH) {
    $env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
}

Write-Host "    FFMPEG_DLL_PATH    = $env:FFMPEG_DLL_PATH"
Write-Host "    FFMPEG_INCLUDE_DIR = $env:FFMPEG_INCLUDE_DIR"
Write-Host "    LIBCLANG_PATH      = $env:LIBCLANG_PATH"

Write-Host "==> 2. Running full workspace test suite & layer dependency check..."
cargo test --workspace

Write-Host "==> 3. Building release executables (beatgem-app.exe & beatgem-cli.exe)..."
cargo build --release --workspace

Write-Host "==> 4. Staging self-contained portable package with dynamic codec libraries..."
$StageDir = "$PSScriptRoot\..\target\stage\BeatGem-v$Version-Windows-x64"
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
Copy-Item "target\release\beatgem-app.exe" $StageDir
Copy-Item "target\release\beatgem-cli.exe" $StageDir
Copy-Item "README.md" $StageDir
Copy-Item "LICENSE" $StageDir
Copy-Item "CHANGELOG.md" $StageDir

$DllDir = "$PSScriptRoot\..\target\deps\ffmpeg-shared\bin"
if (Test-Path $DllDir) {
    Copy-Item "$DllDir\*.dll" $StageDir
}

New-Item -ItemType Directory -Force -Path "$PSScriptRoot\..\dist" | Out-Null
$ZipOut = "$PSScriptRoot\..\dist\BeatGem-v$Version-Windows-x64-Portable.zip"
Compress-Archive -Path "$StageDir\*" -DestinationPath $ZipOut -Force
Write-Host "==> Release staging complete: $ZipOut"
