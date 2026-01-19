console.log('[Preload] Preload script executing...');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel, data) => {
        const validChannels = [
            'suno:login-success',
            'suno:login-error',
            'suno:check-auth-reply',
            'suno:separate-progress'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        let validChannels = ['fromMain'];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    invoke: (channel, ...args) => {
        let validChannels = [
            'store:get',
            'store:set',
            'suno:generate',
            'suno:status',
            'suno:check-auth',
            'dialog:open-directory',
            'dialog:open-audio',
            'suno:download',
            'suno:separate'
        ];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
    },
    on: (channel, func) => {
        const validChannels = ['suno:separate-progress'];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
        }
    }
});
