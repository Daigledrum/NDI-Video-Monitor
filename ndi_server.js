const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const os = require('os');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const HTTP_PORT = 3001;
const JPEG_QUALITY = 80;
let NDI_SOURCE_NAME = null; // Will be auto-discovered

// ─── VERIFY DEPENDENCIES ───────────────────────────────────────────────────
try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    console.log('[OK] ffmpeg found');
} catch {
    console.error('[FATAL] ffmpeg not installed. Install: brew install ffmpeg');
    process.exit(1);
}

// ─── EXPRESS + WEBSOCKET SETUP ─────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 10 * 1024 * 1024
});

app.use(express.static('public'));

// ─── API ENDPOINTS ─────────────────────────────────────────────────────────
app.get('/api/sources', (req, res) => {
    const { execSync } = require('child_process');
    try {
        const output = execSync('./ndi_list', { 
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
    if (ndiProc && ffmpegProc) {
        return res.json({ status: 'already_running', message: 'Pipeline already running' });
    }
    startPipeline();
    res.json({ status: 'started', message: 'Pipeline started' });
});

app.post('/api/stop', (req, res) => {
    console.log('[API] Stop request');
    if (!ndiProc && !ffmpegProc) {
        return res.json({ status: 'already_stopped', message: 'Pipeline already stopped' });
    }
    cleanup();
    res.json({ status: 'stopped', message: 'Pipeline stopped' });
});

app.get('/api/status', (req, res) => {
    res.json({
        running: !!(ndiProc && ffmpegProc && !ndiProc.killed && !ffmpegProc.killed),
        source: NDI_SOURCE_NAME,
        clients: clients.size
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

// ─── CLIENT TRACKING ───────────────────────────────────────────────────────
const clients = new Set();
const dashboardClients = new Set();

function broadcastStatus() {
    const status = {
        type: 'status',
        running: !!(ndiProc && ffmpegProc && !ndiProc.killed && !ffmpegProc.killed),
        source: NDI_SOURCE_NAME,
        clients: clients.size
    };
    
    // Only send status to dashboard clients, not video viewers
    dashboardClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(status));
            } catch (err) {
                console.error('[WS] Failed to send status:', err.message);
            }
        }
    });
}

// Send status updates every 1 second (only to dashboard)
setInterval(broadcastStatus, 1000);

wss.on('connection', (ws, req) => {
    console.log(`[WS] Client connected — ${req.socket.remoteAddress}`);
    
    // Check if this is a dashboard client (from Electron app on localhost)
    const isDashboard = req.socket.remoteAddress?.includes('127.0.0.1') || 
                        req.socket.remoteAddress?.includes('::1') ||
                        req.socket.remoteAddress?.includes('::ffff:127.0.0.1');
    
    clients.add(ws);
    if (isDashboard) {
        dashboardClients.add(ws);
        console.log('[WS] Dashboard client detected');
    }
    
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => { 
        clients.delete(ws); 
        dashboardClients.delete(ws);
        console.log('[WS] Client disconnected'); 
    });
    ws.on('error', () => { 
        clients.delete(ws); 
        dashboardClients.delete(ws);
    });
    
    // Handle source switching messages
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if ((data.action === 'switchSource' || data.type === 'select_source') && data.source) {
                console.log(`[WS] Switching to source: ${data.source}`);
                switchNDISource(data.source);
            }
        } catch (err) {
            console.error('[WS] Failed to parse message:', err);
        }
    });
});

// Heartbeat
const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// ─── NDI → FFMPEG PIPELINE ─────────────────────────────────────────────────
let ndiProc = null;
let ffmpegProc = null;
let jpegBuffer = Buffer.allocUnsafe(0);

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
        execSync('gcc -o ndi_recv ndi_recv.c -L/Library/NDI\\ SDK\\ for\\ Apple/lib/macOS -lndi -I/Library/NDI\\ SDK\\ for\\ Apple/include -Wl,-rpath,/Library/NDI\\ SDK\\ for\\ Apple/lib/macOS', { 
            cwd: __dirname,
            stdio: 'pipe' 
        });
        console.log('[NDI] Compiled ndi_recv');
    } catch (err) {
        console.log('[NDI] Using existing ndi_recv binary:', err.message);
    }

    // Step 2: Start NDI receiver (outputs UYVY422 raw video)
    ndiProc = spawn('./ndi_recv', [NDI_SOURCE_NAME], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'inherit']
    });

    console.log('[NDI] Started ndi_recv');

    // Step 3: Pipe NDI output to FFmpeg for JPEG encoding
    // NDI outputs UYVY (YUV 4:2:2) format, 2 bytes per pixel
    const FFMPEG_Q = Math.round((100 - JPEG_QUALITY) / 100 * 30 + 1);

    ffmpegProc = spawn('ffmpeg', [
        '-f', 'rawvideo',
        '-pix_fmt', 'uyvy422',
        '-s', '1920x1080',  // Adjust to your NDI resolution
        '-r', '30',         // Frame rate
        '-i', 'pipe:0',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-q:v', FFMPEG_Q.toString(),
        '-vframes', '-1',
        'pipe:1'
    ], {
        stdio: ['pipe', 'pipe', 'inherit']
    });

    console.log('[FFMPEG] Started encoding pipeline');

    // Connect NDI output to FFmpeg input
    ndiProc.stdout.pipe(ffmpegProc.stdin);

    // Handle FFmpeg output (JPEG frames)
    const SOI = Buffer.from([0xFF, 0xD8]);
    const EOI = Buffer.from([0xFF, 0xD9]);

    ffmpegProc.stdout.on('data', chunk => {
        jpegBuffer = Buffer.concat([jpegBuffer, chunk]);

        let startIdx = 0;
        while (true) {
            const nextSOI = jpegBuffer.indexOf(SOI, startIdx);
            if (nextSOI === -1) break;

            const eoi = jpegBuffer.indexOf(EOI, nextSOI + 2);
            if (eoi === -1) break;

            const jpegFrame = jpegBuffer.slice(nextSOI, eoi + 2);
            broadcastFrame(jpegFrame);

            startIdx = eoi + 2;
        }

        jpegBuffer = startIdx > 0 ? jpegBuffer.slice(startIdx) : jpegBuffer;
    });

    // Error handling
    ndiProc.on('error', err => console.error('[NDI] Process error:', err));
    ffmpegProc.on('error', err => console.error('[FFMPEG] Process error:', err));

    ndiProc.on('exit', code => {
        console.log('[NDI] Process exited:', code);
        cleanup();
    });

    ffmpegProc.on('exit', code => {
        console.log('[FFMPEG] Process exited:', code);
        cleanup();
    });
}

function broadcastFrame(jpegFrame) {
    if (clients.size === 0) return;

    const base64 = jpegFrame.toString('base64');
    const dataURL = `data:image/jpeg;base64,${base64}`;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(dataURL);
        }
    });
}

function cleanup() {
    if (ffmpegProc) {
        try {
            ffmpegProc.stdin.end(); // Close stdin gracefully
        } catch (e) {}
        setTimeout(() => {
            if (ffmpegProc && !ffmpegProc.killed) {
                ffmpegProc.kill('SIGTERM');
            }
        }, 500);
    }
    if (ndiProc) {
        try {
            ndiProc.kill('SIGTERM');
        } catch (e) {}
    }
    ffmpegProc = null;
    ndiProc = null;
}

// ─── START SERVER ──────────────────────────────────────────────────────────
server.listen(HTTP_PORT, () => {
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
    if (addresses.length > 0) {
        console.log('[SERVER] Access from other devices:');
        addresses.forEach(addr => {
            console.log(`  http://${addr}:${HTTP_PORT}/viewer.html`);
            console.log(`  http://${addr}:${HTTP_PORT}/ndi_auto.html`);
        });
    } else {
        console.log('[SERVER] No LAN IP detected. Make sure you are on Wi‑Fi/Ethernet.');
    }
    console.log(`[INFO] Auto-discovering NDI sources...`);
    
    // Auto-discover sources (but don't start pipeline yet)
    try {
        const output = execSync('./ndi_list', { 
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
    clearInterval(heartbeat);
    server.close();
    process.exit(0);
});
