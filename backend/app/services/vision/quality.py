import re
from typing import Any, Optional, Tuple
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


def check_navigation_applicability(
    img: Image.Image,
    face_area_ratio: float = 0.0,
    ocr_tokens: Optional[list[str]] = None,
) -> Tuple[bool, float, Optional[str]]:
    """
    Filters out photos that are not applicable to indoor spatial navigation:
    - Very low resolution
    - Pitch-dark / pocket / lens-covered images
    - Overexposed blank white glare images
    - Close-up portraits / selfies
    - Severely blurry frames
    - Blank single-color walls / floor / featureless surfaces
    """
    w, h = img.size
    if min(w, h) < 180:
        return False, 0.0, f"Resolution too low ({w}x{h}px; minimum 180px)"

    gray = np.asarray(img.convert("L").resize((320, 320)), dtype=np.float32)
    mean_luma = float(np.mean(gray))
    std_luma = float(np.std(gray))

    gx = np.abs(gray[:, 1:] - gray[:, :-1])
    gy = np.abs(gray[1:, :] - gray[:-1, :])
    grad = np.hypot(gx[:-1, :], gy[:, :-1])
    edge_ratio = float(np.mean(grad > 14.0))
    active_quads = sum(
        1
        for r in (0, 160)
        for c in (0, 160)
        if float(np.std(gray[r : r + 160, c : c + 160])) >= 12.0
    )

    quality = compute_sharpness_quality(img)
    ocr_blob = " ".join(ocr_tokens or [])
    has_room_ocr = bool(re.search(r"\b[a-zA-Z]?-?\d{3,4}\b", ocr_blob))

    if mean_luma < 24.0:
        return False, quality, "Image too dark for indoor navigation"
    if mean_luma > 244.0 and std_luma < 16.0:
        return False, quality, "Overexposed / blank white image not applicable to navigation"
    if face_area_ratio >= 0.16 and not has_room_ocr:
        return False, quality, "Close-up portrait / selfie detected — not applicable to indoor navigation"

    min_q = 0.14 if has_room_ocr else 0.20
    if quality < min_q:
        return False, quality, f"Image too blurry for indoor navigation (quality {quality:.2f} < {min_q:.2f})"

    if not has_room_ocr and (edge_ratio < 0.015 or (active_quads <= 1 and std_luma < 22.0)):
        return False, quality, "Blank wall, floor, or featureless surface — not applicable to indoor navigation"

    return True, quality, None


def validate_dataset_photo(
    img: Image.Image,
    vec: np.ndarray,
    existing_vecs: list[np.ndarray],
    min_quality: float = 0.14,
    dup_threshold: float = 0.988,
    face_area_ratio: float = 0.0,
    ocr_tokens: Optional[list[str]] = None,
) -> Tuple[bool, float, Optional[str]]:
    ok, quality, reason = check_navigation_applicability(
        img,
        face_area_ratio=face_area_ratio,
        ocr_tokens=ocr_tokens,
    )
    if not ok:
        return False, quality, reason

    if quality < min_quality:
        return False, quality, f"Image too blurry or dark (quality {quality:.2f} < {min_quality:.2f})"

    for ex in existing_vecs:
        if ex.shape == vec.shape:
            sim = float(np.dot(vec, ex))
            if sim >= dup_threshold:
                return False, quality, f"Near-duplicate of an existing node photo ({sim * 100:.1f}% identical)"

    return True, quality, None


def rank_photos_for_node(node: Any, node_photos: list[Any]) -> list[Any]:
    """
    Sort photos belonging to `node` so OCR-verified doorway/signboard photos
    always take priority over sharper unverified hallway/conflicting shots.
    """
    if not node_photos:
        return []
    node_name = (getattr(node, "name", "") or "").lower()
    node_nums = set(re.findall(r"\b[a-z]?-?\d{2,4}\b", node_name))

    def _sort_key(p: Any) -> tuple[int, int, float]:
        ocr_raw = (getattr(p, "ocr_text", "") or "").strip()
        ocr_nums = set(re.findall(r"\b[a-z]?-?\d{2,4}\b", ocr_raw.lower()))
        # Also match normalized 3-digit room number if 4-digit token ends with emblem artifact '1'
        ocr_nums_norm = set(ocr_nums)
        for tok in ocr_nums:
            if len(tok) == 4 and tok.isdigit():
                ocr_nums_norm.add(tok[:3])

        if node_nums and (node_nums & ocr_nums_norm):
            tier = 3
        elif not node_nums and bool(ocr_raw):
            tier = 2
        elif not ocr_nums_norm or not (ocr_nums_norm - node_nums):
            tier = 1
        else:
            tier = 0

        is_curated = 1 if getattr(p, "source", "") in ("admin", "uploader", "seed") else 0
        q = float(getattr(p, "quality", 0.0) or 0.0)
        return (tier, is_curated, q)

    return sorted(node_photos, key=_sort_key, reverse=True)


def pick_best_display_photo(node: Any, node_photos: list[Any]) -> Optional[Any]:
    ranked = rank_photos_for_node(node, node_photos)
    return ranked[0] if ranked else None
