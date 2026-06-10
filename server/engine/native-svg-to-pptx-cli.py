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
from svg_to_pptx.animation_config import load_animation_config


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
    animation_choices = [
        "none", "appear", "fade", "fly", "cut", "zoom", "wipe", "split",
        "blinds", "checkerboard", "dissolve", "random_bars", "peek",
        "wheel", "box", "circle", "diamond", "plus", "strips", "wedge",
        "stretch", "expand", "swivel", "auto", "mixed", "random",
    ]
    transition_choices = ["none", "fade", "push", "wipe", "split", "strips", "cover", "auto", "random"]

    parser = argparse.ArgumentParser(description="Nexious native SVG to editable PPTX exporter")
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--format", default=None)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--notes-json", default=None)
    parser.add_argument("--trace-json", default=None)
    parser.add_argument("--animation-config", default=None)
    parser.add_argument("--merge-paragraphs", action="store_true", default=False)
    parser.add_argument("--animation-effect", choices=animation_choices, default="none")
    parser.add_argument("--animation-duration", type=float, default=0.45)
    parser.add_argument("--animation-stagger", type=float, default=0.18)
    parser.add_argument("--transition-effect", choices=transition_choices, default="none")
    parser.add_argument("--transition-duration", type=float, default=0.45)
    parser.add_argument(
        "--animation-trigger",
        choices=["after-previous", "with-previous", "on-click"],
        default="after-previous",
    )
    args = parser.parse_args()

    project_path = Path(args.project)
    output_path = Path(args.output)
    svg_dir = project_path / "svg_final"
    if not svg_dir.exists():
        svg_dir = project_path / "svg_output"
    svg_files = sorted(svg_dir.glob("*.svg"))
    if not svg_files:
        print(json.dumps({"ok": False, "error": "No SVG files found"}, ensure_ascii=False))
        return 2

    notes = _load_notes(Path(args.notes_json) if args.notes_json else None)
    trace_path = Path(args.trace_json) if args.trace_json else None
    animation_config = load_animation_config(project_path, args.animation_config)
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
                transition=None if args.transition_effect in {"none", "auto"} else args.transition_effect,
                transition_duration=max(0.1, args.transition_duration),
                auto_advance=None,
                use_compat_mode=False,
                notes=notes,
                enable_notes=True,
                use_native_shapes=True,
                animation=None if args.animation_effect == "none" else args.animation_effect,
                animation_duration=max(0.1, args.animation_duration),
                animation_stagger=max(0, args.animation_stagger),
                animation_trigger=args.animation_trigger,
                animation_config=animation_config,
                animation_cli_overrides={
                    "transition": args.transition_effect != "auto",
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
