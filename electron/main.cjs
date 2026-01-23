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

    ipcMain.handle('suno:generate', async (event, { prompt, customMode, instrumental, style, title, authMode, sunoCookie }) => {
        try {
            // Dual Authentication Mode
            if (authMode === 'cookie') {
                // JWT Token-based authentication: Direct Suno API
                // The "cookie" field actually stores the JWT token from the Clerk response
                let token = sunoCookie || store.get('sunoCookie');
                if (!token) throw new Error('Suno Token is missing. Please enter your JWT token.');

                // Clean the token - remove any whitespace/newlines
                token = token.trim().replace(/[\r\n]/g, '');

                console.log('[Suno] Using JWT Token authentication mode');
                const { v4: uuidv4 } = require('uuid');
                const response = await axios.post('https://studio-api.prod.suno.com/api/generate/v2-web/', {
                    token: null,
                    generation_type: 'TEXT',
                    mv: 'chirp-crow',
                    prompt: '',
                    gpt_description_prompt: prompt,
                    make_instrumental: instrumental || false,
                    user_uploaded_images_b64: null,
                    metadata: {
                        web_client_pathname: '/create',
                        is_max_mode: false,
                        is_mumble: false,
                        create_mode: 'simple',
                        disable_volume_normalization: false,
                        can_control_sliders: [],
                        lyrics_model: 'default'
                    },
                    override_fields: [],
                    cover_clip_id: null,
                    persona_id: null,
                    continue_clip_id: null,
                    transaction_uuid: uuidv4()
                }, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Origin': 'https://suno.com',
                        'Referer': 'https://suno.com/'
                    }
                });

                console.log('[Suno JWT API] Generate Response:', JSON.stringify(response.data, null, 2));

                // JWT mode returns clip IDs directly
                if (response.data && response.data.clips) {
                    const clips = response.data.clips;
                    return {
                        success: true,
                        data: {
                            data: { taskId: clips[0]?.id || '' },
                            clips: clips,
                            authMode: 'cookie'
                        }
                    };
                }
                return { success: true, data: response.data };
            } else {
                // API Key authentication: Third-party sunoapi.org (existing logic)
                const apiKey = process.env.SUNO_API_KEY || store.get('sunoApiKey');
                if (!apiKey) throw new Error('API Key is missing. Please add SUNO_API_KEY to your .env file.');

                console.log('[Suno] Using API Key authentication mode');
                const response = await axios.post('https://api.sunoapi.org/api/v1/generate', {
                    prompt,
                    customMode: customMode || false,
                    instrumental: instrumental || false,
                    style: style || '',
                    title: title || '',
                    model: 'V4',
                    callBackUrl: 'https://pqqpxm.link/suno-callback'
                }, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                console.log('[Suno API] Generate Response:', JSON.stringify(response.data, null, 2));
                return { success: true, data: response.data };
            }
        } catch (error) {
            console.error('Suno Generate Error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    });

    ipcMain.handle('suno:status', async (event, { taskId, authMode }) => {
        try {
            if (authMode === 'cookie') {
                // JWT Token-based: Query Suno feed API
                let token = store.get('sunoCookie');
                if (!token) throw new Error('Token is missing');

                // Clean the token
                token = token.trim().replace(/[\r\n]/g, '');

                const response = await axios.get(`https://studio-api.prod.suno.com/api/feed/?ids=${taskId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Origin': 'https://suno.com',
                        'Referer': 'https://suno.com/'
                    }
                });

                // Transform response to match existing format
                if (response.data && response.data.length > 0) {
                    const clip = response.data[0];
                    return {
                        success: true,
                        data: {
                            data: {
                                status: clip.status === 'complete' ? 'SUCCESS' : (clip.status === 'streaming' ? 'PENDING' : clip.status?.toUpperCase()),
                                response: {
                                    sunoData: [{
                                        id: clip.id,
                                        title: clip.title || 'Untitled',
                                        audio_url: clip.audio_url,
                                        image_url: clip.image_url,
                                        status: clip.status
                                    }]
                                }
                            }
                        },
                        authMode: 'cookie'
                    };
                }
                return { success: true, data: response.data };
            } else {
                // API Key mode (existing logic)
                const apiKey = process.env.SUNO_API_KEY || store.get('sunoApiKey');
                if (!apiKey) throw new Error('API Key is missing');

                const response = await axios.get(`https://api.sunoapi.org/api/v1/generate/record-info?taskId=${taskId}`, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                });

                return { success: true, data: response.data };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('suno:extract-token', async (event) => {
        return new Promise((resolve) => {
            console.log('[Main] Starting JWT extraction...');

            const authWindow = new BrowserWindow({
                width: 500,
                height: 700,
                show: true, // Show it so user can login if needed
                title: "Suno Login / Token Extraction",
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            authWindow.loadURL('https://suno.com/create');

            // Extraction script to run in the window
            const extractScript = `
                (async () => {
                    try {
                        if (window.Clerk && window.Clerk.session) {
                            const token = await window.Clerk.session.getToken();
                            return { success: true, token };
                        }
                        return { success: false, reason: 'NOT_LOGGED_IN' };
                    } catch (e) {
                        return { success: false, reason: e.message };
                    }
                })()
            `;

            const checkInterval = setInterval(async () => {
                if (authWindow.isDestroyed()) {
                    clearInterval(checkInterval);
                    resolve({ success: false, error: 'Window closed by user' });
                    return;
                }

                try {
                    const result = await authWindow.webContents.executeJavaScript(extractScript);
                    console.log('[Main] Extraction probe result:', result);
                    if (result && result.success && result.token) {
                        console.log('[Main] JWT Token extracted successfully');
                        clearInterval(checkInterval);
                        authWindow.close();
                        resolve({ success: true, token: result.token });
                    }
                } catch (err) {
                    console.error('[Main] Extraction script error:', err);
                }
            }, 2000);

            authWindow.on('closed', () => {
                clearInterval(checkInterval);
            });
        });
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
