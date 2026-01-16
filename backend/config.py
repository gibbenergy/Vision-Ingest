"""Configuration for resume parser application."""
from pydantic_settings import BaseSettings
from pathlib import Path

# Base directory for backend
BASE_DIR = Path(__file__).resolve().parent

# Templates directory for document schemas and prompts
TEMPLATES_DIR = BASE_DIR / "templates"

# Legacy prompts directory (deprecated, use TEMPLATES_DIR)
PROMPTS_DIR = BASE_DIR / "prompts"


class Settings(BaseSettings):
    """Application settings."""
    
    # App
    app_name: str = "VisionIngest"
    version: str = "0.2.0"
    debug: bool = True
    cuda_version: str = "12.8"
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    
    # DeepSeek-OCR-2
    model_name: str = "deepseek-ai/DeepSeek-OCR-2"
    model_path: str = "../models/deepseek-ocr-2"
    device: str = "cuda"
    base_size: int = 1024
    use_crop_mode: bool = False  # Disabled: crop_mode can break multi-column layouts
    
    # File handling
    temp_dir: Path = Path("backend/temp")
    upload_dir: Path = Path("backend/uploads")
    max_file_size: int = 10 * 1024 * 1024
    allowed_extensions: list[str] = [".pdf", ".png", ".jpg", ".jpeg", ".webp"]
    
    # Processing
    max_pages: int = 10
    processing_timeout: int = 60
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

# Ensure directories exist
settings.temp_dir.mkdir(parents=True, exist_ok=True)
settings.upload_dir.mkdir(parents=True, exist_ok=True)
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)


# OCR Quality Presets (based on DeepSeek-OCR-2 native resolutions)
OCR_QUALITY_PRESETS = {
    "tiny": {
        "base_size": 512,
        "matrix_scale": 1.5,
        "tokens": 64,
        "description": "Fastest, low detail",
        "est_time": "~8s/page"
    },
    "small": {
        "base_size": 640,
        "matrix_scale": 2.0,
        "tokens": 100,
        "description": "Quick processing",
        "est_time": "~12s/page"
    },
    "base": {
        "base_size": 1024,
        "matrix_scale": 2.0,
        "tokens": 256,
        "description": "Balanced quality/speed",
        "est_time": "~25s/page"
    },
    "large": {
        "base_size": 1280,
        "matrix_scale": 3.0,
        "tokens": 400,
        "description": "High detail, slower",
        "est_time": "~40s/page"
    }
}


def get_ocr_quality_settings(quality: str) -> dict:
    """Get OCR settings for a quality preset."""
    return OCR_QUALITY_PRESETS.get(quality, OCR_QUALITY_PRESETS["base"])


# Template category mapping
TEMPLATE_CATEGORIES = {
    # Business Documents
    "resume": ("Business", "Resume/CV"),
    "receipt": ("Business", "Receipt"),
    "invoice": ("Business", "Invoice"),
    "purchase_order": ("Business", "Purchase Order"),
    "business_card": ("Business", "Business Card"),
    "contract": ("Business", "Contract"),
    
    # Identity & Official
    "id_card": ("Identity", "ID Card / Driver's License"),
    "passport": ("Identity", "Passport"),
    "visa": ("Identity", "Visa"),
    
    # Financial
    "bank_statement": ("Financial", "Bank Statement"),
    "tax_form": ("Financial", "Tax Form (W-2/1099)"),
    "pay_stub": ("Financial", "Pay Stub"),
    
    # Medical
    "medical_bill": ("Medical", "Medical Bill"),
    "prescription": ("Medical", "Prescription"),
    "lab_results": ("Medical", "Lab Results"),
    
    # Education
    "transcript": ("Education", "Academic Transcript"),
    "diploma": ("Education", "Diploma/Certificate"),
    "report_card": ("Education", "Report Card"),
    
    # Shipping & Logistics
    "shipping_label": ("Shipping", "Shipping Label"),
    "bill_of_lading": ("Shipping", "Bill of Lading"),
    "customs_declaration": ("Shipping", "Customs Declaration"),
    
    # Real Estate & Hospitality
    "lease_agreement": ("Real Estate", "Lease Agreement"),
    "menu": ("Hospitality", "Restaurant Menu"),
    "restaurant_bill": ("Hospitality", "Restaurant Bill"),
}


def list_templates() -> list[dict]:
    """List available document templates with categories."""
    templates = []
    if TEMPLATES_DIR.exists():
        for json_file in TEMPLATES_DIR.glob("*.json"):
            template_id = json_file.stem
            if template_id in TEMPLATE_CATEGORIES:
                category, display_name = TEMPLATE_CATEGORIES[template_id]
            else:
                category = "Other"
                display_name = template_id.replace("_", " ").title()
            templates.append({
                "id": template_id, 
                "name": display_name,
                "category": category
            })
    return sorted(templates, key=lambda x: (x["category"], x["name"]))


def list_templates_by_category() -> dict[str, list[dict]]:
    """List templates organized by category."""
    templates = list_templates()
    by_category = {}
    for t in templates:
        cat = t["category"]
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append({"id": t["id"], "name": t["name"]})
    return by_category
