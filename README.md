# NDI Video Monitor

A real-time NDI (Network Device Interface) video monitor with both a desktop application and web-based interface. Stream NDI sources with an Electron desktop app or access via web browser. Built with Electron, Node.js, Express, FFmpeg, and the NDI SDK.

## Features

- 🖥️ **Desktop Application** - Native Electron app (NDI Server Control) with built-in GUI
- 🎥 **Live NDI Streaming** - Stream NDI sources to web browsers in real-time
- 📡 **Source Discovery** - Automatically detect available NDI sources on your network
- 🔄 **Dynamic Switching** - Switch between NDI sources from the web interface
- 📱 **Responsive Design** - Works on desktop and iPad
- ⚡ **Low Latency** - JPEG streaming via WebSocket for smooth playback

## System Requirements

### macOS (Apple Silicon or Intel)
- macOS 10.13 or later
- NDI SDK for Apple
- FFmpeg
- Node.js 14+

### Other Platforms
Currently tested on macOS. Porting to Windows/Linux requires adjusting:
- NDI library path
- C compiler flags
- Binary naming conventions

## Prerequisites

### 1. Install NDI SDK for Apple

Download from [NDI Official Website](https://ndi.tv/download/) and install to `/Library/NDI SDK for Apple/`

Verify installation:
```bash
ls /Library/NDI\ SDK\ for\ Apple/lib/macOS/
```

### 2. Install FFmpeg

Using Homebrew:
```bash
brew install ffmpeg
```

Verify:
```bash
ffmpeg -version
```

### 3. Install Node.js

Using Homebrew:
```bash
brew install node
```

Or download from [nodejs.org](https://nodejs.org/)

Verify:
```bash
node --version
npm --version
```

## Installation

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd ndi-video-monitor
```

Replace `<your-repository-url>` with your actual GitHub repository URL.

### 2. Install Node Dependencies

```bash
npm install
```

This installs:
- `express` - Web server framework
- `ws` - WebSocket support
- `canvas` - Image manipulation
- `electron` - Desktop application framework
- `electron-builder` - Application packaging

## Usage

You can run this application in two ways:

### Option 1: Desktop Application (Recommended)

**Start the Electron desktop app:**
```bash
npm start
```

This launches **NDI Server Control**, a native desktop application with:
- Built-in NDI stream viewer
- Automatic server management (starts/stops with the app)
- Native window controls
- System integration

**Development mode** (with dev tools):
```bash
npm run dev
```

**Build standalone app:**
```bash
npm run build-mac
```
Creates a distributable `.dmg` file in the `dist/` folder.

### Option 2: Web Server Only

If you prefer to run just the web server without the desktop app:

### 3. Compile NDI Tools

The server will auto-compile these, but you can pre-compile:

**NDI Receiver** (captures NDI streams):
```bash
gcc -o ndi_recv ndi_recv.c \
  -L/Library/NDI\ SDK\ for\ Apple/lib/macOS \
  -lndi \
  -I/Library/NDI\ SDK\ for\ Apple/include \
  -Wl,-rpath,/Library/NDI\ SDK\ for\ Apple/lib/macOS
```

**NDI Source Lister** (discovers available sources):
```bash
gcc -o ndi_list ndi_list.c \
  -L/Library/NDI\ SDK\ for\ Apple/lib/macOS \
  -lndi \
  -I/Library/NDI\ SDK\ for\ Apple/include \
  -Wl,-rpath,/Library/NDI\ SDK\ for\ Apple/lib/macOS
```

### Option 2: Web Server Only

If you prefer to run just the web server without the desktop app:

**Start the server:**
```bash
npm run server
```
Or:
```bash
node ndi_server.js
```

You should see:
```
[OK] ffmpeg found
[SERVER] Listening on http://localhost:3001
[INFO] Auto-discovering NDI sources...
[INFO] Found 1 source(s), using: YOUR-SOURCE-NAME
[NDI] Starting pipeline...
[NDI] Started ndi_recv
[FFMPEG] Started encoding pipeline
```

**Access the web interface** at `http://localhost:3001/ndi_auto.html`

## Configuration

Edit `ndi_server.js` if needed:

```javascript
// ─── CONFIG ────────────────────────────────────────────────────────────────
const HTTP_PORT = 3001;              // Web server port
const JPEG_QUALITY = 80;             // JPEG quality (1-100, higher = better)
// NDI sources are auto-discovered, no need to configure source names
```

## Web Interface Features

**Available viewers:**
- `http://localhost:3001/ndi_auto.html` - **Recommended**: Auto-discovery with source switching
- `http://localhost:3001/viewer.html` - Simple viewer with manual source selection  
- `http://localhost:3001/ndi_viewer.html` - Legacy viewer

**Features:**
- **Status Indicator** (top-left): Shows connection status
  - 🟢 Connected - receiving video frames
  - 🔴 Disconnected - waiting for source or connection lost
  
- **Source Dropdown** (top-right): 
  - Lists all discovered NDI sources
  - Click to switch streams in real-time
  - Auto-populated from your network

### Using on iPad/Remote Machine

To access from another device on your network:

1. Find your machine's IP address:
   ```bashndi_auto.html
   ```

Example: `http://192.168.1.100:3001/ndi_auto
2. Access from iPad/other machine:
   ```
   http://YOUR_MACHINE_IP:3001/viewer.html
   ```

Example: `http://192.168.1.100:3001/viewer.html`

## File Structure

```
├── main.js                # Electron main process
├── preload.js             # Electron preload script
├── ndi_server.js          # Node.js server with NDI integration
├── ndi_recv.c             # C program to receive NDI streams
├── ndi_list.c             # C program to discover NDI sources
├── package.json           # Node dependencies and scripts
├── package-lock.json      # Dependency lock file
├── README.md              # This file
├── gui/                   # Desktop application UI
│   ├── index.html         # Electron window HTML
│   ├── renderer.js        # Electron renderer process
│   └── styles.css         # Desktop app styling
└── public/                # Web interface files
    ├── ndi_auto.html      # Main viewer with auto-discovery
    ├── viewer.html        # Simple viewer
    └── ndi_viewer.html    # Legacy viewer
```

## Troubleshooting

### "Library not loaded: @rpath/libndi.dylib"

The NDI library path is missing. Ensure you compiled with `-Wl,-rpath`:

```bash
gcc -o ndi_recv ndi_recv.c \
  -L/Library/NDI\ SDK\ for\ Apple/lib/macOS \
  -lndi \
  -I/Library/NDI\ SDK\ for\ Apple/include \
  -Wl,-rpath,/Library/NDI\ SDK\ for\ Apple/lib/macOS
```

### No NDI sources appearing in dropdown

1. **Check NDI sources are running** on your network
2. **Test source discovery**:
   ```bash
   ./ndi_list
   ```
   Should output JSON with available sources

3. **Check server logs** for errors with the API endpoint

### Video stream showing but colors distorted

This usually means incorrect color format. The server uses `UYVY_BGRA` format. If you need different formats, edit `ndi_recv.c`:

```c
recv_create.color_format = NDIlib_recv_color_format_UYVY_BGRA;  // Change this
```

Then recompile.

### "Port 3001 already in use"

Change the port in `ndi_server.js`:
```javascript
const HTTP_PORT = 3002;  // Use different port
```

### Server disconnects when switching sources

This is normal behavior - the server stops the current stream and starts a new one. Takes 1-2 seconds to reconnect.

## Performance Optimization

### Adjust JPEG Quality

Lower quality = lower bandwidth, faster streaming:

```javascript
const JPEG_QUALITY = 60;  // Lower = smaller files
```

### Adjust Frame Size

In `ndi_server.js`, FFmpeg parameters:

```javascript
ffmpegProc = spawn('ffmpeg', [
    ...
    '-s', '1920x1080',  // Change resolution
    '-r', '30',         // Change frame rate
    ...
]);
```

## Development

### Project Structure

- **Desktop App**: Electron-based native application (main.js, preload.js, gui/)
- **Backend**: Node.js + Express server with WebSocket support (ndi_server.js)
- **C Bindings**: Native NDI SDK access via compiled C programs (ndi_recv.c, ndi_list.c)
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Streaming**: JPEG frames via WebSocket + base64 encoding

### Extending the Project

**Add Recording**:
```javascript
// In broadcastFrame():
fs.appendFileSync('stream.raw', jpegFrame);
```

**Add Statistics**:
```javascript
let frameCount = 0;
ws.onmessage = () => {
  frameCount++;
  console.log(`[STATS] ${frameCount} frames sent`);
};
```

**Stream to Multiple Destinations**:
Modify the WebSocket broadcaster to send to HTTP streams, RTMP, etc.

## Known Limitations

- ✅ macOS only (requires porting for Linux/Windows)
- ✅ Single NDI source per server instance
- ✅ No audio streaming (video only)
- ✅ JPEG streaming adds latency (~100-200ms)

## License

MIT License - See LICENSE file for details

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review server console output for errors
3. Open an issue on GitHub

## Contributing

Pull requests welcome! Please:
1. Test on macOS
2. Update documentation
3. Follow existing code style

## Resources

- [NDI Official Documentation](https://ndi.tv/)
- [NDI SDK Download](https://ndi.tv/download/)
- [FFmpeg Documentation](https://ffmpeg.org/)
- [Express.js Guide](https://expressjs.com/)

---

**Last Updated**: February 1, 2026
