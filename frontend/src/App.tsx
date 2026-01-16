import { useState, useRef, useEffect } from 'react'
import FileUpload from './components/FileUpload'
import ResultDisplay from './components/ResultDisplay'

interface ResultItem {
  filename: string
  status: 'pending' | 'processing' | 'success' | 'error'
  rawMarkdown?: string
  parsedJson?: object
  error?: string
  processingTime?: number
  fileUrl?: string
}

interface SystemInfo {
  cudaAvailable: boolean
  gpuName?: string
  vramTotal?: number
  vramUsed?: number
  ramTotal?: number
  ramUsed?: number
}

function App() {
  const [results, setResults] = useState<ResultItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const fetchSystemInfo = () => {
      fetch('/api/health')
        .then(res => res.json())
        .then(data => {
          setSystemInfo({
            cudaAvailable: data.cuda_available,
            gpuName: data.gpu_name,
            vramTotal: data.vram_total,
            vramUsed: data.vram_used,
            ramTotal: data.ram_total,
            ramUsed: data.ram_used
          })
        })
        .catch(() => {})
    }
    fetchSystemInfo()
    const interval = setInterval(fetchSystemInfo, 5000) // Update every 5s
    return () => clearInterval(interval)
  }, [])

  type ProcessingMode = 'performance' | 'batch' | 'lowvram'
  type OCRQuality = 'tiny' | 'small' | 'base' | 'large'

  const handleStart = async (files: File[], model: string, template: string, contextWindow: number, mode: ProcessingMode, quality: OCRQuality = 'base') => {
    setIsProcessing(true)
    abortControllerRef.current = new AbortController()

    // Initialize results for all files with preview URLs
    const initialResults: ResultItem[] = files.map(f => ({
      filename: f.name,
      status: 'pending',
      fileUrl: URL.createObjectURL(f)
    }))
    setResults(initialResults)

    switch (mode) {
      case 'performance':
        // Both models in VRAM, process sequentially
        await handleNormalProcessing(files, model, template, contextWindow, quality)
        break
      case 'batch':
        // OCR all, unload, then parse all
        await handleBatchProcessing(files, model, template, contextWindow, quality)
        break
      case 'lowvram':
        // Unload after each file
        await handleLowVramProcessing(files, model, template, contextWindow, quality)
        break
    }

    setIsProcessing(false)
    abortControllerRef.current = null
  }

  const handleNormalProcessing = async (files: File[], model: string, template: string, contextWindow: number, quality: string) => {
    for (let i = 0; i < files.length; i++) {
      if (abortControllerRef.current?.signal.aborted) break

      const file = files[i]
      
      setResults(prev => prev.map((r, idx) => 
        idx === i ? { ...r, status: 'processing' } : r
      ))

      const startTime = Date.now()

      try {
        const formData = new FormData()
        formData.append('file', file)

        const params = new URLSearchParams({ 
          llm_model: model, 
          template,
          context_window: contextWindow.toString(),
          quality
        })
        const response = await fetch(`/api/ocr/process?${params}`, {
          method: 'POST',
          body: formData,
          signal: abortControllerRef.current?.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'Processing failed')
        }

        const data = await response.json()
        const processingTime = Date.now() - startTime

        setResults(prev => prev.map((r, idx) => 
          idx === i ? {
            ...r,
            status: 'success',
            rawMarkdown: data.raw_output,
            parsedJson: data.parsed_data,
            processingTime
          } : r
        ))
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setResults(prev => prev.map((r, idx) => 
            idx === i ? { ...r, status: 'pending' } : r
          ))
          break
        }
        
        setResults(prev => prev.map((r, idx) => 
          idx === i ? {
            ...r,
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown error'
          } : r
        ))
      }
    }
  }

  const handleBatchProcessing = async (files: File[], model: string, template: string, contextWindow: number, quality: string) => {
    const markdownResults: { index: number; markdown: string; startTime: number }[] = []

    // Phase 1: OCR all files
    for (let i = 0; i < files.length; i++) {
      if (abortControllerRef.current?.signal.aborted) break

      const file = files[i]
      
      setResults(prev => prev.map((r, idx) => 
        idx === i ? { ...r, status: 'processing' } : r
      ))

      const startTime = Date.now()

      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch(`/api/ocr/extract?quality=${quality}`, {
          method: 'POST',
          body: formData,
          signal: abortControllerRef.current?.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'OCR failed')
        }

        const data = await response.json()
        
        // Store markdown for phase 2
        markdownResults.push({ index: i, markdown: data.markdown, startTime })
        
        // Update status to show OCR complete, waiting for parse
        setResults(prev => prev.map((r, idx) => 
          idx === i ? { ...r, rawMarkdown: data.markdown, status: 'pending' } : r
        ))
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') break
        
        setResults(prev => prev.map((r, idx) => 
          idx === i ? {
            ...r,
            status: 'error',
            error: err instanceof Error ? err.message : 'OCR failed'
          } : r
        ))
      }
    }

    if (abortControllerRef.current?.signal.aborted) return

    // Phase 2: Unload vision model to free VRAM
    try {
      await fetch('/api/ocr/unload', { method: 'POST' })
    } catch (e) {
      console.warn('Failed to unload OCR model:', e)
    }

    // Phase 3: Parse all markdown with LLM
    for (const { index, markdown, startTime } of markdownResults) {
      if (abortControllerRef.current?.signal.aborted) break

      setResults(prev => prev.map((r, idx) => 
        idx === index ? { ...r, status: 'processing' } : r
      ))

      try {
        const response = await fetch('/api/llm/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdown,
            filename: files[index].name,
            llm_model: model,
            template,
            context_window: contextWindow
          }),
          signal: abortControllerRef.current?.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'Parse failed')
        }

        const data = await response.json()
        const processingTime = Date.now() - startTime

        setResults(prev => prev.map((r, idx) => 
          idx === index ? {
            ...r,
            status: 'success',
            parsedJson: data.parsed_data,
            processingTime
          } : r
        ))
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') break
        
        setResults(prev => prev.map((r, idx) => 
          idx === index ? {
            ...r,
            status: 'error',
            error: err instanceof Error ? err.message : 'Parse failed'
          } : r
        ))
      }
    }
  }

  const handleLowVramProcessing = async (files: File[], model: string, template: string, contextWindow: number, quality: string) => {
    // Process each file: OCR -> unload -> parse -> repeat
    for (let i = 0; i < files.length; i++) {
      if (abortControllerRef.current?.signal.aborted) break

      const file = files[i]
      const startTime = Date.now()
      
      // Step 1: OCR this file
      setResults(prev => prev.map((r, idx) => 
        idx === i ? { ...r, status: 'processing' } : r
      ))

      let markdown = ''
      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch(`/api/ocr/extract?quality=${quality}`, {
          method: 'POST',
          body: formData,
          signal: abortControllerRef.current?.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'OCR failed')
        }

        const data = await response.json()
        markdown = data.markdown
        
        setResults(prev => prev.map((r, idx) => 
          idx === i ? { ...r, rawMarkdown: markdown } : r
        ))
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') break
        
        setResults(prev => prev.map((r, idx) => 
          idx === i ? {
            ...r,
            status: 'error',
            error: err instanceof Error ? err.message : 'OCR failed'
          } : r
        ))
        continue
      }

      // Step 2: Unload vision model
      try {
        await fetch('/api/ocr/unload', { method: 'POST' })
      } catch (e) {
        console.warn('Failed to unload OCR model:', e)
      }

      // Step 3: Parse with LLM
      try {
        const response = await fetch('/api/llm/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdown,
            filename: file.name,
            llm_model: model,
            template,
            context_window: contextWindow
          }),
          signal: abortControllerRef.current?.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'Parse failed')
        }

        const data = await response.json()
        const processingTime = Date.now() - startTime

        setResults(prev => prev.map((r, idx) => 
          idx === i ? {
            ...r,
            status: 'success',
            parsedJson: data.parsed_data,
            processingTime
          } : r
        ))
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') break
        
        setResults(prev => prev.map((r, idx) => 
          idx === i ? {
            ...r,
            status: 'error',
            error: err instanceof Error ? err.message : 'Parse failed'
          } : r
        ))
      }
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    // Reset all 'processing' items to 'pending' so spinners stop
    setResults(prev => prev.map(r => 
      r.status === 'processing' ? { ...r, status: 'pending' } : r
    ))
    setIsProcessing(false)
  }

  const handleRemoveResult = (index: number) => {
    setResults(prev => {
      const result = prev[index]
      if (result.fileUrl) {
        URL.revokeObjectURL(result.fileUrl)
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleUpdateResult = (index: number, parsedJson: object) => {
    setResults(prev => prev.map((r, i) => 
      i === index ? { ...r, parsedJson } : r
    ))
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <h1>VisionIngest <span style={{ fontSize: '0.5em', opacity: 0.6 }}>v1.0</span></h1>
          <p>Document Parser</p>
        </div>
        
        {systemInfo && systemInfo.cudaAvailable && (
          <div className="hardware-panel">
            <div className="hardware-header">
              <span className="hardware-label">HARDWARE</span>
              <span className="live-indicator">
                <span className="live-dot"></span>
                LIVE
              </span>
            </div>
            <div className="hardware-gpu">{systemInfo.gpuName || 'GPU'}</div>
            <div className="hardware-stats">
              <div className="stat-row">
                <span className="stat-label">VRAM</span>
                <div className="stat-bar">
                  <div 
                    className="stat-fill vram" 
                    style={{ width: `${((systemInfo.vramUsed || 0) / (systemInfo.vramTotal || 1)) * 100}%` }}
                  ></div>
                </div>
                <span className="stat-value">
                  {((systemInfo.vramUsed || 0) / 1024).toFixed(1)} / {((systemInfo.vramTotal || 0) / 1024).toFixed(0)} GB
                </span>
              </div>
              {systemInfo.ramTotal && (
                <div className="stat-row">
                  <span className="stat-label">RAM</span>
                  <div className="stat-bar">
                    <div 
                      className="stat-fill ram" 
                      style={{ width: `${((systemInfo.ramUsed || 0) / (systemInfo.ramTotal || 1)) * 100}%` }}
                    ></div>
                  </div>
                  <span className="stat-value">
                    {((systemInfo.ramUsed || 0) / 1024).toFixed(1)} / {((systemInfo.ramTotal || 0) / 1024).toFixed(0)} GB
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="app-main">
        <div className="panel upload-panel">
          <FileUpload
            onStart={handleStart}
            onStop={handleStop}
            isProcessing={isProcessing}
          />
        </div>

        <div className="panel results-panel">
          <ResultDisplay results={results} onRemove={handleRemoveResult} onUpdate={handleUpdateResult} />
          {results.length === 0 && (
            <div className="empty-results">
              <p>Upload documents and click Start to begin extraction</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
