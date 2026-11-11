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

            self._engine = RapidOCR(det_limit_side_len=1360, det_db_box_thresh=0.35, det_db_thresh=0.22)
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

    @staticmethod
    def _clean_plaque_token(text: str) -> str:
        cleaned = re.sub(r"\s+", " ", text).strip()
        # Normalize common OCR confusions on 3-digit room number plaques (e.g. "3O8" -> "308", "01:" -> "011")
        if len(cleaned) == 3 and sum(ch.isdigit() for ch in cleaned) >= 2:
            trans = str.maketrans({
                "O": "0", "o": "0", "Q": "0", "D": "0",
                "I": "1", "l": "1", "|": "1", ":": "1", "!": "1",
                "Z": "2", "S": "5", "s": "5", "B": "8",
            })
            cand = cleaned.translate(trans)
            if cand.isdigit():
                return cand
        return cleaned

    def extract_boxes(self, img: Image.Image) -> Tuple[List[str], List[dict]]:
        self._ensure_loaded()
        if self._engine is None:
            return [], []
        try:
            from PIL import ImageEnhance, ImageOps

            rgb = img.convert("RGB")
            if max(rgb.size) > 1360:
                scale = 1360 / float(max(rgb.size))
                rgb = rgb.resize((int(rgb.width * scale), int(rgb.height * scale)), Image.Resampling.BILINEAR)
            w_px, h_px = max(1, rgb.width), max(1, rgb.height)
            arr = np.asarray(rgb)[:, :, ::-1]  # RGB -> BGR for RapidOCR
            result, _ = self._engine(arr)
            tokens: list[str] = []
            boxes: list[dict] = []
            seen_lower: set[str] = set()

            for item in (result or []):
                poly = item[0]
                raw_text = str(item[1]).strip()
                conf = float(item[2])
                cleaned = self._clean_plaque_token(raw_text)
                is_room_num = bool(re.match(r"^[a-zA-Z]?-?\d{3,4}$", cleaned))
                min_conf = 0.36 if is_room_num else 0.45
                if conf >= min_conf and len(cleaned) >= 2:
                    if cleaned.lower() not in seen_lower:
                        tokens.append(cleaned)
                        seen_lower.add(cleaned.lower())
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

            # Secondary Door-Lintel High-Res Pass:
            # Room plaques on corridor doors sit in the upper 42% of vertical mobile captures.
            has_room_digits = any(re.search(r"\b\d{3,4}\b", t) for t in tokens)
            if not has_room_digits:
                crop_h = max(32, int(h_px * 0.42))
                crop = rgb.crop((0, 0, w_px, crop_h))
                crop = ImageOps.autocontrast(crop, cutoff=1)
                crop = ImageEnhance.Sharpness(crop).enhance(2.0)
                up_w, up_h = int(crop.width * 1.7), int(crop.height * 1.7)
                crop_up = crop.resize((up_w, up_h), Image.Resampling.BICUBIC)
                res_top, _ = self._engine(np.asarray(crop_up)[:, :, ::-1])
                for item in (res_top or []):
                    poly = item[0]
                    cleaned = self._clean_plaque_token(str(item[1]).strip())
                    conf = float(item[2])
                    if conf >= 0.35 and len(cleaned) >= 2 and cleaned.lower() not in seen_lower:
                        # Prioritize room numbers at the front of tokens
                        if re.search(r"\b\d{3,4}\b", cleaned):
                            tokens.insert(0, cleaned)
                        else:
                            tokens.append(cleaned)
                        seen_lower.add(cleaned.lower())
                        try:
                            xs = [float(pt[0]) / max(1, up_w) for pt in poly]
                            ys = [(float(pt[1]) / max(1, up_h)) * 0.42 for pt in poly]
                            x0, y0 = max(0.0, min(xs)), max(0.0, min(ys))
                            x1, y1 = min(1.0, max(xs)), min(0.42, max(ys))
                            boxes.insert(0, {
                                "x": round(x0, 4),
                                "y": round(y0, 4),
                                "w": round(max(0.02, x1 - x0), 4),
                                "h": round(max(0.02, y1 - y0), 4),
                                "text": cleaned,
                                "confidence": round(conf, 3),
                            })
                        except Exception:  # noqa: BLE001
                            pass

            return tokens[:12], boxes[:12]
        except Exception as exc:  # noqa: BLE001
            log.warning("OCR extraction error: %s", exc)
            return [], []

    def extract_text(self, img: Image.Image) -> List[str]:
        tokens, _ = self.extract_boxes(img)
        return tokens


ocr_service = OCRService()
