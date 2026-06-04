from __future__ import annotations

import argparse
import json
import sys
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
VENDOR_DIR = ROOT_DIR / "server" / "vendor"
if str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))

from svg_to_pptx.pptx_builder import create_pptx_with_native_svg


def _load_notes(notes_json: Path | None) -> dict[str, str]:
    if not notes_json or not notes_json.exists():
        return {}
    data = json.loads(notes_json.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _canvas_format(value: str | None, width: int, height: int) -> str | None:
    if value in {"ppt169", "ppt43"}:
        return value
    if width == 960 and height == 720:
        return "ppt43"
    if width == 1280 and height == 720:
        return "ppt169"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Nexious native SVG to editable PPTX exporter")
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--format", default=None)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--notes-json", default=None)
    parser.add_argument("--trace-json", default=None)
    parser.add_argument("--merge-paragraphs", action="store_true", default=False)
    args = parser.parse_args()

    project_path = Path(args.project)
    output_path = Path(args.output)
    svg_dir = project_path / "svg_output"
    svg_files = sorted(svg_dir.glob("*.svg"))
    if not svg_files:
        print(json.dumps({"ok": False, "error": "No SVG files found"}, ensure_ascii=False))
        return 2

    notes = _load_notes(Path(args.notes_json) if args.notes_json else None)
    trace_path = Path(args.trace_json) if args.trace_json else None
    output_path.parent.mkdir(parents=True, exist_ok=True)

    stdout_buffer = StringIO()
    stderr_buffer = StringIO()
    try:
        with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
            ok = create_pptx_with_native_svg(
                svg_files=svg_files,
                output_path=output_path,
                canvas_format=_canvas_format(args.format, args.width, args.height),
                verbose=False,
                transition=None,
                transition_duration=0,
                auto_advance=None,
                use_compat_mode=False,
                notes=notes,
                enable_notes=True,
                use_native_shapes=True,
                animation=None,
                animation_duration=0,
                animation_stagger=0,
                animation_trigger="after-previous",
                animation_config=None,
                animation_cli_overrides={
                    "transition": True,
                    "transition_duration": True,
                    "auto_advance": True,
                    "animation": True,
                    "animation_duration": True,
                    "animation_stagger": True,
                    "animation_trigger": True,
                },
                narration_audio=None,
                use_narration_timings=False,
                narration_padding=0,
                cache_dir=None,
                workers=1,
                merge_paragraphs=args.merge_paragraphs,
                conversion_trace_path=trace_path,
            )
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": str(exc),
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue(),
        }, ensure_ascii=False))
        return 1

    print(json.dumps({
        "ok": bool(ok and output_path.exists()),
        "output": str(output_path),
        "trace": str(trace_path) if trace_path else None,
        "stdout": stdout_buffer.getvalue(),
        "stderr": stderr_buffer.getvalue(),
    }, ensure_ascii=False))
    return 0 if ok and output_path.exists() else 1


if __name__ == "__main__":
    raise SystemExit(main())
