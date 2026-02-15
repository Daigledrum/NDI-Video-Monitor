const express = require('express');
const http = require('http');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

let wrtc = null;
try {
    wrtc = require('@koush/wrtc');
} catch (err) {
    console.warn('[WARN] wrtc not installed. WebRTC endpoints will be unavailable.');
}

// ─── UYVY422 TO I420 CONVERTER ──────────────────────────────────────────────
/**
 * Convert UYVY422 to I420 (YUV420p) format
 * UYVY422: 2 bytes per pixel (4 bytes = 2 pixels, UYVY pattern)
 * I420: 1.5 bytes per pixel (Y plane full, U/V planes 1/4 size)
 */
function convertUYVY422toI420(uyvyBuffer, width, height) {
    const ySize = width * height;
    const uvSize = (width * height) / 4;
    const i420Buffer = Buffer.allocUnsafe(ySize + uvSize * 2);
    
    let uIdx = ySize;
    let vIdx = ySize + uvSize;
    let srcLine = 0;
    
    // Process 2x2 pixel blocks  
    for (let y = 0; y < height; y += 2) {
        srcLine = y * width * 2; // Each line in UYVY is width * 2 bytes
        for (let x = 0; x < width; x += 2) {
            const idx0 = srcLine + x * 2;
            const idx1 = srcLine + width * 2 + x * 2;
            
            // First row of 2 pixels
            const u0 = uyvyBuffer[idx0];
            const y0 = uyvyBuffer[idx0 + 1];
            const v0 = uyvyBuffer[idx0 + 2];
            const y1 = uyvyBuffer[idx0 + 3];
            
            // Second row of 2 pixels
            const u1 = uyvyBuffer[idx1];
            const y2 = uyvyBuffer[idx1 + 1];
            const v1 = uyvyBuffer[idx1 + 2];
            const y3 = uyvyBuffer[idx1 + 3];
            
            // Write Y plane (2 rows worth)
            const yLineIdx = y * width + x;
            i420Buffer[yLineIdx] = y0;
            i420Buffer[yLineIdx + 1] = y1;
            i420Buffer[yLineIdx + width] = y2;
            i420Buffer[yLineIdx + width + 1] = y3;
            
            // Average U and V for 2x2 block and write to U/V planes
            const uIdx_pos = uIdx + (y / 2) * (width / 2) + (x / 2);
            const vIdx_pos = vIdx + (y / 2) * (width / 2) + (x / 2);
            
            i420Buffer[uIdx_pos] = Math.round((u0 + u1) / 2);
            i420Buffer[vIdx_pos] = Math.round((v0 + v1) / 2);
        }
    }
    
    return i420Buffer;
}

function clampByte(value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return value;
}

function convertPackedRGBtoI420(rgbaBuffer, width, height, pixelFormat) {
    const ySize = width * height;
    const uvSize = (width * height) / 4;
    const i420Buffer = Buffer.allocUnsafe(ySize + uvSize * 2);

    let rOffset = 0;
    let gOffset = 1;
    let bOffset = 2;

    switch (pixelFormat) {
        case 'ARGB':
            rOffset = 1;
            gOffset = 2;
            bOffset = 3;
            break;
        case 'BGRA':
            rOffset = 2;
            gOffset = 1;
            bOffset = 0;
            break;
        case 'ABGR':
            rOffset = 3;
            gOffset = 2;
            bOffset = 1;
            break;
        case 'RGBA':
        default:
            rOffset = 0;
            gOffset = 1;
            bOffset = 2;
            break;
    }

    // Y plane
    for (let y = 0; y < height; y++) {
        const rowStart = y * width * 4;
        const yRowStart = y * width;
        for (let x = 0; x < width; x++) {
            const idx = rowStart + x * 4;
            const r = rgbaBuffer[idx + rOffset];
            const g = rgbaBuffer[idx + gOffset];
            const b = rgbaBuffer[idx + bOffset];

            const yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            i420Buffer[yRowStart + x] = clampByte(yVal);
        }
    }

    // U and V planes (2x2 subsampling)
    const uStart = ySize;
    const vStart = ySize + uvSize;
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            let rSum = 0;
            let gSum = 0;
            let bSum = 0;
            let samples = 0;

            for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const px = x + dx;
                    const py = y + dy;
                    if (px >= width || py >= height) continue;

                    const idx = (py * width + px) * 4;
                    rSum += rgbaBuffer[idx + rOffset];
                    gSum += rgbaBuffer[idx + gOffset];
                    bSum += rgbaBuffer[idx + bOffset];
                    samples++;
                }
            }

            if (samples === 0) continue;

            const rAvg = Math.round(rSum / samples);
            const gAvg = Math.round(gSum / samples);
            const bAvg = Math.round(bSum / samples);

            const uVal = ((-38 * rAvg - 74 * gAvg + 112 * bAvg + 128) >> 8) + 128;
            const vVal = ((112 * rAvg - 94 * gAvg - 18 * bAvg + 128) >> 8) + 128;

            const uvIndex = (y / 2) * (width / 2) + (x / 2);
            i420Buffer[uStart + uvIndex] = clampByte(uVal);
            i420Buffer[vStart + uvIndex] = clampByte(vVal);
        }
    }

    return i420Buffer;
}

// ─── CONFIG ────────────────────────────────────────────────────────────────
const parsedPort = Number.parseInt(process.env.PORT || '', 10);
const HTTP_PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536
    ? parsedPort
    : 3001;
let NDI_SOURCE_NAME = null; // Will be auto-discovered

// ─── PLATFORM DETECTION ────────────────────────────────────────────────────
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// Configure NDI SDK paths based on platform
let NDI_SDK_PATH = '';
let NDI_LIB_PATH = '';
let NDI_INCLUDE_PATH = '';
let NDI_LIST_CMD = isWindows ? '.\\ndi_list.exe' : './ndi_list';
let NDI_RECV_CMD = isWindows ? '.\\ndi_recv.exe' : './ndi_recv';

function selectNDISdkPaths() {
    const candidates = [];

    if (isWindows) {
        candidates.push({
            sdk: 'C:\\Program Files\\NDI\\NDI 6 SDK',
            lib: 'C:\\Program Files\\NDI\\NDI 6 SDK\\lib\\x64',
            include: 'C:\\Program Files\\NDI\\NDI 6 SDK\\include'
        });
        candidates.push({
            sdk: 'C:\\Program Files\\NDI\\NDI 5 SDK',
            lib: 'C:\\Program Files\\NDI\\NDI 5 SDK\\lib\\x64',
            include: 'C:\\Program Files\\NDI\\NDI 5 SDK\\include'
        });
    } else if (isMac) {
        candidates.push({
            sdk: '/Library/NDI SDK for Apple',
            lib: '/Library/NDI SDK for Apple/lib/macOS',
            include: '/Library/NDI SDK for Apple/include'
        });
    } else if (isLinux) {
        candidates.push({
            sdk: '/opt/ndi',
            lib: '/opt/ndi/lib/x86_64-linux-gnu',
            include: '/opt/ndi/include'
        });
    }

    const selected = candidates.find((candidate) => {
        return fs.existsSync(candidate.include) && fs.existsSync(candidate.lib);
    });

    if (selected) {
        return selected;
    }

    return candidates[0] || { sdk: '', lib: '', include: '' };
}

const selectedNDISdk = selectNDISdkPaths();
NDI_SDK_PATH = selectedNDISdk.sdk;
NDI_LIB_PATH = selectedNDISdk.lib;
NDI_INCLUDE_PATH = selectedNDISdk.include;

console.log(`[CONFIG] Platform: ${process.platform}`);
console.log(`[CONFIG] NDI SDK: ${NDI_SDK_PATH}`);
console.log(`[CONFIG] NDI Include: ${NDI_INCLUDE_PATH}`);
console.log(`[CONFIG] NDI Lib: ${NDI_LIB_PATH}`);

try {
    const ndiVersionPath = path.join(NDI_SDK_PATH, 'Version.txt');
    if (NDI_SDK_PATH && fs.existsSync(ndiVersionPath)) {
        const sdkVersion = fs.readFileSync(ndiVersionPath, 'utf8').trim();
        console.log(`[CONFIG] NDI Version: ${sdkVersion}`);
    }
} catch (err) {
    console.warn('[WARN] Unable to read NDI Version.txt:', err.message);
}

if (!NDI_INCLUDE_PATH || !NDI_LIB_PATH || !fs.existsSync(NDI_INCLUDE_PATH) || !fs.existsSync(NDI_LIB_PATH)) {
    console.warn('[WARN] NDI SDK paths were not verified on disk. Install NDI SDK (preferably NDI 6) or update path detection.');
}

function getCompileCommand(binaryBaseName) {
    if (binaryBaseName !== 'ndi_recv' && binaryBaseName !== 'ndi_list') {
        throw new Error(`Unsupported native binary: ${binaryBaseName}`);
    }

    if (isWindows) {
        return `cl /nologo /O2 /Fe:${binaryBaseName}.exe ${binaryBaseName}.c /I"${NDI_INCLUDE_PATH}" /link /LIBPATH:"${NDI_LIB_PATH}" Processing.NDI.Lib.x64.lib`;
    }

    if (isMac || isLinux) {
        return `gcc -O3 -o ${binaryBaseName} ${binaryBaseName}.c -L"${NDI_LIB_PATH}" -lndi -I"${NDI_INCLUDE_PATH}" -Wl,-rpath,"${NDI_LIB_PATH}"`;
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
}

function ensureNativeBinary(binaryBaseName) {
    const compiledName = isWindows ? `${binaryBaseName}.exe` : binaryBaseName;
    const binaryPath = path.join(__dirname, compiledName);
    const sourcePath = path.join(__dirname, `${binaryBaseName}.c`);

    let needsCompile = true;
    if (fs.existsSync(binaryPath)) {
        try {
            const binStat = fs.statSync(binaryPath);
            const srcStat = fs.statSync(sourcePath);
            needsCompile = srcStat.mtimeMs > binStat.mtimeMs;
        } catch (err) {
            needsCompile = true;
        }
    }

    if (!needsCompile) {
        console.log(`[NDI] Using existing ${binaryBaseName} binary (up to date)`);
        return;
    }

    const compileCmd = getCompileCommand(binaryBaseName);
    execSync(compileCmd, {
        cwd: __dirname,
        stdio: 'pipe'
    });
    console.log(`[NDI] Compiled ${binaryBaseName}`);
}

function normalizeSourceName(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, '');
    if (!sanitized || sanitized.length > 256) return null;
    return sanitized;
}

// ─── EXPRESS SETUP ─────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// ─── API ENDPOINTS ─────────────────────────────────────────────────────────
app.get('/api/sources', (req, res) => {
    try {
        ensureNativeBinary('ndi_list');
        const output = execSync(NDI_LIST_CMD, { 
            cwd: __dirname,
            encoding: 'utf8',
            timeout: 5000
        });
        const data = JSON.parse(output.trim());
        res.json(data);
    } catch (err) {
        console.error('[API] Error listing sources:', err.message);
        res.status(500).json({ 
            error: 'Failed to list NDI sources', 
            details: err.message,
            sources: []
        });
    }
});

app.post('/api/start', (req, res) => {
    console.log('[API] Start request');
    if (req.body && req.body.source) {
        const sourceName = normalizeSourceName(req.body.source);
        if (!sourceName) {
            return res.status(400).json({ error: 'Invalid source name' });
        }
        NDI_SOURCE_NAME = sourceName;
        console.log(`[API] Source set to: ${NDI_SOURCE_NAME}`);
    }
    if (ndiProc && !ndiProc.killed) {
        return res.json({ status: 'already_running', message: 'Pipeline already running' });
    }
    startPipeline();
    res.json({ status: 'started', message: 'Pipeline started' });
});

app.post('/api/stop', (req, res) => {
    console.log('[API] Stop request');
    if (!ndiProc || ndiProc.killed) {
        return res.json({ status: 'already_stopped', message: 'Pipeline already stopped' });
    }
    cleanup();
    res.json({ status: 'stopped', message: 'Pipeline stopped' });
});

app.post('/api/switch', (req, res) => {
    console.log('[API] Switch source request');
    if (!req.body || !req.body.source) {
        return res.status(400).json({ error: 'No source specified' });
    }
    const newSource = normalizeSourceName(req.body.source);
    if (!newSource) {
        return res.status(400).json({ error: 'Invalid source name' });
    }
    console.log(`[API] Switching to source: ${newSource}`);
    switchNDISource(newSource);
    res.json({ status: 'switching', source: newSource });
});

app.get('/api/status', (req, res) => {
    res.json({
        running: !!(ndiProc && !ndiProc.killed),
        source: NDI_SOURCE_NAME
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        sourceName: NDI_SOURCE_NAME || 'No source',
        fps: currentFPS,
        latency: averageLatency,
        resolution: detectedResolution ? `${detectedResolution.width}x${detectedResolution.height}` : 'Unknown',
        running: !!(ndiProc && !ndiProc.killed),
        clients: rtcPeers.size
    });
});

app.get('/api/addresses', (req, res) => {
    const nets = os.networkInterfaces();
    const addresses = [];
    Object.keys(nets).forEach(name => {
        nets[name].forEach(net => {
            if (net.family === 'IPv4' && !net.internal) {
                addresses.push(net.address);
            }
        });
    });
    res.json({ addresses, port: HTTP_PORT });
});

// ─── WEBRTC SIGNALING ─────────────────────────────────────────────────────
app.post('/api/webrtc/offer', async (req, res) => {
    if (!wrtc) {
        return res.status(500).json({ error: 'WebRTC not available (wrtc not installed)' });
    }

    try {
        console.log('[WEBRTC] Offer received');
        const offer = req.body;
        if (!offer || !offer.sdp || !offer.type) {
            return res.status(400).json({ error: 'Invalid offer' });
        }

        const pc = createPeerConnection();
        await pc.setRemoteDescription(new wrtc.RTCSessionDescription(offer));

        // Ensure we have a track ready
        ensureWebRTCTrack();

        pc.addTrack(rtcVideoTrack);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await waitForIceGatheringComplete(pc);

        res.json(pc.localDescription);
    } catch (err) {
        console.error('[WEBRTC] Offer handling failed:', err);
        res.status(500).json({ error: 'Failed to create WebRTC answer', details: err.message });
    }
});

// ─── NDI → WEBRTC PIPELINE ─────────────────────────────────────────────────
let ndiProc = null;
let ndiVideoTee = null;
let detectedResolution = null; // Store NDI stream resolution

// WebRTC pipeline
let rtcFrameBuffer = Buffer.allocUnsafe(0);
let rtcVideoSource = null;
let rtcVideoTrack = null;
let rtcWidth = null;
let rtcHeight = null;
let rtcPipelineRunning = false;
const rtcPeers = new Set();
let rtcPendingStart = false;
let detectedPixelFormat = 'UYVY';

// ─── STATS TRACKING ────────────────────────────────────────────────────────
let frameCount = 0;
let lastFpsCheck = Date.now();
let currentFPS = 0;
let frameTimestamps = [];
let averageLatency = 0;



function startWebRTCPipeline(resolution) {
    if (!wrtc) return;
    if (rtcPipelineRunning) return;
    if (!ndiProc || ndiProc.killed) return;
    if (!resolution || !resolution.width || !resolution.height) return;

    rtcWidth = resolution.width;
    rtcHeight = resolution.height;
    rtcPipelineRunning = true;

    console.log(`[WEBRTC] Starting direct ${detectedPixelFormat} pipeline (${rtcWidth}x${rtcHeight})`);
    console.log('[WEBRTC] Using native JS conversion pipeline');

    // Set up direct streaming from NDI - use the existing tee if available
    const sourceStream = ndiVideoTee || ndiProc.stdout;
    
    // Only set up listener if we have a source
    if (sourceStream) {
        sourceStream.on('data', (chunk) => {
            processNDIFrame(chunk, rtcWidth, rtcHeight, detectedPixelFormat);
        });
        
        sourceStream.on('error', (err) => {
            console.error('[WEBRTC] Stream error:', err.message);
            stopWebRTCPipeline();
        });
    }
}

function processNDIFrame(chunk, width, height, pixelFormat) {
    rtcFrameBuffer = Buffer.concat([rtcFrameBuffer, chunk]);

    const normalizedFormat = (pixelFormat || 'UYVY').toUpperCase();
    const bytesPerPixel = normalizedFormat === 'UYVY' ? 2 : 4;
    const frameSize = width * height * bytesPerPixel;

    while (rtcFrameBuffer.length >= frameSize) {
        const frameStartTime = Date.now();

        // Extract one complete frame for the detected pixel format
        const rawFrame = rtcFrameBuffer.subarray(0, frameSize);
        rtcFrameBuffer = rtcFrameBuffer.subarray(frameSize);
        
        if (rtcVideoSource && rtcVideoTrack) {
            try {
                let i420Frame;

                if (normalizedFormat === 'UYVY') {
                    i420Frame = convertUYVY422toI420(rawFrame, width, height);
                } else if (normalizedFormat === 'ARGB' || normalizedFormat === 'BGRA' || normalizedFormat === 'RGBA' || normalizedFormat === 'ABGR') {
                    i420Frame = convertPackedRGBtoI420(rawFrame, width, height, normalizedFormat);
                } else {
                    console.warn(`[WEBRTC] Unsupported format ${normalizedFormat}, defaulting to UYVY decode`);
                    i420Frame = convertUYVY422toI420(rawFrame, width, height);
                }
                
                rtcVideoSource.onFrame({
                    width: width,
                    height: height,
                    data: new Uint8ClampedArray(i420Frame)
                });
                
                // Track FPS
                frameCount++;
                const now = Date.now();
                if (now - lastFpsCheck >= 1000) {
                    currentFPS = Math.round((frameCount * 1000) / (now - lastFpsCheck));
                    frameCount = 0;
                    lastFpsCheck = now;
                }
                
                // Track latency (processing time for this frame)
                const processingTime = Date.now() - frameStartTime;
                frameTimestamps.push(processingTime);
                if (frameTimestamps.length > 30) {
                    frameTimestamps.shift();
                }
                averageLatency = Math.round(
                    frameTimestamps.reduce((a, b) => a + b, 0) / frameTimestamps.length
                );
                
            } catch (err) {
                console.error('[WEBRTC] Failed to process frame:', err.message);
            }
        }
    }
}

function stopWebRTCPipeline() {
    rtcPipelineRunning = false;
    rtcFrameBuffer = Buffer.allocUnsafe(0);
    console.log('[WEBRTC] Pipeline stopped');
}

function ensureWebRTCTrack() {
    if (!wrtc) return;
    if (!rtcVideoSource) {
        rtcVideoSource = new wrtc.nonstandard.RTCVideoSource();
        rtcVideoTrack = rtcVideoSource.createTrack();
        console.log('[WEBRTC] Video source and track created');
    }

    rtcPendingStart = true;

    // If NDI is running and we have resolution, start the pipeline
    if (ndiProc && !ndiProc.killed && !rtcPipelineRunning) {
        // Check if we have a detected resolution from the NDI stream
        if (typeof detectedResolution !== 'undefined' && detectedResolution) {
            console.log('[WEBRTC] Starting pipeline with detected resolution:', detectedResolution);
            startWebRTCPipeline(detectedResolution);
        } else {
            console.log('[WEBRTC] Waiting for resolution detection...');
        }
    }
}

function createPeerConnection() {
    const pc = new wrtc.RTCPeerConnection({
        iceServers: []
    });

    rtcPeers.add(pc);

    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            rtcPeers.delete(pc);
            try { pc.close(); } catch (e) {}
            if (rtcPeers.size === 0) {
                stopWebRTCPipeline();
            }
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            rtcPeers.delete(pc);
            try { pc.close(); } catch (e) {}
            if (rtcPeers.size === 0) {
                stopWebRTCPipeline();
            }
        }
    };

    return pc;
}

function waitForIceGatheringComplete(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();

    return new Promise(resolve => {
        const check = () => {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            }
        };
        pc.addEventListener('icegatheringstatechange', check);
    });
}

function switchNDISource(sourceName) {
    console.log(`[NDI] Switching to source: ${sourceName}`);
    NDI_SOURCE_NAME = sourceName;
    cleanup();
    setTimeout(() => {
        startPipeline();
    }, 1000);
}

function startPipeline() {
    if (!NDI_SOURCE_NAME) {
        console.log('[NDI] No source selected yet, waiting...');
        return;
    }
    
    console.log('[NDI] Starting pipeline...');
    console.log(`[NDI] Target source: ${NDI_SOURCE_NAME}`);

    // Step 1: Compile ndi_recv if needed
    try {
        ensureNativeBinary('ndi_recv');
    } catch (err) {
        console.log('[NDI] Using existing ndi_recv binary:', err.message);
    }

    // Step 2: Start NDI receiver (outputs raw video in detected NDI format)
    ndiProc = spawn(NDI_RECV_CMD, [NDI_SOURCE_NAME], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']  // stderr to capture resolution
    });

    console.log('[NDI] Started ndi_recv');

    let resolutionDetected = false;
    const maxWaitTime = 5000; // 5 second timeout

    // Reset detected resolution for new pipeline
    detectedResolution = null;
    detectedPixelFormat = 'UYVY';

    // Handle stderr to detect resolution
    // Tee NDI stdout for multiple consumers
    ndiVideoTee = new PassThrough();
    ndiProc.stdout.pipe(ndiVideoTee);

    ndiProc.stderr.on('data', (data) => {
        const text = data.toString();
        console.error(text.trim());
        
        // Check for connection success
        if (text.includes('Connected to:')) {
            console.log('[NDI] Connected to source');
        }
        
        const fourccMatch = text.match(/fourcc=([A-Za-z0-9]{4})/);
        if (fourccMatch) {
            const parsedFormat = fourccMatch[1].toUpperCase();
            if (parsedFormat === 'UYVY' || parsedFormat === 'ARGB' || parsedFormat === 'BGRA' || parsedFormat === 'RGBA' || parsedFormat === 'ABGR') {
                if (detectedPixelFormat !== parsedFormat) {
                    detectedPixelFormat = parsedFormat;
                    console.log(`[NDI] Detected pixel format: ${detectedPixelFormat}`);
                }
            } else {
                console.warn(`[NDI] Unsupported fourcc '${parsedFormat}', falling back to UYVY handling`);
                detectedPixelFormat = 'UYVY';
            }
        }

        // Parse VIDEO resolution from stderr: [ndi_recv] VIDEO 1920x1080 fps=30.00
        const match = text.match(/VIDEO (\d+)x(\d+)/);
        if (match && !resolutionDetected) {
            detectedResolution = {
                width: parseInt(match[1]),
                height: parseInt(match[2])
            };
            resolutionDetected = true;
            console.log(`[NDI] Detected resolution: ${detectedResolution.width}x${detectedResolution.height}`);
            
            // Start WebRTC pipeline if needed
            if ((rtcPendingStart || rtcPeers.size > 0) && !rtcPipelineRunning) {
                startWebRTCPipeline(detectedResolution);
            }
        }
    });

    // Handle ndi_recv errors
    ndiProc.on('error', err => {
        console.error('[NDI] Process error:', err);
        cleanup();
    });

    ndiProc.on('exit', code => {
        console.log('[NDI] Process exited:', code);
        cleanup();
    });

    // Timeout: if no resolution detected after 5 seconds, fail
    const timeoutHandle = setTimeout(() => {
        if (!resolutionDetected) {
            console.error('[NDI] Failed to detect resolution within 5 seconds');
            console.error('[NDI] Make sure the NDI source is sending video data');
            cleanup();
        }
    }, maxWaitTime);

    // Store timeout handle so we can cancel it if resolution is detected
    ndiProc.timeoutHandle = timeoutHandle;
}



function cleanup() {
    console.log('[CLEANUP] Starting cleanup...');
    
    // Cancel any pending timeouts
    if (ndiProc && ndiProc.timeoutHandle) {
        clearTimeout(ndiProc.timeoutHandle);
    }

    // Stop WebRTC pipeline
    stopWebRTCPipeline();

    // Close WebRTC peers
    rtcPeers.forEach(pc => {
        try { pc.close(); } catch (e) {}
    });
    rtcPeers.clear();

    // Kill NDI receiver process
    if (ndiProc) {
        try {
            if (!ndiProc.killed) {
                console.log('[CLEANUP] Killing NDI receiver...');
                ndiProc.kill('SIGKILL');
            }
        } catch (e) {
            console.log('[CLEANUP] NDI receiver error:', e.message);
        }
    }

    ndiProc = null;
    ndiVideoTee = null;
    detectedResolution = null;
    detectedPixelFormat = 'UYVY';
    rtcPipelineRunning = false;
    
    console.log('[CLEANUP] Done');
}

// ─── START SERVER ──────────────────────────────────────────────────────────
server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Listening on http://localhost:${HTTP_PORT}`);
    const nets = os.networkInterfaces();
    const addresses = [];
    Object.keys(nets).forEach(name => {
        nets[name].forEach(net => {
            if (net.family === 'IPv4' && !net.internal) {
                addresses.push(net.address);
            }
        });
    });
    
    // Remove duplicates
    const uniqueAddresses = [...new Set(addresses)];
    
    if (uniqueAddresses.length > 0) {
        console.log('[SERVER] Access from other devices:');
        uniqueAddresses.forEach(addr => {
            console.log(`  http://${addr}:${HTTP_PORT}/webrtc_viewer.html`);
        });
    } else {
        console.log('[SERVER] No LAN IP detected. Make sure you are on Wi‑Fi/Ethernet.');
    }
    console.log(`[INFO] Auto-discovering NDI sources...`);
    
    // Auto-discover sources (but don't start pipeline yet)
    try {
        ensureNativeBinary('ndi_list');
        const output = execSync(NDI_LIST_CMD, { 
            cwd: __dirname,
            encoding: 'utf8',
            timeout: 5000
        });
        const data = JSON.parse(output.trim());
        if (data.sources && data.sources.length > 0) {
            NDI_SOURCE_NAME = data.sources[0].name;
            console.log(`[INFO] Found ${data.sources.length} source(s), ready: ${NDI_SOURCE_NAME}`);
            // Don't auto-start - wait for user to click Start button
            // startPipeline();
        } else {
            console.log(`[INFO] No NDI sources found. Waiting for client to select source...`);
        }
    } catch (err) {
        console.error('[INFO] Error discovering sources:', err.message);
        console.log('[INFO] Waiting for client to select source...');
    }
    console.log(`[INFO] Ready - click Start in the app to begin streaming`);
});

process.on('SIGINT', () => {
    console.log('\n[SERVER] Shutting down...');
    cleanup();
    server.close();
    process.exit(0);
});
