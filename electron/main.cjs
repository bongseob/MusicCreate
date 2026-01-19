const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const axios = require('axios');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const Store = require('electron-store');
const store = new Store();

const isDev = process.env.NODE_ENV === 'development';
ffmpeg.setFfmpegPath(ffmpegPath);
console.log('--- Suno & Cubase Studio Backend Started ---');

function createWindow() {
    const preloadPath = path.join(__dirname, 'preload.cjs');
    console.log('[Main] Preload Path:', preloadPath);
    console.log('[Main] Preload Exists:', fs.existsSync(preloadPath));

    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#0a0a0b',
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false // Try disabling sandbox if it's an issue
        },
        title: "Suno & Cubase Studio",
        autoHideMenuBar: true,
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    ipcMain.handle('suno:check-auth', () => {
        const result = {
            env: !!process.env.SUNO_API_KEY,
            store: !!store.get('sunoApiKey')
        };
        console.log('[Backend] suno:check-auth result:', result);
        return result;
    });

    // Store handlers for API Key
    ipcMain.handle('store:get', (event, key) => store.get(key));
    ipcMain.handle('store:set', (event, key, value) => store.set(key, value));

    ipcMain.handle('suno:generate', async (event, { prompt, customMode, instrumental, style, title }) => {
        try {
            const apiKey = process.env.SUNO_API_KEY || store.get('sunoApiKey');
            if (!apiKey) throw new Error('API Key is missing. Please add SUNO_API_KEY to your .env file.');

            const response = await axios.post('https://api.sunoapi.org/api/v1/generate', {
                prompt,
                customMode: customMode || false,
                instrumental: instrumental || false,
                style: style || '',
                title: title || '',
                model: 'V4',
                callBackUrl: 'https://pqqpxm.link/suno-callback' // Placeholder required by some API versions
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('[Suno API] Generate Response:', JSON.stringify(response.data, null, 2));
            return { success: true, data: response.data };
        } catch (error) {
            console.error('Suno Generate Error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    });

    ipcMain.handle('suno:status', async (event, { taskId }) => {
        try {
            const apiKey = process.env.SUNO_API_KEY || store.get('sunoApiKey');
            if (!apiKey) throw new Error('API Key is missing');

            const response = await axios.get(`https://api.sunoapi.org/api/v1/generate/record-info?taskId=${taskId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            return { success: true, data: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('dialog:open-directory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });
        if (canceled) {
            return null;
        } else {
            return filePaths[0];
        }
    });

    ipcMain.handle('suno:download', async (event, { url, title, projectPath }) => {
        try {
            if (!projectPath) throw new Error('No project path selected');

            // 1. Ensure Audio folder exists
            const audioDir = path.join(projectPath, 'Audio');
            const sunoDir = path.join(audioDir, 'Suno_Generations');
            if (!fs.existsSync(sunoDir)) {
                fs.mkdirSync(sunoDir, { recursive: true });
            }

            const cleanTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const tempMp3 = path.join(app.getPath('temp'), `${cleanTitle}.mp3`);
            const finalWav = path.join(sunoDir, `${cleanTitle}_${Date.now()}.wav`);

            // 2. Download MP3
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(tempMp3);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // 3. Convert to WAV (48kHz/24bit)
            return new Promise((resolve, reject) => {
                ffmpeg(tempMp3)
                    .toFormat('wav')
                    .audioFrequency(48000)
                    .audioCodec('pcm_s24le')
                    .on('end', () => {
                        fs.unlinkSync(tempMp3); // cleanup
                        resolve({ success: true, path: finalWav });
                    })
                    .on('error', (err) => {
                        reject(err);
                    })
                    .save(finalWav);
            });

        } catch (error) {
            console.error('Download/Convert Error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('ondragstart', (event, filePath) => {
        event.sender.startDrag({
            file: filePath,
            icon: path.join(__dirname, '../public/audio-icon.png') // Make sure this exists or use a default
        });
    });

    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
