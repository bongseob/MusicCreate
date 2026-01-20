import { useState, useEffect } from 'react'

function App() {
  console.log('[App] Component rendering...')
  const [prompt, setPrompt] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [sunoCookie, setSunoCookie] = useState('')
  const [authMode, setAuthMode] = useState<'api_key' | 'cookie'>('api_key')
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [tracks, setTracks] = useState<any[]>([])
  const [projectPath, setProjectPath] = useState<string>('')
  const [separateLogs, setSeparateLogs] = useState<{ [key: string]: string[] }>({})

  const [isEnvLoaded, setIsEnvLoaded] = useState(false)
  const [showCookieGuide, setShowCookieGuide] = useState(false)

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
            // @ts-ignore
            const savedKey = await window.electron.invoke('store:get', 'sunoApiKey')
            if (savedKey) setApiKey(savedKey)
          }
          // Load saved auth mode and cookie
          // @ts-ignore
          const savedAuthMode = await window.electron.invoke('store:get', 'authMode')
          if (savedAuthMode) setAuthMode(savedAuthMode)
          // @ts-ignore
          const savedCookie = await window.electron.invoke('store:get', 'sunoCookie')
          if (savedCookie) setSunoCookie(savedCookie)
        } catch (err) {
          console.error('Auth init failed:', err)
        }
      }
    }
    initAuth()

    // Listen for separation progress
    // @ts-ignore
    if (window.electron && window.electron.on) {
      // @ts-ignore
      window.electron.on('suno:separate-progress', (event, { trackId, msg }) => {
        setSeparateLogs(prev => ({
          ...prev,
          [trackId]: [...(prev[trackId] || []), msg]
        }))
      })
    }
  }, [])

  const handleSaveApiKey = async (val: string) => {
    setApiKey(val)
    // @ts-ignore
    await window.electron.invoke('store:set', 'sunoApiKey', val)
  }

  const handleSaveCookie = async (val: string) => {
    setSunoCookie(val)
    // @ts-ignore
    await window.electron.invoke('store:set', 'sunoCookie', val)
  }

  const handleAuthModeChange = async (mode: 'api_key' | 'cookie') => {
    setAuthMode(mode)
    // @ts-ignore
    await window.electron.invoke('store:set', 'authMode', mode)
  }

  const handleGenerate = async () => {
    if (authMode === 'api_key' && !apiKey.trim()) {
      alert('Please enter your sunoapi.org API Key first.')
      return
    }
    if (authMode === 'cookie' && !sunoCookie.trim()) {
      alert('Please enter your Suno browser cookie first.')
      return
    }
    if (!prompt.trim()) return

    setIsGenerating(true)
    try {
      // @ts-ignore
      const result = await window.electron.invoke('suno:generate', {
        prompt,
        customMode: false,
        instrumental: false,
        authMode,
        sunoCookie
      })

      console.log('[App] Generate Result:', result)
      if (result.success && result.data) {
        // sunoapi.org returns { code: 200, data: { taskId: "..." } }
        let taskId = ''
        if (result.data.data && typeof result.data.data.taskId === 'string') {
          taskId = result.data.data.taskId
        } else if (typeof result.data.data === 'string') {
          taskId = result.data.data
        }

        console.log('[App] Extracted Task ID:', taskId)

        if (!taskId) {
          console.error('[App] Invalid Task ID format', result.data)
          return
        }

        const tempTracks = [{
          id: taskId,
          title: 'Generating...',
          status: 'queued',
          audioUrl: null,
          imageUrl: null
        }]
        setTracks(prev => [...tempTracks, ...prev])
        startPolling(taskId, authMode)
      } else {
        alert(`Generation failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Generation failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const startPolling = (taskId: string, pollingAuthMode?: 'api_key' | 'cookie') => {
    const currentAuthMode = pollingAuthMode || authMode
    const interval = setInterval(async () => {
      try {
        // @ts-ignore
        const result = await window.electron.invoke('suno:status', { taskId, authMode: currentAuthMode })
        if (result.success && result.data.data) {
          const task = result.data.data

          setTracks(prev => prev.map(track => {
            if (track.id === taskId) {
              // Handle both API Key and Cookie response formats
              let clip, status
              if (currentAuthMode === 'cookie') {
                // Cookie mode: response already transformed in backend
                clip = task.response?.sunoData?.[0]
                status = task.status === 'SUCCESS' ? 'complete' : (task.status === 'PENDING' ? 'processing' : task.status?.toLowerCase())
              } else {
                // API Key mode: original format
                clip = task.clips?.[0]
                status = task.status
              }
              return {
                ...track,
                status: status,
                audioUrl: clip?.audio_url,
                imageUrl: clip?.image_url,
                title: clip?.title || track.title
              }
            }
            return track
          }))

          // Check completion for both modes
          const isComplete = task.status === 'complete' || task.status === 'SUCCESS' || task.status === 'failed' || task.status === 'FAILED'
          if (isComplete) {
            clearInterval(interval)
          }
        }
      } catch (error) {
        console.error('Polling error:', error)
        clearInterval(interval)
      }
    }, 5000)
  }

  const handleSelectExternalFile = async () => {
    // @ts-ignore
    const filePath = await window.electron.invoke('dialog:open-audio')
    if (filePath) {
      const fileName = filePath.split(/[\\/]/).pop()
      const newTrack = {
        id: `ext-${Date.now()}`,
        title: fileName,
        status: 'external',
        localPath: filePath,
        isExternal: true
      }
      setTracks(prev => [newTrack, ...prev])
    }
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

  const handleSeparate = async (track: any) => {
    if (!track.localPath) {
      alert('Please download the WAV file first.')
      return
    }

    setTracks(prev => prev.map(t => t.id === track.id ? { ...t, isSeparating: true } : t))
    setSeparateLogs(prev => ({ ...prev, [track.id]: ['Starting AI Stem Separation...'] }))

    try {
      // @ts-ignore
      const result = await window.electron.invoke('suno:separate', {
        filePath: track.localPath,
        trackId: track.id
      })

      if (result.success) {
        setTracks(prev => prev.map(t => t.id === track.id ? {
          ...t,
          stems: result.stems,
          stemFolder: result.folder
        } : t))
        setSeparateLogs(prev => ({ ...prev, [track.id]: [...(prev[track.id] || []), '✅ Stem separation complete!'] }))
      } else {
        const errorMsg = `❌ Separation failed: ${result.error}`
        setSeparateLogs(prev => ({ ...prev, [track.id]: [...(prev[track.id] || []), errorMsg] }))
        alert(errorMsg)
      }
    } catch (error: any) {
      const errorMsg = `❌ Error: ${error.message || 'Unknown error occurred'}`
      setSeparateLogs(prev => ({ ...prev, [track.id]: [...(prev[track.id] || []), errorMsg] }))
      console.error('Separation failed:', error)
    } finally {
      setTracks(prev => prev.map(t => t.id === track.id ? { ...t, isSeparating: false } : t))
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
            {/* Auth Mode Selector */}
            <div className="flex items-center gap-2 mb-2">
              <label className="text-[10px] text-text-secondary">인증 방식:</label>
              <select
                value={authMode}
                onChange={(e) => handleAuthModeChange(e.target.value as 'api_key' | 'cookie')}
                className="bg-surface/50 border border-border rounded-md px-2 py-1 text-xs focus:ring-1 focus:ring-accent outline-none cursor-pointer"
              >
                <option value="api_key">🔑 API Key (유료)</option>
                <option value="cookie">🎫 JWT Token (무료)</option>
              </select>
            </div>

            {/* Conditional Input Fields */}
            {authMode === 'api_key' ? (
              <div className="flex flex-col items-end">
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
            ) : (
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-[10px] text-text-secondary">Suno JWT Token</label>
                  <button
                    onClick={() => setShowCookieGuide(!showCookieGuide)}
                    className="text-[9px] text-accent hover:underline"
                  >
                    {showCookieGuide ? '가이드 닫기' : '추출 방법?'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type={isApiKeyVisible ? 'text' : 'password'}
                    value={sunoCookie}
                    onChange={(e) => handleSaveCookie(e.target.value)}
                    placeholder="Paste JWT Token here..."
                    className="bg-surface/50 border border-border rounded-md px-3 py-1.5 text-xs w-64 focus:ring-1 focus:ring-accent outline-none"
                  />
                  <button
                    onClick={() => setIsApiKeyVisible(!isApiKeyVisible)}
                    className="p-1.5 bg-surface border border-border rounded-md hover:bg-border transition-colors"
                  >
                    {isApiKeyVisible ? '👁️' : '🙈'}
                  </button>
                </div>
                {showCookieGuide && (
                  <div className="absolute top-full right-0 mt-2 p-3 bg-surface border border-border rounded-lg shadow-xl z-50 w-80 text-left">
                    <p className="text-[10px] text-text-secondary mb-2 font-bold">🎫 JWT 토큰 추출 방법:</p>
                    <ol className="text-[9px] text-text-secondary space-y-1 list-decimal list-inside">
                      <li>브라우저에서 <a href="https://suno.com" target="_blank" className="text-accent hover:underline">suno.com</a> 로그인</li>
                      <li><kbd className="bg-background px-1 rounded">F12</kbd> 키로 개발자 도구 열기</li>
                      <li><strong>Network</strong> 탭 선택 후 페이지 새로고침</li>
                      <li><code className="bg-background px-1 rounded text-[8px]">client?_clerk</code> 요청 클릭</li>
                      <li><strong>Response</strong> 탭에서 <code className="bg-background px-1 rounded text-[8px]">jwt</code> 값 복사</li>
                    </ol>
                    <p className="text-[8px] text-orange-400 mt-2">⚠️ 토큰은 약 1시간 후 만료됩니다</p>
                  </div>
                )}
                {sunoCookie && (
                  <span className="text-[9px] text-green-400 mt-0.5">✓ JWT Token saved</span>
                )}
              </div>
            )}
          </div>
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold transition-all ${(authMode === 'api_key' ? apiKey : sunoCookie) ? 'bg-green-500 shadow-lg shadow-green-500/20' : 'bg-gradient-to-br from-blue-500 to-purple-600'}`}
          >
            {(authMode === 'api_key' ? apiKey : sunoCookie) ? '✓' : 'JD'}
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
                  <div key={track.id} className="space-y-2">
                    <div
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
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${track.status === 'complete' || track.status === 'external'
                            ? (track.localPath ? 'bg-accent/20 text-accent border border-accent/20' : 'bg-green-500/10 text-green-400 border border-green-500/10')
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/10 animate-pulse'
                            }`}>
                            {track.localPath ? (track.isExternal ? 'LOCAL READY' : 'READY TO DRAG') : track.status}
                          </span>
                          <span className="text-[10px] text-text-secondary font-mono opacity-50 truncate">
                            {track.isExternal ? 'External File' : `ID: ${track.id.split('-')[0]}...`}
                          </span>
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {(track.status === 'complete' || track.status === 'external') && (
                          <div className="flex gap-2">
                            {!track.localPath ? (
                              <button
                                onClick={() => handleDownload(track)}
                                disabled={track.isDownloading}
                                className="px-3 py-1.5 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors text-xs font-medium disabled:opacity-50"
                              >
                                {track.isDownloading ? '...' : 'Download WAV'}
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleSeparate(track)}
                                  disabled={track.isSeparating}
                                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-xs font-medium disabled:opacity-50 flex items-center gap-1"
                                >
                                  <span>✨</span> {track.isSeparating ? '...' : 'Stems'}
                                </button>
                                <div className="p-2 text-accent/40 cursor-grab" title="Drag me!">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16"></path></svg>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {separateLogs[track.id] && (
                      <div className="mx-4 mb-3 p-3 bg-black/40 rounded-lg border border-white/5 font-mono text-[10px] text-purple-300 max-h-48 overflow-y-auto shadow-inner relative group/logs">
                        <button
                          onClick={() => setSeparateLogs(prev => {
                            const next = { ...prev }
                            delete next[track.id]
                            return next
                          })}
                          className="absolute top-2 right-2 text-[8px] bg-white/10 px-1.5 py-0.5 rounded opacity-0 group-hover/logs:opacity-100 transition-opacity hover:bg-white/20 text-white"
                        >
                          CLOSE LOGS
                        </button>
                        {separateLogs[track.id].map((log, i) => (
                          <div key={i} className="whitespace-pre-wrap break-all text-purple-400/80 mb-0.5">{log}</div>
                        ))}
                      </div>
                    )}

                    {track.stems && (
                      <div className="mx-4 grid grid-cols-2 gap-2 pb-2">
                        {track.stems.map((stemPath: string, i: number) => {
                          const stemName = stemPath.split(/[\\/]/).pop()
                          return (
                            <div
                              key={i}
                              draggable
                              onDragStart={(e) => {
                                e.preventDefault()
                                // @ts-ignore
                                window.electron.send('ondragstart', stemPath)
                              }}
                              className="p-2 bg-white/5 border border-white/10 rounded-md text-[10px] flex justify-between items-center group cursor-move hover:bg-white/10 hover:border-purple-500/30 transition-all shadow-sm"
                            >
                              <span className="truncate flex-1 text-purple-200/70 group-hover:text-purple-100">{stemName}</span>
                              <span className="text-[8px] bg-purple-500/20 text-purple-400 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">DRAG</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
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
            <h2 className="text-lg font-semibold mb-4">AI Tools</h2>
            <div className="space-y-4">
              <button
                onClick={handleSelectExternalFile}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-sm font-bold hover:shadow-lg hover:shadow-purple-500/20 transition-all flex items-center justify-center gap-2"
              >
                <span>📂</span> Load Local File for Stems
              </button>
              <p className="text-[10px] text-text-secondary text-center px-2">
                Suno 생성 곡이 아닌 본인의 WAV/MP3 파일을 불러와 보컬/악기로 분리할 수 있습니다.
              </p>
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
