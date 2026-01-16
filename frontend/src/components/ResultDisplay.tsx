import { useState, useRef, useCallback } from 'react'

interface ResultItem {
  filename: string
  status: 'pending' | 'processing' | 'success' | 'error'
  rawMarkdown?: string
  parsedJson?: object
  error?: string
  processingTime?: number
  fileUrl?: string
}

interface ResultDisplayProps {
  results: ResultItem[]
  onRemove: (index: number) => void
  onUpdate: (index: number, parsedJson: object) => void
}

function ResultDisplay({ results, onRemove, onUpdate }: ResultDisplayProps) {
  const [selectedResult, setSelectedResult] = useState<ResultItem | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [showRaw, setShowRaw] = useState(false)
  
  // Editing state
  const [editedJson, setEditedJson] = useState<string>('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  
  // Zoom/pan state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const previewRef = useRef<HTMLDivElement>(null)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.max(0.25, Math.min(5, z * delta)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    }
  }, [isPanning, panStart])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  if (results.length === 0) return null

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return '...'
      case 'processing': return '...'
      case 'success': return 'OK'
      case 'error': return '!'
      default: return '?'
    }
  }

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'pending': return 'status-pending'
      case 'processing': return 'status-processing'
      case 'success': return 'status-success'
      case 'error': return 'status-error'
      default: return ''
    }
  }

  const handleSaveJson = () => {
    if (!editedJson || jsonError) return
    // Sanitize: replace non-printable and problematic characters, keep standard ASCII + common Unicode
    const sanitized = editedJson
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
      .replace(/\u00B0/g, ' degrees ') // Replace degree symbol
      .replace(/[\uFFFD\uFFFE\uFFFF]/g, '') // Remove replacement/invalid chars
    const blob = new Blob([sanitized], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedResult!.filename.replace(/\.[^/.]+$/, '') + '_parsed.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const openResult = (result: ResultItem, index: number) => {
    if (result.status === 'success') {
      setSelectedResult(result)
      setSelectedIndex(index)
      setShowRaw(false)
      setEditedJson(JSON.stringify(result.parsedJson, null, 2))
      setJsonError(null)
      setHasChanges(false)
      resetView()
    }
  }

  const handleJsonChange = (value: string) => {
    setEditedJson(value)
    setHasChanges(true)
    try {
      JSON.parse(value)
      setJsonError(null)
    } catch (e) {
      setJsonError((e as Error).message)
    }
  }

  const handleApplyChanges = () => {
    if (jsonError || selectedIndex < 0) return
    try {
      const parsed = JSON.parse(editedJson)
      onUpdate(selectedIndex, parsed)
      setSelectedResult({ ...selectedResult!, parsedJson: parsed })
      setHasChanges(false)
    } catch (e) {
      setJsonError((e as Error).message)
    }
  }

  return (
    <>
      <div className="results-container">
        <h3>Results ({results.filter(r => r.status === 'success').length}/{results.length})</h3>
        <div className="results-grid">
          {results.map((result, index) => (
            <div
              key={index}
              className={`result-card ${getStatusClass(result.status)} ${result.status === 'success' ? 'clickable' : ''}`}
              onClick={() => openResult(result, index)}
            >
              <button 
                className="result-remove" 
                onClick={(e) => { e.stopPropagation(); onRemove(index) }}
                title="Remove result"
              >
                x
              </button>
              <div className={`result-icon ${getStatusClass(result.status)}`}>
                {result.status === 'processing' ? (
                  <div className="spinner"></div>
                ) : (
                  getStatusIcon(result.status)
                )}
              </div>
              <div className="result-name" title={result.filename}>
                {result.filename.length > 12 ? result.filename.slice(0, 9) + '...' : result.filename}
              </div>
              {result.processingTime && (
                <div className="result-time">{(result.processingTime / 1000).toFixed(1)}s</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {selectedResult && (
        <div className="modal-overlay" onClick={() => setSelectedResult(null)}>
          <div className="modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedResult.filename}</h3>
              <div className="modal-actions">
                <button className="save-btn" onClick={handleSaveJson} title="Save JSON">
                  Save JSON
                </button>
                <button className="modal-close" onClick={() => setSelectedResult(null)}>x</button>
              </div>
            </div>
            
            <div className="compare-container">
              <div className="compare-column">
                <div className="compare-header">
                  Original File
                  {selectedResult.fileUrl && !selectedResult.filename.toLowerCase().endsWith('.pdf') && (
                    <div className="zoom-controls">
                      <button onClick={() => setZoom(z => Math.min(5, z * 1.2))} title="Zoom In">+</button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button onClick={() => setZoom(z => Math.max(0.25, z / 1.2))} title="Zoom Out">-</button>
                      <button onClick={resetView} title="Reset">R</button>
                    </div>
                  )}
                </div>
                {selectedResult.fileUrl ? (
                  selectedResult.filename.toLowerCase().endsWith('.pdf') ? (
                    <embed 
                      src={selectedResult.fileUrl + '#toolbar=1&navpanes=1&scrollbar=1&view=FitH'}
                      type="application/pdf"
                      className="pdf-embed"
                      title="PDF Preview"
                    />
                  ) : (
                    <div 
                      className="compare-content zoomable"
                      ref={previewRef}
                      onWheel={handleWheel}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
                    >
                      <img 
                        src={selectedResult.fileUrl} 
                        alt="Original" 
                        className="preview-image"
                        style={{
                          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                          transformOrigin: 'center center'
                        }}
                        draggable={false}
                      />
                    </div>
                  )
                ) : (
                  <div className="compare-content">
                    <div className="no-preview">Preview not available</div>
                  </div>
                )}
              </div>
              
              <div className="compare-column">
                <div className="compare-header">
                  Parsed JSON (Editable)
                  {hasChanges && (
                    <button 
                      className="apply-btn"
                      onClick={handleApplyChanges}
                      disabled={!!jsonError}
                      title="Apply changes"
                    >
                      Apply
                    </button>
                  )}
                </div>
                <div className="compare-content">
                  <textarea
                    className={`json-editor ${jsonError ? 'has-error' : ''}`}
                    value={editedJson}
                    onChange={(e) => handleJsonChange(e.target.value)}
                    spellCheck={false}
                  />
                  {jsonError && (
                    <div className="json-error">Invalid JSON: {jsonError}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="raw-section">
              <button 
                className="raw-toggle"
                onClick={() => setShowRaw(!showRaw)}
              >
                {showRaw ? 'Hide' : 'Show'} Raw Markdown
              </button>
              {showRaw && (
                <pre className="code-block raw-text">
                  {selectedResult.rawMarkdown || 'No raw output available'}
                </pre>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(editedJson)
                }}
              >
                Copy JSON
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ResultDisplay
