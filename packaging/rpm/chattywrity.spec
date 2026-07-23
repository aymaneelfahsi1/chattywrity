Name: chattywrity
Version: 0.6.0
Release: 1%{?dist}
Summary: Desktop speech-to-text app using Whisper
License: GPL-3.0
URL: https://github.com/aymaneelfahsi1/chattywrity
BuildArch: x86_64
AutoReqProv: no
%define _binary_payload w10.zstdio
Requires: gtk3
Requires: libnotify
Requires: nss
Requires: libXtst
Requires: xdg-utils
Requires: at-spi2-core
Requires: ffmpeg
Recommends: wtype
Recommends: xdotool

%description
ChattyWrity is a desktop dictation app that transcribes speech locally with Whisper and inserts the text into the active application.

%prep

%build

%install
mkdir -p %{buildroot}/opt/ChattyWrity
cp -a %{project_dir}/dist/linux-unpacked/. %{buildroot}/opt/ChattyWrity/

mkdir -p %{buildroot}%{_datadir}/applications
cat > %{buildroot}%{_datadir}/applications/chattywrity.desktop <<EOF
[Desktop Entry]
Type=Application
Name=ChattyWrity
Exec=/opt/ChattyWrity/chattywrity
Icon=chattywrity
Terminal=false
Categories=Utility;Audio;
StartupWMClass=chattywrity
Actions=ToggleRecording;

[Desktop Action ToggleRecording]
Name=Toggle Recording
Exec=/opt/ChattyWrity/chattywrity --toggle-recording
EOF

mkdir -p %{buildroot}%{_datadir}/icons/hicolor/256x256/apps
cp %{project_dir}/resources/icon.png %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/chattywrity.png

%files
/opt/ChattyWrity
%{_datadir}/applications/chattywrity.desktop
%{_datadir}/icons/hicolor/256x256/apps/chattywrity.png
