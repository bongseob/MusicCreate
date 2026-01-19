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

    ipcMain.handle('dialog:open-audio', async () => {
        const { filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg'] }
            ]
        });
        return filePaths[0];
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

    ipcMain.handle('suno:separate', async (event, { filePath, trackId }) => {
        return new Promise((resolve, reject) => {
            if (!filePath || !fs.existsSync(filePath)) {
                return resolve({ success: false, error: 'Source file not found' });
            }

            const fileName = path.basename(filePath, path.extname(filePath));
            const outputBaseDir = path.join(path.dirname(filePath), 'stems_' + fileName);

            if (!fs.existsSync(outputBaseDir)) {
                fs.mkdirSync(outputBaseDir, { recursive: true });
            }

            // Path to demucs (running via python module is safest)
            const pythonPath = 'python';
            // Default separates into 4 stems: vocals, drums, bass, other
            const args = ['-m', 'demucs.separate', '--mp3', '-o', outputBaseDir, filePath];

            console.log(`[Main] Starting 4-Stem Separation for track ${trackId}: ${filePath}`);
            const { spawn } = require('child_process');

            // Critical: Add directories of ffmpeg-static and ffprobe-static to the PATH
            const ffmpegPath = require('ffmpeg-static');
            const ffprobePath = require('ffprobe-static').path;
            const ffmpegDir = path.dirname(ffmpegPath);
            const ffprobeDir = path.dirname(ffprobePath);

            // Create a clean env object that works on Windows
            const env = { ...process.env };
            const newPath = `${ffmpegDir}${path.delimiter}${ffprobeDir}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
            env.PATH = newPath;
            env.Path = newPath;
            env.FFMPEG_BINARY = ffmpegPath;

            // Force torchaudio to use 'av' backend (PyAV) which is very stable on Windows
            env.TORCHAUDIO_BACKEND = 'av';
            env.PYTHONIOENCODING = 'utf-8';

            console.log(`[Main] Starting Demucs with TORCHAUDIO_BACKEND=av and UTF-8 encoding`);
            const demucsProcess = spawn(pythonPath, args, { env });

            demucsProcess.stdout.on('data', (data) => {
                const msg = data.toString();
                event.sender.send('suno:separate-progress', { trackId, msg });
            });

            demucsProcess.stderr.on('data', (data) => {
                const msg = data.toString();
                event.sender.send('suno:separate-progress', { trackId, msg });
            });

            demucsProcess.on('close', (code) => {
                if (code === 0) {
                    const modelName = 'htdemucs';
                    const demucsOutputDir = path.join(outputBaseDir, modelName, fileName);

                    if (fs.existsSync(demucsOutputDir)) {
                        const files = fs.readdirSync(demucsOutputDir);
                        const resultPaths = files.map(f => path.join(demucsOutputDir, f));
                        resolve({ success: true, stems: resultPaths, folder: demucsOutputDir });
                    } else {
                        resolve({ success: false, error: 'Output folder not found after processing' });
                    }
                } else {
                    resolve({ success: false, error: `Demucs process exited with code ${code}` });
                }
            });
        });
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
