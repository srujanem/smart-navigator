from pathlib import Path
from typing import Tuple
import io
import urllib.request

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from ...config import DATA_DIR

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
_DETECTOR = None
_INIT_TRIED = False


def _get_face_detector():
    global _DETECTOR, _INIT_TRIED  # noqa: PLW0603
    if _INIT_TRIED:
        return _DETECTOR
    _INIT_TRIED = True
    try:
        import cv2  # type: ignore

        model_path = DATA_DIR / "models" / "yunet.onnx"
        if not model_path.exists():
            model_path.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(YUNET_URL, str(model_path))
        _DETECTOR = cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), 0.65, 0.3, 5000)
    except Exception:  # noqa: BLE001
        _DETECTOR = None
    return _DETECTOR


def has_face_blur() -> bool:
    return _get_face_detector() is not None


def preprocess_and_anonymize(raw_bytes: bytes, max_side: int = 1024) -> Tuple[Image.Image, bytes, int]:
    """
    1. Fix phone camera orientation via EXIF transpose.
    2. Strip all EXIF / GPS metadata by creating a clean RGB image.
    3. Resize to max_side while preserving aspect ratio.
    4. Detect & blur human faces using YuNet neural face detector for patient/visitor privacy.
    Returns (clean_pil_image, jpeg_bytes, faces_blurred_count).
    """
    src = Image.open(io.BytesIO(raw_bytes))
    src = ImageOps.exif_transpose(src).convert("RGB")

    w, h = src.size
    if max(w, h) > max_side:
        scale = max_side / float(max(w, h))
        src = src.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)

    clean = Image.new("RGB", src.size)
    clean.paste(src)

    faces_blurred = 0
    det = _get_face_detector()
    if det is not None:
        try:
            bgr = np.asarray(clean)[:, :, ::-1].copy()
            det.setInputSize((clean.width, clean.height))
            _, faces = det.detect(bgr)
            if faces is not None:
                for face in faces:
                    fx, fy, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                    pad = int(0.18 * max(fw, fh))
                    x0, y0 = max(0, fx - pad), max(0, fy - pad)
                    x1, y1 = min(clean.width, fx + fw + pad), min(clean.height, fy + fh + pad)
                    if x1 > x0 and y1 > y0:
                        patch = clean.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(radius=18))
                        clean.paste(patch, (x0, y0))
                        faces_blurred += 1
        except Exception:  # noqa: BLE001
            pass

    buf = io.BytesIO()
    clean.save(buf, format="JPEG", quality=88, optimize=True)
    return clean, buf.getvalue(), faces_blurred


def save_clean_image(raw_bytes: bytes, dest_path: Path, max_side: int = 1024) -> Tuple[Image.Image, int]:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    img, jpg_bytes, faces = preprocess_and_anonymize(raw_bytes, max_side=max_side)
    dest_path.write_bytes(jpg_bytes)
    return img, faces
