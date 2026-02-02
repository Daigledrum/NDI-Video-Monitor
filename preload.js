const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    apiCall: (endpoint, method = 'GET', data = null) => {
        return ipcRenderer.invoke('api-call', endpoint, method, data);
    },
    getServerUrl: () => {
        return ipcRenderer.invoke('get-server-url');
    },
    onLogs: (callback) => {
        // This will be handled via WebSocket in renderer
    },
    quitApp: () => {
        return ipcRenderer.invoke('app-quit');
    }
});

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        invoke: ipcRenderer.invoke,
        on: ipcRenderer.on,
        once: ipcRenderer.once,
        send: ipcRenderer.send
    }
});
