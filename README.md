# ChattyWrity

ChattyWrity is a global speech-to-text desktop application for Windows. It utilizes OpenAI's Whisper model (via C++ bindings) to provide high-accuracy, local, and private transcription. The application is designed to be overlay-based, activated via a global hotkey (Ctrl+Space), mimicking the experience of tools like Wispr Flow.

## Prerequisites

Before setting up the project, ensure your development environment meets the following requirements. This project relies on native Node.js modules which require C++ compilation tools.

### 1. Node.js
- Install Node.js (LTS version recommended, v18+).

### 2. Visual Studio Build Tools (Critical)
This project uses `nodejs-whisper` and other native modules that must be compiled during installation.
1.  Download **Visual Studio Build Tools**.
2.  During installation, select the **Desktop development with C++** workload.
3.  Ensure the **Windows 10/11 SDK** is checked in the optional components.
4.  Reboot your machine after installation.

### 3. Git
- Install Git for version control.

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/yourusername/chattywrity.git
    cd chattywrity
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```
    *Note: If this fails with `node-gyp` errors, verify your Visual Studio Build Tools installation.*

3.  Download the Whisper Model:
    The application requires a GGML quantization of the Whisper model.
    -   Create a directory named `models` in the project root.
    -   Download `ggml-small.en-q8_0.bin` (or your preferred compatible model) from HuggingFace.
    -   Place the `.bin` file inside the `models` directory.
    -   Ensure `src/main/transcriber.ts` references the correct filename.

## Development Workflow

To run the application in development mode with hot-reloading (via `tsc`):

```bash
npm run dev
```

This command will:
1.  Compile TypeScript files.
2.  Copy static assets (HTML/CSS) to the `dist` folder.
3.  Launch Electron.

### Key Hotkeys
-   **Ctrl+Space**: Toggle recording.
-   **Esc**: Cancel recording / Close overlay.

## Building for Production

To create a distributable Windows installer (`.exe`):

```bash
npm run build
```

This script:
1.  Compiles the TypeScript source.
2.  Copies assets.
3.  Uses `electron-builder` to package the application.

### Build Configuration Notes
-   **ASAR Unpacking**: The build configuration (in `package.json`) explicitly unpacks `nodejs-whisper` and `ffmpeg-static`. This is required because these native binaries cannot be executed directly from within the compressed ASAR archive.
-   **Compression**: Compression is set to `"store"` (no compression) to avoid memory allocation errors during the build process on systems with limited RAM.
-   **Icon**: The installer uses `resources/icon.png`.

The output installer will be located in the `dist` directory.
**Ready-to-install file:** `ChattyWrity Setup 1.0.0.exe`

## Project Structure

-   **src/main**: Backend Logic (Electron Main Process).
    -   `index.ts`: Application entry point, window management, global hotkey handling.
    -   `stateManager.ts`: Manages recording state and FFmpeg process.
    -   `transcriber.ts`: Interfaces with the local Whisper C++ binary.
    -   `textInjector.ts`: Handles text simulation (typing) into target applications.
    -   `aiProcessor.ts`: Post-processing (filler word removal, formatting).
    -   `styleManager.ts`: Detects active window to apply context-specific formatting.
    -   `startupManager.ts`: Registry manipulation for "Run on Startup".
-   **src/renderer**: Frontend UI.
    -   `index.html` / `renderer.ts`: The floating overlay UI.
    -   `settings.html` / `settings.ts`: Configuration window.
-   **resources**: Static assets (icons).
-   **models**: Local Whisper model binaries.

## Troubleshooting

### Microphone Detection Issues
If the application uses the wrong microphone:
-   The application attempts to prefer devices with "Realtek" in the name.
-   It uses `chcp 65001` to force UTF-8 encoding when listing devices via FFmpeg. This fixes issues with device names containing non-ASCII characters (e.g., "Réseau de microphones").

### Build Errors (node-gyp)
If `npm install` fails during the `node-gyp rebuild` step:
1.  Open PowerShell as Administrator.
2.  Run: `npm install --global --production windows-build-tools` (alternative to VS Build Tools).
3.  Or, configure npm to use your installed VS Build Tools:
    ```bash
    npm config set msvs_version 2022
    ```

### Runtime "Whisper executable not found"
Ensure the `models` folder exists in the root directory during development, and that the `extraResources` configuration in `package.json` correctly copies it to the production build resources.

## License

GNU General Public License v3.0 (GPLv3)
