# Installation Guide (macOS and Windows)

## macOS

### Prerequisites

1. Install NDI SDK for Apple
   - Download from https://ndi.tv/download/
   - Default install path: `/Library/NDI SDK for Apple`
2. Install Node.js 18+
   - https://nodejs.org/ or Homebrew
3. Ensure Xcode Command Line Tools are present
   ```bash
   xcode-select --install
   ```

### Setup

```bash
git clone <your-repo-url>
cd ndi-video-monitor
npm install
npm run preflight
npm start
```

If port `3001` is already in use:
```bash
PORT=3002 npm start
```

---

## Windows

### Prerequisites

1. Install NDI SDK
   - Preferred: NDI 6 SDK
   - Fallback supported: NDI 5 SDK
   - Typical paths:
     - `C:\Program Files\NDI\NDI 6 SDK`
     - `C:\Program Files\NDI\NDI 5 SDK`
2. Install Node.js 18+
   - https://nodejs.org/
3. Install Visual C++ Build Tools
   - Required if native helpers compile from source

### Setup

Open PowerShell or Command Prompt:

```cmd
git clone <your-repo-url>
cd ndi-video-monitor
npm install
npm run preflight
npm start
```

If port `3001` is already in use:
```cmd
set PORT=3002&& npm start
```

---

## Verify Installation

You should see logs similar to:
- `[CONFIG] Platform: ...`
- `[CONFIG] NDI SDK: ...`
- `[CONFIG] NDI Version: ...`
- `[SERVER] Listening on http://localhost:<port>`

---

## Common Issues

### "No NDI sources found"
- Confirm an NDI source is actively broadcasting.
- Ensure sender and receiver are on the same network.

### "Failed to compile native binary"
- macOS/Linux: install gcc/clang toolchain.
- Windows: install Visual C++ Build Tools and run from Developer Command Prompt.

### "Port already in use"
- Run on a different port using `PORT` env var as shown above.

---

## Pre-release Checks

Before publishing or tagging a release:

```bash
npm run preflight
npm run security:check
```
