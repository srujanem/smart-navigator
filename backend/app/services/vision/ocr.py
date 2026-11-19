"""Optical Character Recognition (OCR) for room plaques, department signs & directional boards."""
from __future__ import annotations

import logging
import re
import threading
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
        self._lock = threading.Lock()

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._loaded = True
            if not ENABLE_OCR:
                return
            try:
                from rapidocr_onnxruntime import RapidOCR  # type: ignore

                self._engine = RapidOCR(det_limit_side_len=1024, det_db_box_thresh=0.35, det_db_thresh=0.22)
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
        # Normalize common OCR confusions on 2-to-4-digit room number plaques (e.g. "3O8" -> "308", "01:" -> "011", "1O2" -> "102")
        if 2 <= len(cleaned) <= 4 and sum(ch.isdigit() for ch in cleaned) >= max(1, len(cleaned) - 1):
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

            orig_rgb = img.convert("RGB")
            if max(orig_rgb.size) > 1800:
                scale_hi = 1800 / float(max(orig_rgb.size))
                orig_rgb = orig_rgb.resize(
                    (int(orig_rgb.width * scale_hi), int(orig_rgb.height * scale_hi)),
                    Image.Resampling.LANCZOS,
                )
            hi_w, hi_h = max(1, orig_rgb.width), max(1, orig_rgb.height)

            rgb = orig_rgb
            if max(rgb.size) > 1024:
                scale = 1024 / float(max(rgb.size))
                rgb = rgb.resize((int(rgb.width * scale), int(rgb.height * scale)), Image.Resampling.BILINEAR)
            w_px, h_px = max(1, rgb.width), max(1, rgb.height)
            arr = np.asarray(rgb)[:, :, ::-1]  # RGB -> BGR for RapidOCR
            with self._lock:
                result, _ = self._engine(arr)
            tokens: list[str] = []
            boxes: list[dict] = []
            seen_lower: set[str] = set()

            def _ingest_detections(
                raw_items,
                ox0: float = 0.0,
                oy0: float = 0.0,
                scale_x: float = 1.0,
                scale_y: float = 1.0,
                ref_w: int = 1,
                ref_h: int = 1,
                secondary: bool = False,
                min_conf_override: Optional[float] = None,
            ) -> None:
                for item in (raw_items or []):
                    poly = item[0]
                    raw_text = str(item[1]).strip()
                    conf = float(item[2])
                    cleaned = self._clean_plaque_token(raw_text)
                    is_room_num = bool(re.match(r"^[a-zA-Z]?-?\d{3,4}$", cleaned))
                    min_conf = min_conf_override if min_conf_override is not None else (0.36 if is_room_num else 0.45)
                    if conf < min_conf or len(cleaned) < 2:
                        continue
                    if cleaned.lower() not in seen_lower:
                        if secondary and re.search(r"\b\d{3,4}\b", cleaned):
                            tokens.insert(0, cleaned)
                        else:
                            tokens.append(cleaned)
                        seen_lower.add(cleaned.lower())
                        try:
                            xs = [ox0 + (float(pt[0]) / max(1, ref_w)) * scale_x for pt in poly]
                            ys = [oy0 + (float(pt[1]) / max(1, ref_h)) * scale_y for pt in poly]
                            x0, y0 = max(0.0, min(xs)), max(0.0, min(ys))
                            x1, y1 = min(1.0, max(xs)), min(1.0, max(ys))
                            box_dict = {
                                "x": round(x0, 4),
                                "y": round(y0, 4),
                                "w": round(max(0.02, x1 - x0), 4),
                                "h": round(max(0.02, y1 - y0), 4),
                                "text": cleaned,
                                "confidence": round(conf, 3),
                            }
                            if secondary and re.search(r"\b\d{3,4}\b", cleaned):
                                boxes.insert(0, box_dict)
                            else:
                                boxes.append(box_dict)
                        except Exception:  # noqa: BLE001
                            pass
                    if len(tokens) >= 12:
                        break

            _ingest_detections(result, 0.0, 0.0, 1.0, 1.0, w_px, h_px, secondary=False)

            def _has_room_digits() -> bool:
                return any(re.search(r"\b[a-zA-Z]?-?\d{3,4}\b", t) for t in tokens)

            def _run_upscaled_crop(
                rx0: float,
                ry0: float,
                rx1: float,
                ry1: float,
                zoom: float,
                cutoff: int = 1,
                min_conf_override: Optional[float] = None,
            ) -> None:
                cx0, cy0 = int(hi_w * rx0), int(hi_h * ry0)
                cx1, cy1 = max(cx0 + 32, min(hi_w, int(hi_w * rx1))), max(cy0 + 32, min(hi_h, int(hi_h * ry1)))
                sub = orig_rgb.crop((cx0, cy0, cx1, cy1))
                sub = ImageOps.autocontrast(sub, cutoff=cutoff)
                sub = ImageEnhance.Sharpness(sub).enhance(2.0)
                up_w, up_h = max(32, int(sub.width * zoom)), max(32, int(sub.height * zoom))
                sub_up = sub.resize((up_w, up_h), Image.Resampling.LANCZOS)
                with self._lock:
                    res_sub, _ = self._engine(np.asarray(sub_up)[:, :, ::-1])
                _ingest_detections(
                    res_sub,
                    ox0=cx0 / float(hi_w),
                    oy0=cy0 / float(hi_h),
                    scale_x=(cx1 - cx0) / float(hi_w),
                    scale_y=(cy1 - cy0) / float(hi_h),
                    ref_w=up_w,
                    ref_h=up_h,
                    secondary=True,
                    min_conf_override=min_conf_override,
                )

            # Pass 2A: Full-Res Door-Lintel Crop (upper 45%)
            if not _has_room_digits():
                _run_upscaled_crop(0.0, 0.0, 1.0, 0.45, zoom=1.35, cutoff=1)

            # Pass 2B: Full-Res Side-Wall Doorway Edge Crops for angled corridor door plaques
            if not _has_room_digits():
                _run_upscaled_crop(0.0, 0.10, 0.36, 0.62, zoom=1.6, cutoff=2, min_conf_override=0.45)
            if not _has_room_digits():
                _run_upscaled_crop(0.64, 0.10, 1.0, 0.62, zoom=1.6, cutoff=2, min_conf_override=0.45)

            return tokens[:12], boxes[:12]
        except Exception as exc:  # noqa: BLE001
            log.warning("OCR extraction error: %s", exc)
            return [], []

    def extract_text(self, img: Image.Image) -> List[str]:
        tokens, _ = self.extract_boxes(img)
        return tokens


ocr_service = OCRService()
