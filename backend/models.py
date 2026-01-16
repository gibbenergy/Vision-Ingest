"""Pydantic models for resume data."""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class OCRMetadata(BaseModel):
    """Metadata from OCR processing."""
    method: str
    processing_time_ms: int
    page_count: int
    gpu_used: bool
    model_version: Optional[str] = None


class OCRResult(BaseModel):
    """Result from OCR + LLM processing."""
    status: str
    raw_output: str  # Markdown from DeepSeek-OCR-2
    parsed_data: Dict[str, Any]  # JSON from LLM
    metadata: OCRMetadata
    warnings: List[str] = Field(default_factory=list)


class PDFAnalysis(BaseModel):
    """Analysis of PDF type."""
    pdf_type: str
    requires_ocr: bool
    page_count: int
    estimated_time_ms: int
    text_extractability_score: float


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    cuda_available: bool
    model_loaded: bool
