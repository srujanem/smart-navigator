# Navigator — Universal Photo-Based Indoor Navigation Platform

**Zero-hardware indoor positioning & visual turn-by-turn routing for Hospitals, University Campuses, Civic Centers & Multi-Building Complexes.**

Instead of expensive BLE beacons, live camera scanners, or decorative QR stickers, visitors **upload or snap a single photo of where they are standing**. Navigator's AI vision pipeline pinpoints their exact indoor node and guides them step-by-step to any department, room, doctor, or public counter.

---

## Key Capabilities

1. **Photo-Only Localization ("Where am I?")**
   - **Meta DINOv2 ViT-S/14** (ONNX Runtime CPU) extracts 768-d structural visual fingerprints from uploaded photos and compares them against the venue's indexed photo dataset.
   - **RapidOCR (PP-OCRv4)** reads room plaques, department headers, and directional signboards (`"CARDIOLOGY"`, `"PHARMACY 24x7"`, `"C-201"`, `"309"`).
   - **Calibrated Score Fusion** combines visual similarity + signboard OCR into confident predictions or interactive Top-3 *"Are you standing here?"* visual choices, with full millisecond AI trace transparency.
   - **Built-in Privacy Gate**: Strips EXIF/GPS metadata and automatically detects & blurs faces via OpenCV before saving.

2. **Multi-Venue Spatial Engine & 3D Digital Twin**
   - Supports **Hospitals**, **Campuses**, **Civic/Office Plazas**, and **Malls** from a unified SQLite/SQLModel schema.
   - Interactive **3D Glass Digital Twin** (`@react-three/fiber` + Three.js) and **2D SVG Floor Plans** with animated multi-floor route ribbons.
   - Real **A\*** pathfinding with admissible 3D Euclidean + floor-transition heuristics, **Yen's k-shortest alternative paths**, **Wheelchair / Stretcher (lift-only)** routing, **1-tap Hospital Emergency** routing, and real-time **Admin Hazard / Lift Closure** rerouting.

3. **Live Doctor, Faculty & Officer Directory**
   - Search by person name, specialization, or natural-language symptom (*"heart doctor"* → Cardiology, *"bone fracture"* → Orthopaedics, *"nearest washroom"*).
   - Live duty status (`Available`, `Busy`, `On Leave`, `Moved` — automatically redirects routes when a doctor moves to Operation Theatre `OT-2`).

4. **Admin Operations & AI Dataset Studio (`/admin`)**
   - Upload node reference photos with automatic sharpness/blur & near-duplicate quality checks.
   - Floor-by-floor **Dataset Coverage Heatmap** (`good` / `low` / `none`).
   - One-click **AI Index Rebuild** with Leave-One-Out **Top-1 / Top-3 Accuracy** and **Confusing Spot Pair** diagnostics.
   - Real persistent analytics: route logs, crowd density, failed search queries, and recent photo localizations.

---

## Quick Start

### One-Command Launch (Windows PowerShell)
```powershell
.\start-demo.ps1
```
- **Frontend App:** http://localhost:5173
- **Backend API & Docs:** http://localhost:8000/docs
- **Demo Admin Login:** `admin@navigator.dev` / `admin123`

### Manual Start
```powershell
# Terminal 1 — Backend
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

### Run Automated End-to-End Tests
```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -v
```
