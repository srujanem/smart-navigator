"""Optional GPU Visual Place Recognition (MegaLoc / DINOv2-SALAD + LightGlue)
and Zero-GPU Gemini 2.5 Flash Vision Signboard Verification.

Activates automatically ONLY when explicitly enabled via environment variables:
  - NAV_GPU_VPR=1 (on NVIDIA T4/L4/RTX GPU with torch + kornia/lightglue installed)
  - GEMINI_API_KEY=... (zero-GPU server cost: calls Gemini Flash Vision API on low-confidence photos)
Falls back gracefully to the existing lightweight CPU ONNX pipeline otherwise.
"""
from __future__ import annotations

import base64
import json
import logging
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..config import ENABLE_GPU_VPR, GEMINI_API_KEY, GEMINI_VISION_MODEL, GPU_VPR_MODEL

logger = logging.getLogger("navigator.gpu_vpr")

_gpu_model: Any = None
_gpu_device: str = "cpu"
_gpu_ready: bool | None = None


def is_gpu_vpr_available() -> bool:
    """Returns True if NAV_GPU_VPR=1 and PyTorch CUDA is available."""
    global _gpu_ready, _gpu_device
    if not ENABLE_GPU_VPR:
        return False
    if _gpu_ready is not None:
        return _gpu_ready
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            _gpu_device = "cuda"
            _gpu_ready = True
            return True
    except Exception:
        pass
    _gpu_ready = False
    return False


def embed_with_megaloc_gpu(image_path: str | Path) -> np.ndarray | None:
    """Computes an L2-normalized MegaLoc / DINOv2-SALAD embedding on GPU (~35 ms on T4)."""
    global _gpu_model
    if not is_gpu_vpr_available():
        return None
    try:
        import torch  # type: ignore
        from torchvision import transforms  # type: ignore

        if _gpu_model is None:
            logger.info("Loading GPU VPR model %s on %s...", GPU_VPR_MODEL, _gpu_device)
            _gpu_model = torch.hub.load(GPU_VPR_MODEL, "get_trained_model")
            _gpu_model.eval().to(_gpu_device)

        tf = transforms.Compose(
            [
                transforms.Resize((322, 322)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )
        img = Image.open(image_path).convert("RGB")
        tensor = tf(img).unsqueeze(0).to(_gpu_device)
        with torch.no_grad():
            feat = _gpu_model(tensor).squeeze(0).float().cpu().numpy()
        norm = float(np.linalg.norm(feat))
        return feat / norm if norm > 1e-6 else feat
    except Exception as exc:
        logger.warning("GPU VPR inference fallback (%s): %s", GPU_VPR_MODEL, exc)
        return None


def verify_location_with_gemini_vision(
    image_bytes: bytes,
    candidate_rooms: list[dict[str, Any]],
    mime_type: str = "image/jpeg",
) -> dict[str, Any] | None:
    """Optional zero-GPU signboard & landmark verifier using Gemini 2.5 Flash Vision API.

    Only executes when GEMINI_API_KEY is configured in environment variables.
    Returns {node_id, confidence, reason, signboard_text} or None.
    """
    if not GEMINI_API_KEY or not candidate_rooms:
        return None

    room_lines = "\n".join(
        f"- id={r['node_id']} | name={r['name']} | floor={r.get('floor_name', r.get('level', 0))}"
        for r in candidate_rooms[:20]
    )
    prompt = (
        "You are an indoor campus localization assistant. Inspect this photo for room number plaques, "
        "department signs, corridors, stairs, lifts, or landmarks. Pick the SINGLE best matching room "
        "from the list below. Reply ONLY as strict JSON with keys: "
        '{"node_id": "...", "confidence": 0.0-1.0, "signboard_text": "...", "reason": "..."}.\n'
        f"Candidate rooms:\n{room_lines}"
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": base64.b64encode(image_bytes).decode("ascii"),
                        }
                    },
                ]
            }
        ],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
    }

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_VISION_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=6.0) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        text = body["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
        valid_ids = {r["node_id"] for r in candidate_rooms}
        if parsed.get("node_id") in valid_ids:
            return {
                "node_id": str(parsed["node_id"]),
                "confidence": float(min(0.99, max(0.0, parsed.get("confidence", 0.85)))),
                "signboard_text": str(parsed.get("signboard_text", "")),
                "reason": str(parsed.get("reason", "Gemini Vision Signboard Match")),
            }
    except Exception as exc:
        logger.debug("Gemini Vision verify skipped: %s", exc)
    return None
