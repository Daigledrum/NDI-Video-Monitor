const express = require('express');
const http = require('http');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const os = require('os');
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
    
    let yIdx = 0;
    let uIdx = ySize;
    let vIdx = ySize + uvSize;
    let src = 0;
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

// ─── CONFIG ────────────────────────────────────────────────────────────────
const HTTP_PORT = 3001;
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
let NDI_RECV_COMPILED = isWindows ? 'ndi_recv.exe' : 'ndi_recv';

if (isWindows) {
    NDI_SDK_PATH = 'C:\\Program Files\\NDI\\NDI 5 SDK';
    NDI_LIB_PATH = NDI_SDK_PATH + '\\lib\\x64';
    NDI_INCLUDE_PATH = NDI_SDK_PATH + '\\include';
} else if (isMac) {
    NDI_SDK_PATH = '/Library/NDI SDK for Apple';
    NDI_LIB_PATH = NDI_SDK_PATH + '/lib/macOS';
    NDI_INCLUDE_PATH = NDI_SDK_PATH + '/include';
} else if (isLinux) {
    NDI_SDK_PATH = '/opt/ndi';
    NDI_LIB_PATH = NDI_SDK_PATH + '/lib/x86_64-linux-gnu';
    NDI_INCLUDE_PATH = NDI_SDK_PATH + '/include';
}

console.log(`[CONFIG] Platform: ${process.platform}`);
console.log(`[CONFIG] NDI SDK: ${NDI_SDK_PATH}`);

// ─── VERIFY DEPENDENCIES ───────────────────────────────────────────────────
try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    console.log('[OK] ffmpeg found');
} catch {
    const installCmd = isWindows 
        ? 'choco install ffmpeg' 
        : isMac 
        ? 'brew install ffmpeg' 
        : 'sudo apt-get install ffmpeg';
    console.error(`[FATAL] ffmpeg not installed. Install: ${installCmd}`);
    process.exit(1);
}

// ─── EXPRESS SETUP ─────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// ─── API ENDPOINTS ─────────────────────────────────────────────────────────
app.get('/api/sources', (req, res) => {
    const { execSync } = require('child_process');
    try {
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
        NDI_SOURCE_NAME = req.body.source;
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
    const newSource = req.body.source;
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
const RTC_TARGET_FPS = 15;
const RTC_TARGET_WIDTH = 1280;
const RTC_TARGET_HEIGHT = 720;
let rtcPendingStart = false;

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

    console.log(`[WEBRTC] Starting direct UYVY422 pipeline (${rtcWidth}x${rtcHeight})`);
    console.log(`[WEBRTC] Skipping ffmpeg - using native JS conversion`);

    // Set up direct streaming from NDI - use the existing tee if available
    const sourceStream = ndiVideoTee || ndiProc.stdout;
    
    // Only set up listener if we have a source
    if (sourceStream) {
        sourceStream.on('data', (chunk) => {
            processUYVYFrame(chunk, rtcWidth, rtcHeight);
        });
        
        sourceStream.on('error', (err) => {
            console.error('[WEBRTC] Stream error:', err.message);
            stopWebRTCPipeline();
        });
    }
}

function processUYVYFrame(chunk, width, height) {
    rtcFrameBuffer = Buffer.concat([rtcFrameBuffer, chunk]);
    
    const uyvyFrameSize = width * height * 2;
    
    while (rtcFrameBuffer.length >= uyvyFrameSize) {
        const frameStartTime = Date.now();
        
        // Extract one complete UYVY frame
        const uyvyFrame = rtcFrameBuffer.subarray(0, uyvyFrameSize);
        rtcFrameBuffer = rtcFrameBuffer.subarray(uyvyFrameSize);
        
        if (rtcVideoSource && rtcVideoTrack) {
            try {
                // Convert UYVY422 to I420 in-place
                const i420Frame = convertUYVY422toI420(uyvyFrame, width, height);
                
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
        let compileCmd = '';
        if (isWindows) {
            // Windows: cl.exe (MSVC) - adjust path if needed
            compileCmd = `cl /Fe:ndi_recv.exe ndi_recv.c /I"${NDI_INCLUDE_PATH}" /link /LIBPATH:"${NDI_LIB_PATH}" Processing.NDI.Lib.h`;
        } else if (isMac) {
            // macOS with gcc/clang
            compileCmd = `gcc -o ndi_recv ndi_recv.c -L"${NDI_LIB_PATH}" -lndi -I"${NDI_INCLUDE_PATH}" -Wl,-rpath,"${NDI_LIB_PATH}"`;
        } else if (isLinux) {
            // Linux with gcc
            compileCmd = `gcc -o ndi_recv ndi_recv.c -L"${NDI_LIB_PATH}" -lndi -I"${NDI_INCLUDE_PATH}" -Wl,-rpath,"${NDI_LIB_PATH}"`;
        }
        
        execSync(compileCmd, { 
            cwd: __dirname,
            stdio: 'pipe' 
        });
        console.log('[NDI] Compiled ndi_recv');
    } catch (err) {
        console.log('[NDI] Using existing ndi_recv binary:', err.message);
    }

    // Step 2: Start NDI receiver (outputs UYVY422 raw video)
    ndiProc = spawn(NDI_RECV_CMD, [NDI_SOURCE_NAME], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']  // stderr to capture resolution
    });

    console.log('[NDI] Started ndi_recv');

    let resolutionDetected = false;
    let ndiConnected = false;
    const maxWaitTime = 5000; // 5 second timeout
    const startTime = Date.now();

    // Reset detected resolution for new pipeline
    detectedResolution = null;

    // Handle stderr to detect resolution
    // Tee NDI stdout for multiple consumers
    ndiVideoTee = new PassThrough();
    ndiProc.stdout.pipe(ndiVideoTee);

    ndiProc.stderr.on('data', (data) => {
        const text = data.toString();
        console.error(text.trim());
        
        // Check for connection success
        if (text.includes('Connected to:')) {
            ndiConnected = true;
            console.log('[NDI] Connected to source');
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
