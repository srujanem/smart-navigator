"""
Convert existing venue images to crisp WebP (max 1600px, quality 90)
and update Photo, Floor (blueprint), and Venue (cover) paths in SQLite.
"""
from pathlib import Path
import sys
from PIL import Image, ImageOps
from sqlmodel import Session, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import MEDIA_DIR
from app.db import engine
from app.models import Floor, Photo, Venue


def convert_file_to_webp(src_path: Path, max_side: int = 1600, quality: int = 90) -> Path:
    dest_path = src_path.with_suffix(".webp")
    with Image.open(src_path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        if max(w, h) > max_side:
            scale = max_side / float(max(w, h))
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest_path, format="WEBP", quality=quality, method=5)
    return dest_path


def main() -> None:
    print(f"Scanning media files in {MEDIA_DIR}...")
    with Session(engine) as session:
        # 1. Venues cover_path
        venues = session.exec(select(Venue)).all()
        for v in venues:
            if v.cover_path and not v.cover_path.endswith(".webp"):
                src = MEDIA_DIR / v.cover_path
                if src.exists():
                    dst = convert_file_to_webp(src, max_side=1600)
                    v.cover_path = dst.relative_to(MEDIA_DIR).as_posix()
                    session.add(v)
                    print(f"  Converted venue cover: {v.slug} -> {v.cover_path}")

        # 2. Photos
        photos = session.exec(select(Photo)).all()
        converted_count = 0
        path_cache: dict[str, str] = {}
        for p in photos:
            if p.path and not p.path.endswith(".webp"):
                if p.path in path_cache:
                    p.path = path_cache[p.path]
                    session.add(p)
                    continue
                src = MEDIA_DIR / p.path
                if src.exists():
                    dst = convert_file_to_webp(src, max_side=1600)
                    new_rel = dst.relative_to(MEDIA_DIR).as_posix()
                    path_cache[p.path] = new_rel
                    p.path = new_rel
                    session.add(p)
                    converted_count += 1
                    if converted_count % 50 == 0:
                        print(f"  Converted {converted_count} photo records to WebP...")

        session.commit()
        print(f"SUCCESS: Converted {converted_count} distinct photos to WebP max 1600px.")


if __name__ == "__main__":
    main()
