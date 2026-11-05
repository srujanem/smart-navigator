"""Optical Character Recognition (OCR) for room plaques, department signs & directional boards."""
from __future__ import annotations

import logging
import re
from typing import List, Optional
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

    def extract_text(self, img: Image.Image) -> List[str]:
        self._ensure_loaded()
        if self._engine is None:
            return []
        try:
            rgb = img.convert("RGB")
            if max(rgb.size) > 960:
                scale = 960 / float(max(rgb.size))
                rgb = rgb.resize((int(rgb.width * scale), int(rgb.height * scale)), Image.Resampling.BILINEAR)
            arr = np.asarray(rgb)[:, :, ::-1]  # RGB -> BGR for RapidOCR
            result, _ = self._engine(arr)
            if not result:
                return []
            tokens: list[str] = []
            for item in result:
                # item: [box, text, confidence]
                text = str(item[1]).strip()
                conf = float(item[2])
                if conf >= 0.45 and len(text) >= 2:
                    cleaned = re.sub(r"\s+", " ", text)
                    tokens.append(cleaned)
            return tokens[:12]
        except Exception as exc:  # noqa: BLE001
            log.warning("OCR extraction error: %s", exc)
            return []


ocr_service = OCRService()
