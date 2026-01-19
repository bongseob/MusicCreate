console.log('[Preload] Preload script executing...');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel, data) => {
        let validChannels = ['toMain', 'ondragstart'];
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
            'suno:download'
        ];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
    }
});
