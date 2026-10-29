# Subtitle QC

Subtitle conform and QC tool: language checks for subtitle folders (TTML, IMSC, iTT, DFXP, XML, WebVTT) and a
QC player with waveform, frame-accurate timecode and subtitle rendering.

- **Mac app** (`mac/`): the interface in a native window, with video played by AVFoundation (ProRes,
  H.264, HEVC), native waveforms and real folders. Universal (Apple Silicon + Intel), macOS 13 or later.
- **Web version** (`web/`): the same interface as a single offline HTML file for Chrome
  (also published with every build as `Subtitle_QC.html`).

## Getting the app
Download page: **https://danmurciano.github.io/subtitle-qc-player/** (always the latest build).

Every push to `main` builds the app on GitHub (Actions tab) and publishes it under
**Releases → latest → Subtitle-QC.zip**.

1. Download and unzip `Subtitle-QC.zip`, move **Subtitle QC** to Applications.
2. First launch only — the app isn't signed with a paid Apple Developer ID, so macOS asks once:
   - macOS 13–14: right-click the app → **Open** → **Open**.
   - macOS 15: open it once (it will be blocked), then **System Settings → Privacy & Security** →
     **Open Anyway**.

Problems are logged to `~/Library/Logs/Subtitle QC/app.log` (Help ▸ Show Log File).

## Building locally (optional)
On a Mac with the Xcode command-line tools: `bash mac/build.sh` → `build/Subtitle QC.app`.
The web version alone: `cd web && python3 build.py` → `web/dist/Subtitle_QC.html`.
