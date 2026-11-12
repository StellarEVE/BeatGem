; BeatGem v0.1.0 Inno Setup Installer Script (Section 16)
#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif
#ifndef StageDir
  #define StageDir "..\target\stage\BeatGem-v0.1.0-Windows-x64"
#endif

[Setup]
AppId={{E3259059-9648-43BE-B45B-C8C258FEBB43}
AppName=BeatGem
AppVersion={#MyAppVersion}
AppPublisher=BeatGem Contributors
DefaultDirName={autopf}\BeatGem
DefaultGroupName=BeatGem
LicenseFile=..\LICENSE
OutputBaseFilename=BeatGem-v{#MyAppVersion}-Windows-x64-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\BeatGem"; Filename: "{app}\beatgem-app.exe"
Name: "{autodesktop}\BeatGem"; Filename: "{app}\beatgem-app.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\beatgem-app.exe"; Description: "{cm:LaunchProgram,BeatGem}"; Flags: nowait postinstall skipifsilent
