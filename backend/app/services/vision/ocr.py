"""Optical Character Recognition (OCR) for room plaques, department signs & directional boards."""
from __future__ import annotations

import logging
import re
from typing import List, Optional, Tuple
import numpy as np
from PIL import Image

from ...config import ENABLE_OCR

log = logging.getLogger(__name__)


class OCRService:
    def __init__(self) -> None:
        self._loaded = False
        self._engine = None
        self._name: Optional[str] = None

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not ENABLE_OCR:
            return
        try:
            from rapidocr_onnxruntime import RapidOCR  # type: ignore

            self._engine = RapidOCR()
            self._name = "rapidocr-ppocrv4"
            log.info("RapidOCR engine initialized.")
        except Exception as exc:  # noqa: BLE001
            log.warning("OCR unavailable (%s)", exc)
            self._engine = None
            self._name = None

    @property
    def name(self) -> Optional[str]:
        self._ensure_loaded()
        return self._name

    def extract_boxes(self, img: Image.Image) -> Tuple[List[str], List[dict]]:
        self._ensure_loaded()
        if self._engine is None:
            return [], []
        try:
            rgb = img.convert("RGB")
            if max(rgb.size) > 960:
                scale = 960 / float(max(rgb.size))
                rgb = rgb.resize((int(rgb.width * scale), int(rgb.height * scale)), Image.Resampling.BILINEAR)
            w_px, h_px = max(1, rgb.width), max(1, rgb.height)
            arr = np.asarray(rgb)[:, :, ::-1]  # RGB -> BGR for RapidOCR
            result, _ = self._engine(arr)
            if not result:
                return [], []
            tokens: list[str] = []
            boxes: list[dict] = []
            for item in result:
                # item: [polygon_4pts, text, confidence]
                poly = item[0]
                text = str(item[1]).strip()
                conf = float(item[2])
                if conf >= 0.45 and len(text) >= 2:
                    cleaned = re.sub(r"\s+", " ", text)
                    tokens.append(cleaned)
                    try:
                        xs = [float(pt[0]) for pt in poly]
                        ys = [float(pt[1]) for pt in poly]
                        x0 = max(0.0, min(xs) / w_px)
                        y0 = max(0.0, min(ys) / h_px)
                        x1 = min(1.0, max(xs) / w_px)
                        y1 = min(1.0, max(ys) / h_px)
                        boxes.append({
                            "x": round(x0, 4),
                            "y": round(y0, 4),
                            "w": round(max(0.02, x1 - x0), 4),
                            "h": round(max(0.02, y1 - y0), 4),
                            "text": cleaned,
                            "confidence": round(conf, 3),
                        })
                    except Exception:  # noqa: BLE001
                        pass
                if len(tokens) >= 12:
                    break
            return tokens, boxes
        except Exception as exc:  # noqa: BLE001
            log.warning("OCR extraction error: %s", exc)
            return [], []

    def extract_text(self, img: Image.Image) -> List[str]:
        tokens, _ = self.extract_boxes(img)
        return tokens


ocr_service = OCRService()
