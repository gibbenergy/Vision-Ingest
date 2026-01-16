"""Light image preprocessing for OCR quality improvement."""
import cv2
import numpy as np
from pathlib import Path
from loguru import logger


def detect_skew_angle(image: np.ndarray) -> float:
    """Detect skew angle of document using Hough transform."""
    try:
        # Convert to grayscale for edge detection only
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image
        
        # Edge detection
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        
        # Detect lines
        lines = cv2.HoughLinesP(
            edges, 1, np.pi/180, 
            threshold=100, 
            minLineLength=100, 
            maxLineGap=10
        )
        
        if lines is None or len(lines) == 0:
            return 0.0
        
        # Calculate angles
        angles = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            if x2 - x1 != 0:
                angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
                # Only consider near-horizontal lines (text lines)
                if abs(angle) < 45:
                    angles.append(angle)
        
        if not angles:
            return 0.0
        
        # Return median angle (robust to outliers)
        return float(np.median(angles))
        
    except Exception as e:
        logger.warning(f"Skew detection failed: {e}")
        return 0.0


def rotate_image(image: np.ndarray, angle: float) -> np.ndarray:
    """Rotate image by given angle."""
    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    
    # Get rotation matrix
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    
    # Calculate new bounding box size
    cos = np.abs(M[0, 0])
    sin = np.abs(M[0, 1])
    new_w = int((h * sin) + (w * cos))
    new_h = int((h * cos) + (w * sin))
    
    # Adjust rotation matrix
    M[0, 2] += (new_w / 2) - center[0]
    M[1, 2] += (new_h / 2) - center[1]
    
    # Rotate with white background
    rotated = cv2.warpAffine(
        image, M, (new_w, new_h),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255) if len(image.shape) == 3 else 255
    )
    
    return rotated


def is_low_contrast(image: np.ndarray, threshold: float = 0.2) -> bool:
    """Check if image has low contrast."""
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    
    # Calculate contrast ratio
    min_val, max_val = gray.min(), gray.max()
    contrast = (max_val - min_val) / 255.0
    
    return contrast < threshold


def preprocess_image(image_path: Path, output_path: Path = None) -> Path:
    """
    Light preprocessing for OCR - preserves color, minimal processing.
    
    Steps:
    1. Deskew if rotation > 1 degree
    2. Upscale if resolution too low
    3. Light contrast boost if needed
    
    Does NOT do:
    - Grayscale conversion (model uses color)
    - Binarization (harmful to vision model)
    - Heavy denoising (blurs text)
    """
    logger.info(f"Preprocessing: {image_path.name}")
    
    # Read image (keep color)
    img = cv2.imread(str(image_path))
    if img is None:
        logger.warning(f"Failed to read image: {image_path}")
        return image_path
    
    original_shape = img.shape
    modified = False
    
    # 1. Deskew if needed (rotation > 1 degree)
    angle = detect_skew_angle(img)
    if abs(angle) > 1.0:
        logger.info(f"  Deskewing by {angle:.1f} degrees")
        img = rotate_image(img, angle)
        modified = True
    
    # 2. Upscale if too small (DeepSeek uses 1024 base size)
    h, w = img.shape[:2]
    min_dimension = 1024
    if max(h, w) < min_dimension:
        scale = min_dimension / max(h, w)
        new_w = int(w * scale)
        new_h = int(h * scale)
        logger.info(f"  Upscaling from {w}x{h} to {new_w}x{new_h}")
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
        modified = True
    
    # 3. Light contrast boost if needed
    if is_low_contrast(img):
        logger.info("  Applying light contrast enhancement")
        # Very mild contrast boost - alpha=1.1 (10% boost), beta=5 (brightness)
        img = cv2.convertScaleAbs(img, alpha=1.1, beta=5)
        modified = True
    
    # Save if modified, otherwise return original
    if modified:
        if output_path is None:
            output_path = image_path.with_suffix('.preprocessed.png')
        cv2.imwrite(str(output_path), img)
        logger.info(f"  Saved preprocessed image: {output_path.name} ({img.shape[1]}x{img.shape[0]})")
        return output_path
    else:
        logger.info("  No preprocessing needed")
        return image_path


def preprocess_image_memory(img: np.ndarray) -> np.ndarray:
    """
    In-memory preprocessing for when we already have numpy array.
    Returns preprocessed image without file I/O.
    """
    original_shape = img.shape
    
    # 1. Deskew if needed
    angle = detect_skew_angle(img)
    if abs(angle) > 1.0:
        img = rotate_image(img, angle)
    
    # 2. Upscale if too small
    h, w = img.shape[:2]
    min_dimension = 1024
    if max(h, w) < min_dimension:
        scale = min_dimension / max(h, w)
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    
    # 3. Light contrast boost if needed
    if is_low_contrast(img):
        img = cv2.convertScaleAbs(img, alpha=1.1, beta=5)
    
    return img
