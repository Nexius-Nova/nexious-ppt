"""Minimal PowerPoint animation XML helpers for Nexious native PPTX export.

The SVG generation pipeline stays static and editable. These helpers only add
PPT timing XML during export, using the shape ids emitted by svg_to_pptx.
"""

from __future__ import annotations

from html import escape


ANIMATIONS_AVAILABLE = True

ANIMATIONS = {
    "fade": {"name": "Fade"},
    "wipe": {"name": "Wipe"},
    "fly": {"name": "Fly In"},
    "zoom": {"name": "Zoom"},
}

MAX_ANIMATION_TARGETS_PER_SLIDE = 10

TRANSITIONS = {
    "fade": {"name": "Fade"},
    "push": {"name": "Push"},
    "wipe": {"name": "Wipe"},
}


def pick_animation_effect(mode: str, seq_idx: int, mixed_animation_offset: int = 0, group_id: str | None = None) -> str:
    """Pick a presentation-friendly entrance effect for semantic groups."""
    normalized = (mode or "fade").lower()
    if normalized in ANIMATIONS:
        return normalized
    if normalized not in {"auto", "mixed", "random"}:
        return "fade"

    group = (group_id or "").lower()
    if any(token in group for token in ("title", "headline", "cover", "hero")):
        return "fade"
    if any(token in group for token in ("chart", "graph", "matrix", "table", "timeline")):
        return "wipe"
    if any(token in group for token in ("image", "photo", "visual", "illustration")):
        return "zoom"
    if any(token in group for token in ("bullet", "content", "list", "point")):
        return "wipe"

    pool = ("fade", "wipe", "fade", "zoom")
    return pool[(seq_idx + mixed_animation_offset) % len(pool)]


def create_transition_xml(effect: str = "fade", duration: float = 0.4, advance_after: float | None = None) -> str:
    """Create a simple slide transition XML fragment."""
    normalized = (effect or "fade").lower()
    dur = int(max(0, duration) * 1000)
    advance = ""
    if advance_after is not None and advance_after > 0:
        advance = f' advTm="{int(advance_after * 1000)}"'

    if normalized == "push":
        body = '<p:push dir="l"/>'
    elif normalized == "wipe":
        body = '<p:wipe dir="l"/>'
    else:
        body = "<p:fade/>"
    return f'<p:transition xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" dur="{dur}"{advance}>{body}</p:transition>'


def create_sequence_timing_xml(
    seq_targets: list[tuple[int, int, str, float]],
    duration: float = 0.45,
    trigger: str = "after-previous",
) -> str:
    """Create timing XML that reveals each target shape in sequence."""
    if not seq_targets:
        return ""

    seq_targets = seq_targets[:MAX_ANIMATION_TARGETS_PER_SLIDE]
    child_nodes: list[str] = []
    for idx, (shape_id, delay_ms, effect, item_duration) in enumerate(seq_targets, 1):
        start_condition = _start_condition(trigger, delay_ms, idx)
        child_nodes.append(_effect_node(shape_id, idx, effect, item_duration or duration, start_condition))

    children = "\n".join(child_nodes)
    return f"""<p:timing>
  <p:tnLst>
    <p:par>
      <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
        <p:childTnLst>
          <p:seq concurrent="1" nextAc="seek">
            <p:cTn id="2" dur="indefinite" nodeType="mainSeq">
              <p:childTnLst>
{children}
              </p:childTnLst>
            </p:cTn>
          </p:seq>
        </p:childTnLst>
      </p:cTn>
    </p:par>
  </p:tnLst>
</p:timing>"""


def _start_condition(trigger: str, delay_ms: int, idx: int) -> str:
    delay = max(0, int(delay_ms))
    normalized = (trigger or "after-previous").lower()
    if normalized == "on-click":
        return '<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>'
    if normalized == "with-previous":
        return f'<p:stCondLst><p:cond delay="{delay if idx > 1 else 0}"/></p:stCondLst>'
    return f'<p:stCondLst><p:cond delay="{0 if idx == 1 else delay}"/></p:stCondLst>'


def _effect_node(shape_id: int, idx: int, effect: str, duration: float, start_condition: str) -> str:
    dur = int(max(0.2, min(duration, 0.6)) * 1000)
    preset_id, preset_class = _preset(effect)
    node_id = 100 + idx
    return f"""                <p:par>
                  <p:cTn id="{node_id}" presetID="{preset_id}" presetClass="{preset_class}" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">
                    {start_condition}
                    <p:childTnLst>
                      {_motion_or_alpha(shape_id, node_id + 2000, effect, dur)}
                    </p:childTnLst>
                  </p:cTn>
                </p:par>"""


def _preset(effect: str) -> tuple[int, str]:
    normalized = (effect or "fade").lower()
    if normalized == "wipe":
        return 22, "entr"
    if normalized == "zoom":
        return 17, "entr"
    if normalized == "fly":
        return 2, "entr"
    return 10, "entr"


def _motion_or_alpha(shape_id: int, node_id: int, effect: str, dur: int) -> str:
    normalized = escape((effect or "fade").lower(), quote=True)
    return f"""<p:animEffect transition="in" filter="{_filter(normalized)}">
                        <p:cBhvr>
                          <p:cTn id="{node_id}" dur="{dur}" fill="hold"/>
                          <p:tgtEl><p:spTgt spid="{int(shape_id)}"/></p:tgtEl>
                        </p:cBhvr>
                      </p:animEffect>"""


def _filter(effect: str) -> str:
    if effect == "wipe":
        return "wipe(right)"
    if effect == "zoom":
        return "zoom(in)"
    if effect == "fly":
        return "fly(fromL)"
    return "fade"
