import { useState, useEffect } from 'react'

function App() {
  console.log('[App] Component rendering...')
  const [prompt, setPrompt] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [tracks, setTracks] = useState<any[]>([])
  const [projectPath, setProjectPath] = useState<string>('')

  const [isEnvLoaded, setIsEnvLoaded] = useState(false)

  // Load API Key and Check Auth on mount
  useEffect(() => {
    console.log('[App] useEffect mounted')
    const initAuth = async () => {
      console.log('[App] Checking window.electron...', !!window.electron)
      // @ts-ignore
      if (typeof window !== 'undefined' && window.electron && window.electron.invoke) {
        try {
          // @ts-ignore
          const auth = await window.electron.invoke('suno:check-auth')
          console.log('[Frontend] Received auth info:', auth)
          if (auth.env) {
            console.log('[Frontend] ENV key detected, setting UI state')
            setIsEnvLoaded(true)
            setApiKey('****************')
          } else {
            console.log('[Frontend] ENV key NOT detected, checking store')
            // Only use saved key if env key is NOT present
            // @ts-ignore
            const savedKey = await window.electron.invoke('store:get', 'sunoApiKey')
            if (savedKey) setApiKey(savedKey)
          }
        } catch (err) {
          console.error('Auth init failed:', err)
        }
      }
    }
    initAuth()
  }, [])

  const handleSaveApiKey = async (val: string) => {
    setApiKey(val)
    // @ts-ignore
    await window.electron.invoke('store:set', 'sunoApiKey', val)
  }

  const handleGenerate = async () => {
    if (!apiKey.trim()) {
      alert('Please enter your sunoapi.org API Key first.')
      return
    }
    if (!prompt.trim()) return

    setIsGenerating(true)
    try {
      // @ts-ignore
      const result = await window.electron.invoke('suno:generate', {
        prompt,
        customMode: false,
        instrumental: false
      })

      if (result.success && result.data.data) {
        const taskId = result.data.data // taskId is returned directly as a string or in result.data.data based on docs
        const tempTracks = [{
          id: taskId,
          title: 'Generating...',
          status: 'queued',
          audioUrl: null,
          imageUrl: null
        }]
        setTracks(prev => [...tempTracks, ...prev])
        startPolling(taskId)
      } else {
        alert(`Generation failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Generation failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const startPolling = (taskId: string) => {
    const interval = setInterval(async () => {
      try {
        // @ts-ignore
        const result = await window.electron.invoke('suno:status', { taskId })
        if (result.success && result.data.data) {
          const task = result.data.data

          setTracks(prev => prev.map(track => {
            if (track.id === taskId) {
              // sunoapi.org task status: queued, processing, complete, failed
              // multiple clips are returned in task.clips
              const clip = task.clips?.[0] // UI shows first clip for now
              return {
                ...track,
                status: task.status,
                audioUrl: clip?.audio_url,
                imageUrl: clip?.image_url,
                title: clip?.title || track.title
              }
            }
            return track
          }))

          if (task.status === 'complete' || task.status === 'failed') {
            clearInterval(interval)
          }
        }
      } catch (error) {
        console.error('Polling error:', error)
        clearInterval(interval)
      }
    }, 5000)
  }

  const handleSelectProject = async () => {
    // @ts-ignore
    const path = await window.electron.invoke('dialog:open-directory')
    if (path) {
      setProjectPath(path)
    }
  }

  const handleDownload = async (track: any) => {
    if (!projectPath) {
      alert('Please link a Cubase project folder first.')
      return
    }

    setTracks(prev => prev.map(t => t.id === track.id ? { ...t, isDownloading: true } : t))

    try {
      // @ts-ignore
      const result = await window.electron.invoke('suno:download', {
        url: track.audioUrl,
        title: track.title,
        projectPath
      })

      if (result.success) {
        setTracks(prev => prev.map(t => t.id === track.id ? { ...t, localPath: result.path } : t))
        // alert(`Successfully downloaded and converted to WAV:\n${result.path}`)
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (error) {
      console.error('Download failed:', error)
    } finally {
      setTracks(prev => prev.map(t => t.id === track.id ? { ...t, isDownloading: false } : t))
    }
  }

  const handleDragStart = (e: React.DragEvent, track: any) => {
    e.preventDefault()
    if (track.localPath) {
      // @ts-ignore
      window.electron.send('ondragstart', track.localPath)
    } else {
      alert('Please download the track first to drag it into Cubase.')
    }
  }

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto">
      {!isEnvLoaded && !apiKey && typeof window !== 'undefined' && !window.electron && (
        <div className="mb-6 p-4 bg-orange-500/20 border border-orange-500/50 rounded-lg text-orange-200 text-sm flex items-center gap-3">
          <span>⚠️</span>
          <p>
            <strong>주의</strong>: 현재 일반 웹 브라우저(Chrome 등)에서 접속 중입니다.
            파일 드래그, .env 로드 등 모든 기능은 <strong>npm run electron-dev</strong> 실행 시 뜨는 전용 앱 창에서만 작동합니다.
          </p>
        </div>
      )}
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Suno & Cubase Studio
          </h1>
          <p className="text-text-secondary mt-1">AI Music Production Workflow</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative flex flex-col items-end">
            <label className="text-[10px] text-text-secondary mb-1">sunoapi.org API Key</label>
            <div className="flex gap-2">
              <input
                type={isApiKeyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleSaveApiKey(e.target.value)}
                placeholder="Paste API Key here..."
                className="bg-surface/50 border border-border rounded-md px-3 py-1.5 text-xs w-64 focus:ring-1 focus:ring-accent outline-none"
              />
              <button
                onClick={() => setIsApiKeyVisible(!isApiKeyVisible)}
                className="p-1.5 bg-surface border border-border rounded-md hover:bg-border transition-colors"
              >
                {isApiKeyVisible ? '👁️' : '🙈'}
              </button>
            </div>
            {isEnvLoaded && (
              <span className="text-[9px] text-green-400 mt-0.5 animate-pulse">✓ API Key loaded from .env</span>
            )}
          </div>
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold transition-all ${apiKey ? 'bg-green-500 shadow-lg shadow-green-500/20' : 'bg-gradient-to-br from-blue-500 to-purple-600'}`}
          >
            {apiKey ? '✓' : 'JD'}
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <section className="md:col-span-2 space-y-6">
          <div className="card space-y-4">
            <h2 className="text-xl font-semibold">Generate Music</h2>
            <div className="space-y-2">
              <label className="text-sm text-text-secondary">Music Prompt</label>
              <textarea
                className="w-full bg-background border border-border rounded-lg p-4 h-32 focus:outline-none focus:ring-2 focus:ring-accent transition-all resize-none"
                placeholder="Describe the style, mood, and instruments... (e.g., Chill lofi beat with jazzy piano and soft drums)"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-surface border border-border rounded-full text-xs font-bold text-accent">v4.0 (Latest)</span>
                <span className="px-3 py-1 bg-surface border border-border rounded-full text-xs">WAV Export</span>
              </div>
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt}
                className={`btn-primary flex items-center gap-2 ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isGenerating && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {isGenerating ? 'Generating...' : 'Generate Track'}
              </button>
            </div>
          </div>

          <div className="card">
            <h2 className="text-xl font-semibold mb-6">Generation History</h2>
            <div className="space-y-4">
              {tracks.length === 0 ? (
                <div className="text-center py-12 text-text-secondary border-2 border-dashed border-border rounded-lg">
                  No tracks generated yet.
                </div>
              ) : (
                tracks.map(track => (
                  <div
                    key={track.id}
                    draggable={!!track.localPath}
                    onDragStart={(e) => handleDragStart(e, track)}
                    className={`p-4 bg-surface/40 backdrop-blur-md border border-white/5 rounded-xl flex items-center gap-4 group hover:border-accent/40 hover:bg-surface/60 transition-all cursor-is-allowed ${track.localPath ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    <div className="w-16 h-16 bg-background rounded-lg overflow-hidden flex-shrink-0 border border-white/5 shadow-inner">
                      {track.imageUrl ? <img src={track.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-accent/5 flex items-center justify-center text-accent/50 text-xl font-bold">M</div>}
                    </div>
                    <div className="flex-grow min-w-0">
                      <h3 className="font-semibold text-sm truncate group-hover:text-accent transition-colors">{track.title || 'Untitled Composition'}</h3>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${track.status === 'complete'
                          ? (track.localPath ? 'bg-accent/20 text-accent border border-accent/20' : 'bg-green-500/10 text-green-400 border border-green-500/10')
                          : 'bg-blue-500/10 text-blue-400 border border-blue-500/10 animate-pulse'
                          }`}>
                          {track.localPath ? 'READY TO DRAG' : track.status}
                        </span>
                        <span className="text-[10px] text-text-secondary font-mono opacity-50 truncate">ID: {track.id.split('-')[0]}...</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {track.status === 'complete' && !track.localPath && (
                        <button
                          onClick={() => handleDownload(track)}
                          disabled={track.isDownloading}
                          className={`p-2 hidden group-hover:block hover:bg-accent/10 text-accent rounded-lg transition-colors ${track.isDownloading ? 'animate-pulse' : ''}`}
                          title="Download as WAV to Cubase"
                        >
                          {track.isDownloading ? (
                            <span className="w-5 h-5 block border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12 a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                          )}
                        </button>
                      )}
                      {track.localPath && (
                        <div className="p-2 text-accent/40 cursor-grab" title="Drag this track into Cubase!">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16"></path></svg>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Cubase Connect</h2>
            <div className="space-y-4">
              <div className="p-4 bg-background border border-border rounded-lg">
                <p className="text-sm text-text-secondary">Current Project</p>
                <p className="font-medium truncate text-xs mt-1" title={projectPath}>
                  {projectPath ? projectPath.split(/[\\/]/).pop() : 'No project selected'}
                </p>
                {projectPath && <p className="text-[10px] text-text-secondary mt-2 truncate italic">{projectPath}</p>}
              </div>
              <button
                onClick={handleSelectProject}
                className="w-full py-2 border border-blue-500/30 bg-blue-500/10 text-blue-400 rounded-lg text-sm hover:bg-blue-500/20 transition-colors"
              >
                {projectPath ? 'Change Project' : 'Link Cubase Project'}
              </button>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Export Settings</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Format</span>
                <span>WAV (PCM)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Sample Rate</span>
                <span>48 kHz</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Bit Depth</span>
                <span>24 bit</span>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
