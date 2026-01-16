"""Main FastAPI application."""
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil
import time
import torch
from loguru import logger

from pydantic import BaseModel
from config import settings, list_templates, list_templates_by_category, OCR_QUALITY_PRESETS
from models import (
    HealthResponse,
    PDFAnalysis,
    OCRResult
)


class ParseRequest(BaseModel):
    markdown: str
    filename: str = "document"
    llm_model: str = "gpt-oss:latest"
    template: str = "resume"
    context_window: int = 32768
from ocr_adapter import get_ocr_adapter
from llm_parser import get_llm_parser


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    logger.info("Starting VisionIngest application")
    logger.info(f"CUDA available: {torch.cuda.is_available()}")
    
    ocr = get_ocr_adapter()
    logger.info("Loading DeepSeek-OCR-2 model...")
    success = ocr.load_model()
    if not success:
        logger.error("CRITICAL: Failed to load DeepSeek-OCR-2 model!")
        raise RuntimeError("DeepSeek-OCR-2 model failed to load")
    
    logger.info("DeepSeek-OCR-2 model loaded successfully")
    
    yield
    
    logger.info("Shutting down application")
    ocr.cleanup()


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Resume Parser API",
        "version": settings.version,
        "docs": "/docs"
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint with LIVE GPU and RAM info."""
    import psutil
    ocr = get_ocr_adapter()
    
    gpu_info = {}
    if torch.cuda.is_available():
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            gpu_name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(gpu_name, bytes):
                gpu_name = gpu_name.decode('utf-8')
            gpu_info = {
                "gpu_name": gpu_name,
                "vram_total": mem_info.total // (1024 * 1024),
                "vram_used": mem_info.used // (1024 * 1024)
            }
            pynvml.nvmlShutdown()
        except Exception as e:
            logger.warning(f"pynvml failed, using torch fallback: {e}")
            gpu_info = {
                "gpu_name": torch.cuda.get_device_name(0),
                "vram_total": torch.cuda.get_device_properties(0).total_memory // (1024 * 1024),
                "vram_used": torch.cuda.memory_allocated(0) // (1024 * 1024)
            }
    
    # RAM info
    ram = psutil.virtual_memory()
    ram_info = {
        "ram_total": ram.total // (1024 * 1024),
        "ram_used": ram.used // (1024 * 1024)
    }
    
    return {
        "status": "healthy",
        "cuda_available": torch.cuda.is_available(),
        "model_loaded": ocr.is_loaded(),
        **gpu_info,
        **ram_info
    }


@app.get("/api/templates")
async def get_templates():
    """List available document templates organized by category."""
    templates = list_templates()
    by_category = list_templates_by_category()
    return {
        "status": "success",
        "templates": templates,
        "categories": by_category,
        "count": len(templates)
    }


@app.get("/api/ocr/quality-presets")
async def get_ocr_quality_presets():
    """List available OCR quality presets."""
    presets = []
    for key, value in OCR_QUALITY_PRESETS.items():
        presets.append({
            "id": key,
            "base_size": value["base_size"],
            "tokens": value["tokens"],
            "description": value["description"],
            "est_time": value["est_time"]
        })
    return {
        "status": "success",
        "presets": presets
    }


@app.get("/api/ollama/models")
async def list_ollama_models():
    """List available Ollama models."""
    try:
        import ollama
        response = ollama.list()
        
        model_list = []
        if hasattr(response, 'models'):
            for model in response.models:
                model_list.append({
                    'name': model.model,
                    'size': model.size,
                    'modified': str(model.modified_at) if hasattr(model, 'modified_at') else ''
                })
        
        return {
            "status": "success",
            "models": model_list,
            "count": len(model_list)
        }
    except Exception as e:
        logger.error(f"Failed to list Ollama models: {e}")
        return {
            "status": "error",
            "models": [],
            "count": 0,
            "error": str(e)
        }


@app.post("/api/ocr/analyze", response_model=PDFAnalysis)
async def analyze_pdf(file: UploadFile = File(...)):
    """Analyze PDF to determine if OCR is needed."""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")
    
    temp_path = settings.temp_dir / f"analyze_{int(time.time())}_{file.filename}"
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        ocr = get_ocr_adapter()
        analysis = await ocr.analyze_pdf(temp_path)
        return analysis
        
    finally:
        if temp_path.exists():
            temp_path.unlink()


@app.post("/api/ocr/extract")
async def extract_only(
    file: UploadFile = File(...),
    quality: str = "base"
):
    """
    Extract markdown only (no LLM parsing).
    Used in Low VRAM mode for batch OCR.
    
    Args:
        quality: OCR quality preset ('tiny', 'small', 'base', 'large')
    """
    allowed_ext = ['.pdf', '.png', '.jpg', '.jpeg', '.webp']
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Only PDF and image files allowed")
    
    temp_path = settings.temp_dir / f"extract_{int(time.time())}_{file.filename}"
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        ocr = get_ocr_adapter()
        
        # Reload model if it was unloaded
        if not ocr.is_loaded():
            logger.info("Reloading DeepSeek-OCR-2 model...")
            ocr.load_model()
        
        markdown, metadata = await ocr.extract_markdown(temp_path, quality=quality)
        
        return {
            "status": "success",
            "filename": file.filename,
            "markdown": markdown,
            "metadata": metadata.dict()
        }
        
    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_path.exists():
            temp_path.unlink()


@app.post("/api/ocr/unload")
async def unload_ocr():
    """Unload DeepSeek-OCR-2 to free VRAM."""
    ocr = get_ocr_adapter()
    ocr.unload_model()
    return {"status": "success", "message": "DeepSeek-OCR-2 unloaded, VRAM freed"}


@app.post("/api/llm/parse")
async def parse_markdown_only(request: ParseRequest):
    """
    Parse markdown to JSON (no OCR).
    Used in Low VRAM mode after batch OCR.
    """
    try:
        parser = get_llm_parser()
        parsed_data = await parser.parse_markdown(
            request.markdown,
            model=request.llm_model,
            template=request.template,
            num_predict=request.context_window
        )
        
        return {
            "status": "success",
            "filename": request.filename,
            "parsed_data": parsed_data
        }
        
    except Exception as e:
        logger.error(f"LLM parsing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ocr/process", response_model=OCRResult)
async def process_file(
    file: UploadFile = File(...),
    llm_model: str = "gpt-oss:latest",
    template: str = "resume",
    context_window: int = 32768,
    quality: str = "base"
):
    """
    Process PDF or image with two-step pipeline:
    1. DeepSeek-OCR-2 (Eyes) - Extract markdown from file
    2. LLM/Ollama (Brain) - Parse markdown into JSON using selected template
    
    Args:
        quality: OCR quality preset ('tiny', 'small', 'base', 'large')
    
    Args:
        file: PDF or image file to process
        llm_model: Ollama model to use for parsing (e.g., "gpt-oss:latest")
        template: Document template to use (e.g., "resume", "receipt")
        context_window: Max tokens for LLM output (default 8192)
    """
    allowed_ext = ['.pdf', '.png', '.jpg', '.jpeg', '.webp']
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Only PDF and image files allowed: {', '.join(allowed_ext)}")
    
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    
    if file_size > settings.max_file_size:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {settings.max_file_size / 1024 / 1024}MB"
        )
    
    temp_path = settings.temp_dir / f"process_{int(time.time())}_{file.filename}"
    
    try:
        logger.info(f"Processing file: {file.filename} with template: {template}, LLM: {llm_model}")
        
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Step 1: Eyes - Extract markdown with DeepSeek-OCR-2
        ocr = get_ocr_adapter()
        markdown, metadata = await ocr.extract_markdown(temp_path, quality=quality)
        
        logger.info(f"Step 1 complete: Extracted {len(markdown)} chars of markdown")
        
        # Step 2: Brain - Parse markdown with LLM using selected template
        parser = get_llm_parser()
        parsed_data = await parser.parse_markdown(
            markdown, 
            model=llm_model, 
            template=template,
            num_predict=context_window
        )
        
        logger.info(f"Step 2 complete: Parsed into JSON with {len(parsed_data)} keys")
        
        # Build result
        warnings = []
        if not parsed_data.get("personal_info"):
            warnings.append("No personal info extracted")
        if not parsed_data.get("experience"):
            warnings.append("No experience extracted")
        if not parsed_data.get("education"):
            warnings.append("No education extracted")
        
        result = OCRResult(
            status="success",
            raw_output=markdown,
            parsed_data=parsed_data,
            metadata=metadata,
            warnings=warnings
        )
        
        logger.info(f"Processing completed: {file.filename}")
        return result
        
    except Exception as e:
        logger.error(f"Processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
    
    finally:
        if temp_path.exists():
            temp_path.unlink()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
