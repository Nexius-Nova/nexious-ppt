#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent
if str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))

from svg_finalize.align_embed_images import align_and_embed_images_in_svg, count_office_vector_refs_in_svg
from svg_finalize.embed_icons import process_svg_file as embed_icons_in_file
from svg_finalize.flatten_tspan import flatten_text_with_tspans
from svg_finalize.svg_rect_to_path import process_svg as convert_rounded_rects


def safe_print(message: str) -> None:
    try:
        print(message)
    except UnicodeEncodeError:
        print(message.encode("utf-8", errors="replace").decode("utf-8", errors="replace"))


def flatten_text(svg_file: Path) -> bool:
    from xml.etree import ElementTree as ET

    tree = ET.parse(str(svg_file))
    changed = flatten_text_with_tspans(tree)
    if changed:
        tree.write(str(svg_file), encoding="unicode", xml_declaration=False)
    return changed


def fix_rounded_rects(svg_file: Path) -> int:
    content = svg_file.read_text(encoding="utf-8")
    processed, count = convert_rounded_rects(content, verbose=False)
    if count:
        svg_file.write_text(processed, encoding="utf-8")
    return count


def finalize_project(project_dir: Path, *, dry_run: bool = False, quiet: bool = False) -> bool:
    svg_output = project_dir / "svg_output"
    svg_final = project_dir / "svg_final"
    icons_dir = VENDOR_DIR / "ppt_assets" / "icons"

    if not svg_output.exists():
        safe_print(f"[ERROR] svg_output not found: {svg_output}")
        return False

    svg_files = sorted(svg_output.glob("*.svg"))
    if not svg_files:
        safe_print("[ERROR] no SVG files found in svg_output")
        return False

    if dry_run:
        safe_print(f"[PREVIEW] {len(svg_files)} SVG file(s) would be finalized")
        return True

    if svg_final.exists():
        shutil.rmtree(svg_final)
    shutil.copytree(svg_output, svg_final)

    stats = {
        "icons": 0,
        "images": 0,
        "image_errors": 0,
        "office_vectors": 0,
        "flattened": 0,
        "rounded": 0,
    }

    for svg_file in sorted(svg_final.glob("*.svg")):
        stats["icons"] += embed_icons_in_file(svg_file, icons_dir, dry_run=False, verbose=False)
        stats["office_vectors"] += count_office_vector_refs_in_svg(svg_file)
        image_count, image_errors = align_and_embed_images_in_svg(
            svg_file,
            dry_run=False,
            verbose=False,
            compress=False,
            max_dimension=None,
        )
        stats["images"] += image_count
        stats["image_errors"] += image_errors
        if flatten_text(svg_file):
            stats["flattened"] += 1
        stats["rounded"] += fix_rounded_rects(svg_file)

    if not quiet:
        safe_print(
            "[DONE] finalized SVGs: "
            f"icons={stats['icons']}, images={stats['images']}, "
            f"image_errors={stats['image_errors']}, office_vectors={stats['office_vectors']}, "
            f"flattened={stats['flattened']}, rounded_rects={stats['rounded']}"
        )
    return stats["image_errors"] == 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Finalize generated SVG files for Nexious PPT")
    parser.add_argument("project_dir")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    return 0 if finalize_project(Path(args.project_dir), dry_run=args.dry_run, quiet=args.quiet) else 1


if __name__ == "__main__":
    raise SystemExit(main())
