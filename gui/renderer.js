let ws = null;
let isConnected = false;
let logCount = 0;
let pipelineRunning = false;

const elements = {
    connectionDot: document.getElementById('connection-dot'),
    connectionText: document.getElementById('connection-text'),
    pipelineStatus: document.getElementById('pipeline-status'),
    currentSource: document.getElementById('current-source'),
    viewerCount: document.getElementById('viewer-count'),
    logContainer: document.getElementById('log-container'),
    sourceSelect: document.getElementById('source-select'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    btnSwitch: document.getElementById('btn-switch'),
    btnRefreshSources: document.getElementById('btn-refresh-sources'),
    btnClearLogs: document.getElementById('btn-clear-logs')
};

// Connect to WebSocket for logs
async function connectWebSocket() {
    try {
        const serverUrl = await window.api.getServerUrl();
        const wsUrl = `${serverUrl}`;
        
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnected = true;
            updateConnectionStatus(true);
            addLog('Connected to server ✓', 'success');
        };

        ws.onmessage = (event) => {
            try {
                // Skip binary/video data
                if (event.data.length > 10000) return;
                
                const data = JSON.parse(event.data);
                
                if (data.type === 'log') {
                    addLog(data.message, data.level || 'info');
                } else if (data.type === 'status') {
                    updateStatus(data);
                }
            } catch (err) {
                // Binary data or non-JSON, ignore
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus(false);
        };

        ws.onclose = () => {
            isConnected = false;
            updateConnectionStatus(false);
            // Reconnect
            setTimeout(connectWebSocket, 2000);
        };
    } catch (err) {
        console.error('Failed to connect:', err);
        setTimeout(connectWebSocket, 2000);
    }
}

function updateConnectionStatus(connected) {
    if (connected) {
        elements.connectionText.textContent = 'Connected ✓';
        elements.connectionDot.classList.add('connected');
    } else {
        elements.connectionText.textContent = 'Disconnected ✗';
        elements.connectionDot.classList.remove('connected');
    }
}

function updateStatus(data) {
    pipelineRunning = data.running;
    
    // Update pipeline status
    elements.pipelineStatus.textContent = data.running ? 'Running ▶' : 'Stopped ⏹';
    elements.pipelineStatus.className = `status-badge ${data.running ? 'running' : 'stopped'}`;

    // Update source
    elements.currentSource.textContent = data.source || '—';

    // Update viewer count
    elements.viewerCount.textContent = data.clients || 0;

    // Update button states
    elements.btnStart.disabled = data.running;
    elements.btnStop.disabled = !data.running;
}

function addLog(message, level = 'info') {
    // Limit logs to prevent memory issues
    if (logCount > 1000) {
        elements.logContainer.innerHTML = '';
        logCount = 0;
    }

    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    
    const timestamp = new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    entry.textContent = `[${timestamp}] ${message}`;
    
    elements.logContainer.appendChild(entry);
    elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
    
    logCount++;
}

async function loadSources() {
    try {
        console.log('Loading sources...');
        const data = await window.api.apiCall('/api/sources');
        
        console.log('Sources response:', data);
        
        elements.sourceSelect.innerHTML = '';
        
        if (data && data.sources && data.sources.length > 0) {
            console.log(`Found ${data.sources.length} sources`);
            addLog(`Found ${data.sources.length} NDI source(s) ✓`, 'success');
            
            data.sources.forEach(source => {
                const option = document.createElement('option');
                option.value = source.name;
                option.textContent = source.name;
                elements.sourceSelect.appendChild(option);
            });
        } else {
            const option = document.createElement('option');
            option.textContent = 'No sources available';
            elements.sourceSelect.appendChild(option);
            addLog('No NDI sources detected', 'warning');
        }
    } catch (err) {
        console.error('Failed to load sources:', err);
        const option = document.createElement('option');
        option.textContent = 'Error loading sources';
        elements.sourceSelect.appendChild(option);
    }
}

async function loadAddresses() {
    try {
        const data = await window.api.apiCall('/api/addresses');
        const footer = document.getElementById('footer-addresses');
        
        if (data && data.addresses && data.addresses.length > 0) {
            const viewerLinks = data.addresses.map(addr => 
                `<strong>Viewer:</strong> <a href="http://${addr}:${data.port}/viewer.html" target="_blank">http://${addr}:${data.port}/viewer.html</a>`
            ).join('<br>');
            const autoLinks = data.addresses.map(addr => 
                `<strong>Auto:</strong> <a href="http://${addr}:${data.port}/ndi_auto.html" target="_blank">http://${addr}:${data.port}/ndi_auto.html</a>`
            ).join('<br>');
            footer.innerHTML = `🌐 <strong>Access from other devices:</strong><br>${viewerLinks}<br>${autoLinks}`;
        } else {
            footer.textContent = '🌐 No network interfaces found';
        }
    } catch (err) {
        console.error('Failed to load addresses:', err);
        document.getElementById('footer-addresses').textContent = '🌐 Failed to load network addresses';
    }
}

// Event Listeners
elements.btnStart.addEventListener('click', async () => {
    try {
        addLog('Starting pipeline...', 'info');
        const result = await window.api.apiCall('/api/start', 'POST');
        if (result.status === 'already_running') {
            addLog('Pipeline already running', 'warning');
        } else {
            addLog('Pipeline started', 'success');
        }
    } catch (err) {
        addLog(`Failed to start pipeline: ${err.message}`, 'error');
    }
});

elements.btnStop.addEventListener('click', async () => {
    try {
        addLog('Stopping pipeline...', 'info');
        const result = await window.api.apiCall('/api/stop', 'POST');
        if (result.status === 'already_stopped') {
            addLog('Pipeline already stopped', 'warning');
        } else {
            addLog('Pipeline stopped', 'success');
        }
    } catch (err) {
        addLog(`Failed to stop pipeline: ${err.message}`, 'error');
    }
});

elements.btnSwitch.addEventListener('click', () => {
    const source = elements.sourceSelect.value;
    if (source && ws && isConnected) {
        addLog(`Switching to source: ${source}`, 'info');
        ws.send(JSON.stringify({ action: 'switchSource', source: source }));
    } else {
        addLog('Not connected or no source selected', 'error');
    }
});

elements.btnClearLogs.addEventListener('click', () => {
    elements.logContainer.innerHTML = '';
    logCount = 0;
    addLog('Logs cleared', 'info');
});

elements.btnRefreshSources.addEventListener('click', () => {
    addLog('Refreshing sources...', 'info');
    loadSources();
});

// Initialize
connectWebSocket();
loadAddresses();

// Cleanup on close
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
});
