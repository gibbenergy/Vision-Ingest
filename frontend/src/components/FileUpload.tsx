import { useState, useEffect, DragEvent } from 'react'
import { HelpCircle, Zap, Layers, MemoryStick, ScanEye } from 'lucide-react'

interface OllamaModel {
  name: string
  size: number
  modified: string
}

interface Template {
  id: string
  name: string
  category: string
}

interface TemplateCategories {
  [category: string]: { id: string; name: string }[]
}

type ProcessingMode = 'performance' | 'batch' | 'lowvram'
type OCRQuality = 'tiny' | 'small' | 'base' | 'large'

interface FileUploadProps {
  onStart: (files: File[], model: string, template: string, contextWindow: number, mode: ProcessingMode, quality: OCRQuality) => void
  onStop: () => void
  isProcessing: boolean
}

const OCR_QUALITY_PRESETS = [
  { id: 'tiny' as OCRQuality, size: 512, tokens: 64, label: 'Tiny', time: '~8s', color: '#888' },
  { id: 'small' as OCRQuality, size: 640, tokens: 100, label: 'Small', time: '~12s', color: '#aaa' },
  { id: 'base' as OCRQuality, size: 1024, tokens: 256, label: 'Base', time: '~25s', color: '#00d9ff' },
  { id: 'large' as OCRQuality, size: 1280, tokens: 400, label: 'Large', time: '~40s', color: '#00ff88' }
]

const PROCESSING_MODES = [
  {
    id: 'performance' as ProcessingMode,
    name: 'Performance',
    icon: Zap,
    color: '#00ff88',
    description: 'Both vision and language models stay in VRAM. Fastest processing but requires 16GB+ VRAM.',
    short: 'Max speed, high VRAM'
  },
  {
    id: 'batch' as ProcessingMode,
    name: 'Batch',
    icon: Layers,
    color: '#00d9ff',
    description: 'Process all files with vision model first, then parse all with language model. Good balance for multiple files.',
    short: 'OCR all, then parse all'
  },
  {
    id: 'lowvram' as ProcessingMode,
    name: 'Low VRAM',
    icon: MemoryStick,
    color: '#ff9f43',
    description: 'Unload vision model after each file before language model parsing. Slowest but works with 8GB VRAM.',
    short: 'Unload after each file'
  }
]

function FileUpload({ onStart, onStop, isProcessing }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [models, setModels] = useState<OllamaModel[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [categories, setCategories] = useState<TemplateCategories>({})
  const [selectedModel, setSelectedModel] = useState<string>('gpt-oss:latest')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('resume')
  const [contextWindow, setContextWindow] = useState<number>(8192)
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('performance')
  const [hoveredMode, setHoveredMode] = useState<ProcessingMode | null>(null)
  const [ocrQuality, setOcrQuality] = useState<OCRQuality>('base')
  const [loadingModels, setLoadingModels] = useState(true)
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [backendStatus, setBackendStatus] = useState<'connecting' | 'loading_model' | 'ready'>('connecting')

  useEffect(() => {
    // Retry fetch with exponential backoff
    const fetchWithRetry = async (
      url: string,
      onSuccess: (data: any) => void,
      onFinally: () => void,
      maxRetries = 30,
      baseDelay = 1000
    ) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const res = await fetch(url)
          if (res.ok) {
            const data = await res.json()
            onSuccess(data)
            onFinally()
            return
          }
        } catch {
          // Connection refused - backend not ready
        }
        // Wait before retry (1s, 1s, 1s... keeps trying)
        await new Promise(r => setTimeout(r, baseDelay))
      }
      onFinally()
    }

    // Check backend health status with model_loaded flag
    const checkHealth = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          const res = await fetch('/api/health')
          if (res.ok) {
            const data = await res.json()
            if (data.model_loaded) {
              setBackendStatus('ready')
              return
            } else {
              setBackendStatus('loading_model')
            }
          }
        } catch {
          setBackendStatus('connecting')
        }
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    checkHealth()

    fetchWithRetry(
      '/api/ollama/models',
      (data) => {
        if (data.status === 'success' && data.models.length > 0) {
          setModels(data.models)
          setSelectedModel(data.models[0].name)
        }
      },
      () => setLoadingModels(false)
    )

    fetchWithRetry(
      '/api/templates',
      (data) => {
        if (data.status === 'success') {
          setTemplates(data.templates || [])
          setCategories(data.categories || {})
          if (data.templates?.length > 0) {
            setSelectedTemplate(data.templates[0].id)
          }
        }
      },
      () => setLoadingTemplates(false)
    )
  }, [])

  const isValidFile = (file: File) => {
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    return allowedTypes.includes(file.type) || file.name.match(/\.(pdf|png|jpg|jpeg|webp)$/i)
  }

  const isDuplicate = (file: File, existingFiles: File[]) => {
    return existingFiles.some(f => f.name === file.name && f.size === file.size)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(isValidFile)
    if (droppedFiles.length > 0) {
      setFiles(prev => {
        const newFiles = droppedFiles.filter(f => !isDuplicate(f, prev))
        return [...prev, ...newFiles]
      })
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (selectedFiles) {
      const validFiles = Array.from(selectedFiles).filter(isValidFile)
      setFiles(prev => {
        const newFiles = validFiles.filter(f => !isDuplicate(f, prev))
        return [...prev, ...newFiles]
      })
    }
    e.target.value = ''
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const getFileIcon = (file: File) => {
    if (file.type === 'application/pdf') return 'PDF'
    if (file.type.startsWith('image/')) return 'IMG'
    return 'DOC'
  }

  const handleStartStop = () => {
    if (isProcessing) {
      onStop()
    } else if (files.length > 0) {
      onStart(files, selectedModel, selectedTemplate, contextWindow, processingMode, ocrQuality)
    }
  }

  return (
    <div className="upload-container">
      <h2>Upload Documents</h2>

      {backendStatus !== 'ready' && (
        <div className="backend-loading-banner">
          <div className="loading-spinner" />
          <span>
            {backendStatus === 'connecting'
              ? 'Connecting to backend...'
              : 'Loading DeepSeek-OCR-2 model (this may take 15-30s)...'}
          </span>
        </div>
      )}

      <div className="selectors-row">
        <div className="selector">
          <label>Document Type:</label>
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            disabled={isProcessing || loadingTemplates}
          >
            {loadingTemplates ? (
              <option>Loading...</option>
            ) : Object.keys(categories).length > 0 ? (
              Object.entries(categories).map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              ))
            ) : (
              templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))
            )}
          </select>
        </div>

        <div className="selector">
          <label>LLM Model:</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isProcessing || loadingModels}
          >
            {loadingModels ? (
              <option>Loading...</option>
            ) : (
              models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({(m.size / 1024 / 1024 / 1024).toFixed(1)}GB)
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      <div className="selectors-row single">
        <div className="selector">
          <label>Context Window (tokens):</label>
          <select
            value={contextWindow}
            onChange={(e) => setContextWindow(Number(e.target.value))}
            disabled={isProcessing}
          >
            <option value={4096}>4K (4,096)</option>
            <option value={8192}>8K (8,192)</option>
            <option value={16384}>16K (16,384)</option>
            <option value={32768}>32K (32,768)</option>
            <option value={65536}>64K (65,536)</option>
            <option value={131072}>128K (131,072)</option>
          </select>
        </div>
      </div>

      <div className="processing-mode-section">
        <div className="mode-header">
          <label>Processing Mode</label>
          <div className="mode-tooltip-trigger">
            <HelpCircle size={14} />
            <div className="mode-tooltip">
              Choose how to manage GPU memory during processing. Performance mode is fastest but needs more VRAM.
            </div>
          </div>
        </div>
        
        <div className="mode-options">
          {PROCESSING_MODES.map((mode) => {
            const Icon = mode.icon
            const isSelected = processingMode === mode.id
            const isHovered = hoveredMode === mode.id
            
            return (
              <div
                key={mode.id}
                className={`mode-option ${isSelected ? 'selected' : ''}`}
                onClick={() => !isProcessing && setProcessingMode(mode.id)}
                onMouseEnter={() => setHoveredMode(mode.id)}
                onMouseLeave={() => setHoveredMode(null)}
                style={{ 
                  borderColor: isSelected ? mode.color : undefined,
                  opacity: isProcessing ? 0.5 : 1
                }}
              >
                <div className="mode-icon" style={{ color: mode.color }}>
                  <Icon size={20} />
                </div>
                <div className="mode-info">
                  <span className="mode-name">{mode.name}</span>
                  <span className="mode-short">{mode.short}</span>
                </div>
                <div className="mode-help">
                  <HelpCircle size={14} />
                  {isHovered && (
                    <div className="mode-description">
                      {mode.description}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="ocr-quality-section">
        <div className="mode-header">
          <label>OCR Quality</label>
          <div className="mode-tooltip-trigger">
            <HelpCircle size={14} />
            <div className="mode-tooltip">
              Higher quality uses more vision tokens for better accuracy on dense documents, but takes longer.
            </div>
          </div>
        </div>
        
        <div className="quality-slider">
          <div className="quality-track">
            {OCR_QUALITY_PRESETS.map((preset, idx) => {
              const isSelected = ocrQuality === preset.id
              const selectedIdx = OCR_QUALITY_PRESETS.findIndex(p => p.id === ocrQuality)
              const isActive = idx <= selectedIdx
              
              return (
                <div
                  key={preset.id}
                  className={`quality-step ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                  onClick={() => !isProcessing && setOcrQuality(preset.id)}
                  style={{ opacity: isProcessing ? 0.5 : 1 }}
                >
                  <div 
                    className="quality-dot"
                    style={{ 
                      backgroundColor: isActive ? preset.color : '#333',
                      boxShadow: isSelected ? `0 0 8px ${preset.color}` : 'none'
                    }}
                  />
                  <span className="quality-label">{preset.label}</span>
                  <span className="quality-size">{preset.size}px</span>
                </div>
              )
            })}
            <div 
              className="quality-track-fill" 
              style={{ 
                width: `${(OCR_QUALITY_PRESETS.findIndex(p => p.id === ocrQuality) / (OCR_QUALITY_PRESETS.length - 1)) * 100}%`,
                backgroundColor: OCR_QUALITY_PRESETS.find(p => p.id === ocrQuality)?.color 
              }}
            />
          </div>
          <div className="quality-info">
            <ScanEye size={16} />
            <span>{OCR_QUALITY_PRESETS.find(p => p.id === ocrQuality)?.tokens} vision tokens</span>
            <span className="quality-time">{OCR_QUALITY_PRESETS.find(p => p.id === ocrQuality)?.time}/page</span>
          </div>
        </div>
      </div>

      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => !isProcessing && document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={handleFileInput}
          disabled={isProcessing}
          multiple
          style={{ display: 'none' }}
        />
        
        {files.length === 0 ? (
          <div className="drop-placeholder">
            <div className="drop-icon">+</div>
            <p>Drop files here or click to browse</p>
            <span>PDF, PNG, JPG, WebP (max 10MB each)</span>
          </div>
        ) : (
          <div className="file-grid">
            {files.map((file, index) => (
              <div key={index} className="file-card">
                <button 
                  className="file-remove" 
                  onClick={(e) => { e.stopPropagation(); removeFile(index) }}
                  disabled={isProcessing}
                >
                  x
                </button>
                <div className="file-icon">{getFileIcon(file)}</div>
                <div className="file-name" title={file.name}>
                  {file.name.length > 15 ? file.name.slice(0, 12) + '...' : file.name}
                </div>
              </div>
            ))}
            <div className="file-card add-more">
              <div className="file-icon">+</div>
              <div className="file-name">Add more</div>
            </div>
          </div>
        )}
      </div>

      <button
        className={`action-btn ${isProcessing ? 'stop' : 'start'}`}
        onClick={handleStartStop}
        disabled={files.length === 0 && !isProcessing}
      >
        {isProcessing ? 'Stop' : 'Start Processing'}
      </button>
    </div>
  )
}

export default FileUpload
