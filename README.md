# NDI Video Monitor

Real-time NDI video monitoring with:
- Electron desktop app
- Web-based WebRTC viewer
- Native NDI helper binaries (`ndi_recv` and `ndi_list`)

## Current Status

- Cross-platform support: macOS, Windows, Linux
- NDI SDK support: NDI 6 preferred (Windows falls back to NDI 5 if needed)
- Video formats handled: UYVY, ARGB/BGRA/RGBA/ABGR
- Runtime conversion path: native JS conversion to I420 for WebRTC

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run preflight checks:
   ```bash
   npm run preflight
   ```
3. Start desktop app:
   ```bash
   npm start
   ```

Or run server only:
```bash
npm run server
```

## Custom Port

Default server port is `3001`.

macOS/Linux:
```bash
PORT=3002 npm start
```

Windows (cmd):
```cmd
set PORT=3002&& npm start
```

## Installation Guides

Detailed installation and setup:
- See `INSTALL.md` for macOS and Windows end-user setup.

## Development

### Scripts

- `npm start` - Launch Electron app
- `npm run dev` - Launch Electron app (dev mode)
- `npm run server` - Start Node server only
- `npm run preflight` - Cross-platform environment checks
- `npm run security:check` - Dependency vulnerability scan (high+)
- `npm run build-mac` - Build macOS app package
- `npm run build-win` - Build Windows app package

### Native Helpers

The app auto-compiles `ndi_recv` and `ndi_list` when needed.
Manual compile examples:

macOS/Linux:
```bash
gcc -O3 -o ndi_recv ndi_recv.c -L"<NDI_LIB_PATH>" -lndi -I"<NDI_INCLUDE_PATH>" -Wl,-rpath,"<NDI_LIB_PATH>"
gcc -O3 -o ndi_list ndi_list.c -L"<NDI_LIB_PATH>" -lndi -I"<NDI_INCLUDE_PATH>" -Wl,-rpath,"<NDI_LIB_PATH>"
```

Windows (Developer Command Prompt):
```cmd
cl /nologo /O2 /Fe:ndi_recv.exe ndi_recv.c /I"<NDI_INCLUDE_PATH>" /link /LIBPATH:"<NDI_LIB_PATH>" Processing.NDI.Lib.x64.lib
cl /nologo /O2 /Fe:ndi_list.exe ndi_list.c /I"<NDI_INCLUDE_PATH>" /link /LIBPATH:"<NDI_LIB_PATH>" Processing.NDI.Lib.x64.lib
```

## Security and Release Readiness

Before pushing to GitHub:

1. Run preflight:
   ```bash
   npm run preflight
   ```
2. Run dependency audit:
   ```bash
   npm run security:check
   ```
3. Ensure no secrets are committed:
   - `.env` and local credentials must stay out of git
   - verify `.gitignore` rules before commit
4. Build on your target platform:
   ```bash
   npm run build-mac
   # or
   npm run build-win
   ```

## API Endpoints

- `GET /api/sources` - List available NDI sources
- `POST /api/start` - Start pipeline (optional body: `{ "source": "name" }`)
- `POST /api/stop` - Stop pipeline
- `POST /api/switch` - Switch source (`{ "source": "name" }`)
- `GET /api/status` - Pipeline status
- `GET /api/stats` - FPS, latency, resolution, clients
- `GET /api/addresses` - Reachable network addresses

## Notes

- Source names are normalized and validated on API input.
- `ndi_list` JSON output is escaped safely for robust parsing.
- Audio streaming is not currently implemented.

## License

MIT. See `LICENSE`.
