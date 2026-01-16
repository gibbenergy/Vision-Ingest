"""Adapter for DeepSeek-OCR-2 integration."""
import asyncio
import time
from pathlib import Path
from typing import Optional
import torch
from loguru import logger
import fitz  # PyMuPDF
import cv2
import numpy as np

from config import settings, get_ocr_quality_settings
from models import OCRMetadata, PDFAnalysis
from preprocessor import preprocess_image_memory


class DeepSeekOCRAdapter:
    """Wrapper for DeepSeek-OCR-2 model (Eyes - extracts markdown)."""

    def __init__(self):
        """Initialize the OCR adapter."""
        self.model = None
        self.tokenizer = None
        self.device = settings.device if torch.cuda.is_available() else "cpu"
        logger.info(f"Initializing DeepSeek-OCR-2 on device: {self.device}")
        
    def load_model(self):
        """Load the DeepSeek-OCR-2 model using official method."""
        try:
            from transformers import AutoModel, AutoTokenizer

            local_model_path = Path(settings.model_path)
            if not local_model_path.exists():
                logger.error(f"Model not found at {local_model_path}")
                logger.error("Please run download_model.bat first!")
                return False

            model_source = str(local_model_path)
            logger.info(f"Loading DeepSeek-OCR-2 from: {model_source}")

            self.tokenizer = AutoTokenizer.from_pretrained(
                model_source,
                trust_remote_code=True
            )

            # Try loading with flash_attention_2 for better performance
            try:
                self.model = AutoModel.from_pretrained(
                    model_source,
                    _attn_implementation='flash_attention_2',
                    trust_remote_code=True,
                    use_safetensors=True,
                    local_files_only=True
                )
                logger.info("Loaded with Flash Attention 2")
            except Exception as fa_err:
                logger.warning(f"Flash Attention 2 not available: {fa_err}")
                logger.info("Falling back to standard attention")
                self.model = AutoModel.from_pretrained(
                    model_source,
                    trust_remote_code=True,
                    use_safetensors=True,
                    local_files_only=True
                )

            if self.device == "cuda":
                self.model = self.model.eval().cuda().to(torch.bfloat16)
            else:
                self.model = self.model.eval().to(torch.bfloat16)

            logger.info(f"DeepSeek-OCR-2 loaded successfully on {self.device}")
            return True

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return False
    
    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self.model is not None
    
    def _run_inference_sync(self, image_path: str, output_path: str, base_size: int = 1024) -> str:
        """Run model inference synchronously (called via asyncio.to_thread)."""
        import sys
        from io import StringIO

        # DeepSeek-OCR-2 prompt format with grounding for layout preservation
        ocr_prompt = "<image>\n<|grounding|>Convert the document to markdown."

        old_stdout = sys.stdout
        sys.stdout = captured_output = StringIO()

        try:
            self.model.infer(
                self.tokenizer,
                prompt=ocr_prompt,
                image_file=image_path,
                output_path=output_path,
                base_size=base_size,
                image_size=768,  # DeepSeek-OCR-2 optimal patch size
                crop_mode=settings.use_crop_mode,
                save_results=False
            )
        finally:
            sys.stdout = old_stdout

        raw_output = captured_output.getvalue()

        # Clean output
        lines = raw_output.split('\n')
        clean_lines = []
        for line in lines:
            if any(skip in line for skip in ['BASE:', 'PATCHES:', '===', 'image size:', 'tokens', 'compression']):
                continue
            if '<|ref|>' in line or '<|det|>' in line or '<|grounding|>' in line:
                continue
            clean_lines.append(line)

        result = '\n'.join(clean_lines).strip()
        # Sanitize for UTF-8 compatibility
        result = result.encode('utf-8', errors='replace').decode('utf-8')
        return result
    
    async def analyze_pdf(self, pdf_path: Path) -> PDFAnalysis:
        """Analyze PDF to determine if OCR is needed."""
        try:
            doc = fitz.open(pdf_path)
            page_count = len(doc)
            first_page = doc[0]
            text = first_page.get_text()
            text_length = len(text.strip())
            extractability_score = min(1.0, text_length / 1000)
            requires_ocr = extractability_score < 0.3
            pdf_type = "scanned" if requires_ocr else "text"
            estimated_time = page_count * (8000 if requires_ocr else 500)
            doc.close()
            
            return PDFAnalysis(
                pdf_type=pdf_type,
                requires_ocr=requires_ocr,
                page_count=page_count,
                estimated_time_ms=estimated_time,
                text_extractability_score=extractability_score
            )
        except Exception as e:
            logger.error(f"PDF analysis failed: {e}")
            raise
    
    async def extract_markdown(self, file_path: Path, quality: str = "base") -> tuple[str, OCRMetadata]:
        """
        Extract markdown from PDF or image using DeepSeek-OCR-2.
        This is the "Eyes" step - just OCR, no parsing.
        
        Args:
            file_path: Path to PDF or image file
            quality: OCR quality preset ('tiny', 'small', 'base', 'large')
        """
        start_time = time.time()
        quality_settings = get_ocr_quality_settings(quality)
        base_size = quality_settings["base_size"]
        matrix_scale = quality_settings["matrix_scale"]
        logger.info(f"Using OCR quality: {quality} (base_size={base_size}, matrix={matrix_scale}x)")
        
        if not self.is_loaded():
            raise RuntimeError("DeepSeek-OCR-2 model is not loaded")
        
        try:
            logger.info(f"Extracting markdown from: {file_path}")
            
            all_markdown = []
            output_path = str(settings.temp_dir)
            file_ext = file_path.suffix.lower()
            
            # Check if it's an image or PDF
            if file_ext in ['.png', '.jpg', '.jpeg', '.webp']:
                # Direct image processing
                logger.info("Processing image file directly")
                
                # Load and preprocess in memory
                img = cv2.imread(str(file_path))
                if img is not None:
                    logger.info("Applying preprocessing to image")
                    img = preprocess_image_memory(img)
                    temp_image_path = settings.temp_dir / f"temp_preprocessed_{file_path.stem}.png"
                    cv2.imwrite(str(temp_image_path), img)
                    image_paths = [(str(temp_image_path), True)]
                else:
                    # Fallback to original if imread fails
                    image_paths = [(str(file_path), False)]
                page_count = 1
            else:
                # PDF - convert to images with preprocessing
                doc = fitz.open(str(file_path))
                page_count = len(doc)
                logger.info(f"PDF has {page_count} pages")
                
                image_paths = []
                for page_num in range(page_count):
                    page = doc[page_num]
                    # Render at 2x for better quality
                    pix = page.get_pixmap(matrix=fitz.Matrix(matrix_scale, matrix_scale))
                    
                    # Convert pixmap to numpy array for preprocessing
                    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                    if pix.n == 4:  # RGBA
                        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
                    elif pix.n == 3:  # RGB
                        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                    
                    # Apply preprocessing
                    logger.info(f"Preprocessing page {page_num + 1}")
                    img = preprocess_image_memory(img)
                    
                    # Save preprocessed image
                    temp_image_path = settings.temp_dir / f"temp_ocr_page_{page_num}.png"
                    cv2.imwrite(str(temp_image_path), img)
                    image_paths.append((str(temp_image_path), True))
                doc.close()
            
            # Process each image (run in thread pool to not block event loop)
            for idx, (image_path, should_delete) in enumerate(image_paths):
                logger.info(f"Processing page {idx + 1}/{page_count}")
                
                # Run blocking GPU inference in thread pool
                page_markdown = await asyncio.to_thread(
                    self._run_inference_sync,
                    image_path,
                    output_path,
                    base_size
                )
                
                if page_markdown:
                    if page_count > 1:
                        all_markdown.append(f"--- Page {idx + 1} ---\n{page_markdown}")
                    else:
                        all_markdown.append(page_markdown)
                
                # Clean up temp image if needed
                if should_delete:
                    Path(image_path).unlink(missing_ok=True)
            
            markdown = '\n\n'.join(all_markdown)
            
            processing_time = int((time.time() - start_time) * 1000)
            
            metadata = OCRMetadata(
                method="deepseek-ocr-2",
                processing_time_ms=processing_time,
                page_count=page_count,
                gpu_used=self.device == "cuda",
                model_version="deepseek-ai/DeepSeek-OCR-2"
            )

            logger.info(f"DeepSeek-OCR-2 completed in {processing_time}ms, extracted {len(markdown)} chars")
            return markdown, metadata
            
        except Exception as e:
            logger.error(f"DeepSeek-OCR-2 failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise RuntimeError(f"OCR processing failed: {str(e)}")
    
    def unload_model(self):
        """Temporarily unload model to free VRAM."""
        if self.model is not None:
            del self.model
            del self.tokenizer
            self.model = None
            self.tokenizer = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("DeepSeek-OCR-2 unloaded, VRAM freed")
    
    def cleanup(self):
        """Cleanup model resources."""
        self.unload_model()


# Global instance
ocr_adapter: Optional[DeepSeekOCRAdapter] = None


def get_ocr_adapter() -> DeepSeekOCRAdapter:
    """Get the global OCR adapter instance."""
    global ocr_adapter
    if ocr_adapter is None:
        ocr_adapter = DeepSeekOCRAdapter()
    return ocr_adapter
