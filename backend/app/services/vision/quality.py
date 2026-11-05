from typing import Optional, Tuple
import numpy as np
from PIL import Image


def compute_sharpness_quality(img: Image.Image) -> float:
    """
    Computes a normalized 0..1 visual quality score based on Laplacian edge variance
    and dynamic range (exposure). Blurry or pitch-dark corridor photos score low.
    """
    gray = np.asarray(img.convert("L").resize((320, 320)), dtype=np.float32)
    # Discrete 2D Laplacian: 4*center - up - down - left - right
    lap = (
        4.0 * gray[1:-1, 1:-1]
        - gray[:-2, 1:-1]
        - gray[2:, 1:-1]
        - gray[1:-1, :-2]
        - gray[1:-1, 2:]
    )
    variance = float(np.var(lap))
    contrast = float(np.std(gray))

    # Map variance (typical sharp indoor photo ~150..1200, blurry < 35) to 0..1
    sharp_score = min(1.0, variance / 280.0)
    exposure_score = min(1.0, contrast / 38.0)
    quality = round(float(0.75 * sharp_score + 0.25 * exposure_score), 3)
    return max(0.02, min(1.0, quality))


def validate_dataset_photo(
    img: Image.Image,
    vec: np.ndarray,
    existing_vecs: list[np.ndarray],
    min_quality: float = 0.14,
    dup_threshold: float = 0.988,
) -> Tuple[bool, float, Optional[str]]:
    w, h = img.size
    if min(w, h) < 160:
        return False, 0.0, f"Resolution too low ({w}x{h}px; minimum 160px)"

    quality = compute_sharpness_quality(img)
    if quality < min_quality:
        return False, quality, f"Image too blurry or dark (quality {quality:.2f} < {min_quality:.2f})"

    for ex in existing_vecs:
        if ex.shape == vec.shape:
            sim = float(np.dot(vec, ex))
            if sim >= dup_threshold:
                return False, quality, f"Near-duplicate of an existing node photo ({sim * 100:.1f}% identical)"

    return True, quality, None
