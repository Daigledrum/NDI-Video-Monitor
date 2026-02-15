const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let serverProcess;

const parsedPort = Number.parseInt(process.env.PORT || '', 10);
const SERVER_PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536
    ? parsedPort
    : 3001;

// Platform detection
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Start the Node.js server in the background
function startNodeServer() {
    return new Promise((resolve, reject) => {
        try {
            // When packaged, use the unpacked directory
            const workDir = __dirname.replace('app.asar', 'app.asar.unpacked');
            
            // Find Node.js binary based on platform
            let nodeBin = 'node';
            if (isMac) {
                const preferredNode = '/opt/homebrew/opt/node@20/bin/node';
                nodeBin = fs.existsSync(preferredNode) ? preferredNode : 'node';
            }
            // On Windows, 'node' should work from PATH
            
            serverProcess = spawn(nodeBin, ['ndi_server.js'], {
                cwd: workDir,
                stdio: 'inherit'
            });

            serverProcess.on('error', (err) => {
                console.error('Failed to start server:', err);
                reject(err);
            });

            // Give server time to start
            setTimeout(() => resolve(), 1500);
        } catch (err) {
            reject(err);
        }
    });
}

// Create the main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile('gui/index.html');

    // Open DevTools in development (comment out for production)
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Create application menu
function createMenu() {
    const template = [
        {
            label: 'NDI Control',
            submenu: [
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.reload();
                    }
                },
                {
                    label: 'Developer Tools',
                    accelerator: 'CmdOrCtrl+Alt+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC Handlers for communication with GUI
ipcMain.handle('api-call', async (event, endpoint, method = 'GET', data = null) => {
    try {
        const url = `http://localhost:${SERVER_PORT}${endpoint}`;
        console.log(`[IPC] API call: ${method} ${url}`);
        
        if (method === 'POST') {
            const options = {
                method: 'POST',
                headers: {}
            };

            if (data !== null && data !== undefined) {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(data);
            }

            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } else {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        }
    } catch (err) {
        console.error(`[IPC] API call failed: ${err.message}`);
        throw new Error(`API Error: ${err.message}`);
    }
});

ipcMain.handle('get-server-url', () => {
    return `ws://localhost:${SERVER_PORT}`;
});

ipcMain.handle('generate-qr', async (event, text, options) => {
    const QRCode = require('qrcode');
    try {
        return await QRCode.toDataURL(text, options || { width: 150, margin: 1 });
    } catch (err) {
        console.error('QR generation error:', err);
        throw err;
    }
});

ipcMain.handle('app-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
    app.quit();
});

// App event handlers
app.on('ready', async () => {
    try {
        await startNodeServer();
        createWindow();
        createMenu();
    } catch (err) {
        console.error('Failed to start application:', err);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Cleanup on exit
app.on('before-quit', () => {
    if (serverProcess) {
        try {
            serverProcess.kill('SIGTERM');
        } catch (e) {}
    }
});
