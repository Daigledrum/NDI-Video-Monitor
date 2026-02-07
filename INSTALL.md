# Quick Installation Guide for End Users

## For Mac Users

### Prerequisites
1. **Install NDI SDK:**
   - Download from [ndi.tv](https://ndi.tv/download/)
   - Run the installer (installs to `/Library/NDI SDK for Apple/`)

2. **Install FFmpeg:**
   ```bash
   brew install ffmpeg
   ```
   If you don't have Homebrew, install it from [brew.sh](https://brew.sh)

### Installation
1. Download `NDI Server Control.dmg`
2. Open the DMG file
3. Drag "NDI Server Control" to your Applications folder
4. Launch from Applications

---

## For Windows Users

### Prerequisites
1. **Install NDI SDK:**
   - Download from [ndi.tv](https://ndi.tv/download/)
   - Run the installer (default: `C:\Program Files\NDI\NDI 5 SDK\`)

2. **Install FFmpeg:**
   - Using Chocolatey: `choco install ffmpeg`
   - Or download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH

### Installation
1. Download `NDI Server Control Setup.exe`
2. Run the installer
3. Follow the installation wizard
4. Launch from Start Menu or Desktop shortcut

---

## Using the Application

1. **Launch the app** - The server starts automatically
2. **View network addresses** - Look at the bottom of the app window
3. **Scan QR code** - Use your phone/tablet camera to connect instantly
4. **Or manually enter URL** - Open the displayed URL on your device's browser

### Connecting Devices

**Quick Connect (Recommended):**
- Scan the QR code with your phone/tablet camera
- Browser opens automatically to the viewer

**Manual Connect:**
- On your iPad/Phone, open Safari/Chrome
- Enter the URL shown in the app (e.g., `http://192.168.1.100:3001/webrtc_viewer.html`)

### Controls

- **Start/Stop** - Control the NDI stream
- **Source Selection** - Choose which NDI source to monitor
- **Switch** - Change sources on the fly

---

## Troubleshooting

**"No NDI sources found"**
- Make sure your NDI source is running on the network
- Check firewall settings (allow port 5960-5961 for NDI)

**"Connection failed"**
- Ensure all devices are on the same network
- Try disabling firewall temporarily
- Check that port 3001 is not blocked

**"WebRTC not supported"**
- Update your browser (Chrome/Safari recommended)
- iOS requires Safari (WebRTC built-in)

---

## System Requirements

- **Mac:** macOS 10.13 or later
- **Windows:** Windows 10 (Build 1909) or later
- **Network:** WiFi or Ethernet (no internet required)
- **Client Devices:** Any device with modern web browser
