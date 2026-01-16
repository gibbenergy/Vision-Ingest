# Changelog

All notable changes to VisionIngest will be documented in this file.

## [1.0.0] - 2025-02-01

### Added

- **DeepSeek-OCR-2 Integration**: State-of-the-art vision model with Visual Causal Flow architecture for accurate document OCR
- **Local LLM Parsing**: Integration with Ollama for 100% local JSON extraction (gpt-oss, llama3, mistral, etc.)
- **Multi-Document Templates**: Support for resumes, invoices, receipts, contracts, business cards, and more
- **Processing Modes**:
  - Performance Mode: Both models in VRAM for maximum speed
  - Batch Mode: OCR all files first, then parse all
  - Low VRAM Mode: Unload OCR after each file (works on 8GB GPUs)
- **OCR Quality Presets**: Tiny (512px), Small (640px), Base (1024px), Large (1280px)
- **Modern Web UI**:
  - Drag-and-drop file upload
  - Real-time GPU/VRAM monitoring
  - Side-by-side document preview and JSON output
  - Editable JSON with live validation
- **REST API**: Full FastAPI backend with OpenAPI documentation
- **One-Click Startup**: `start.bat` handles environment setup, dependencies, and service launch
- **Auto Browser Launch**: Opens UI automatically on startup with loading indicator while backend initializes

### Technical

- Python 3.11+ with FastAPI backend
- React 18 + TypeScript + Vite frontend
- CUDA 12.8 support with optional Flash Attention 2
- uv package manager for fast dependency installation
- Async processing with thread pool for non-blocking GPU operations
