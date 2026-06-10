"""
Story Extraction Engine — turns a normalized growth_source_event into a
structured founder-diary STORY:

  { hook_angles[], story, emotion_type, lesson, key_conflict, relatability_score }

Voice: a real founder building AlgoSphere in Kenya with limited resources.
Emotion over engineering. Every story carries at least one of: pain, mistake,
surprise, lesson, financial implication. Technical terms are translated into
human stakes (money, pressure, uncertainty, sleep).

LLM-first (llm.generate_json); if the model/key is unavailable it falls back
to a deterministic template so the pipeline never stalls.
"""
from __future__ import annotations

import json

from loguru import logger

import llm

FOUNDER_CONTEXT = (
    "You write as the founder of AlgoSphere, an AI trading platform being built "
    "solo in Kenya with limited money, no team, and a lot of pressure. The voice "
    "is a raw personal diary — honest, vulnerable, specific. NOT marketing. NOT "
    "corporate. A real human at 2am wondering if this will work."
)

_SYSTEM = f"""{FOUNDER_CONTEXT}

You receive ONE raw technical event from the trading system or codebase.
Turn it into an emotionally engaging founder story for Instagram.

HARD RULES:
- NO engineering jargon unless you translate it into human stakes (money, fear,
  pressure, time, doubt). "latency spike" -> "the system froze while real money
  was on the line". "RLS policy" -> "a hole that could have leaked user data".
- The story MUST contain at least ONE of: pain, mistake, surprise, lesson,
  financial implication.
- Sound like a diary, not an ad. First person. Short sentences.
- Ground it in the founder reality: Kenya, limited resources, building alone.

Return ONLY JSON with this exact shape:
{{
  "hook_angles": ["3-5 scroll-stopping one-liners, each <=12 words"],
  "story": "4-7 short sentences, first person, emotional, concrete",
  "emotion_type": "failure | win | insight | struggle",
  "lesson": "one human takeaway, no jargon",
  "key_conflict": "the tension in one sentence",
  "relatability_score": 0-100
}}"""


def _user_prompt(event: dict) -> str:
    return (
        "EVENT:\n"
        f"- source: {event.get('source')}\n"
        f"- type: {event.get('event_type')}\n"
        f"- severity: {event.get('severity')}\n"
        f"- data: {json.dumps(event.get('raw_data') or {}, default=str)[:1200]}\n\n"
        "Write the founder story now."
    )


# ── Deterministic fallback (no LLM) ──────────────────────────────────────────
_EMOTION_BY_TYPE = {
    'signal_loss': 'failure', 'error': 'struggle', 'cron_fail': 'struggle',
    'broker_issue': 'struggle', 'latency': 'struggle', 'signal_win': 'win',
    'commit': 'insight', 'note': 'insight',
}


def _fallback(event: dict) -> dict:
    et = event.get('event_type', 'note')
    emotion = _EMOTION_BY_TYPE.get(et, 'insight')
    rd = event.get('raw_data') or {}
    subject = (rd.get('summary') or rd.get('message') or rd.get('pair')
               or rd.get('title') or et.replace('_', ' '))
    templates = {
        'failure': (
            [f"I watched it go wrong in real time.", "This one stung.",
             "Nobody tells you how loss feels at 2am."],
            f"Today {subject} didn't go my way. Building AlgoSphere alone in Kenya, "
            f"every setback feels personal — and expensive. I sat with it instead of "
            f"hiding it. The market doesn't care how hard you worked.",
            "Losses are tuition. Pay attention, not just money.",
            "Wanting it to work vs. accepting what actually happened."),
        'struggle': (
            [f"3am. Something broke again.", "Solo founder problems.",
             "No team to call. Just me."],
            f"{subject} broke today. With no team and a tight budget, every failure "
            f"is mine to fix before users notice. I was tired. I fixed it anyway. "
            f"That's the part nobody posts about.",
            "Resilience isn't loud. It's showing up to fix it again.",
            "Exhaustion vs. the promise I made to the people using this."),
        'win': (
            [f"It actually worked.", "Small win. Huge for me.",
             "Months of doubt, one good moment."],
            f"{subject} worked today. After months of building AlgoSphere alone with "
            f"almost nothing, a small win hits different. I'm not celebrating yet — "
            f"but I let myself breathe for a second.",
            "Momentum is built from small proofs that you're not crazy.",
            "Quiet doubt vs. one piece of evidence it's real."),
        'insight': (
            [f"I changed my mind today.", "A small thing I got wrong.",
             "Building teaches you fast."],
            f"Working on {subject} today taught me something. Building a trading "
            f"platform solo in Kenya forces clarity — you can't afford to be wrong "
            f"for long. I shipped the lesson.",
            "Clarity comes from constraints, not comfort.",
            "What I assumed vs. what the work revealed."),
    }
    hooks, body, lesson, conflict = templates[emotion]
    return {
        'hook_angles': hooks,
        'story': body,
        'emotion_type': emotion,
        'lesson': lesson,
        'key_conflict': conflict,
        'relatability_score': 55,
        '_source': 'fallback',
    }


def extract_story(event: dict) -> dict:
    """Event → founder story. LLM first, deterministic fallback always works."""
    if llm.available():
        out = llm.generate_json(_SYSTEM, _user_prompt(event), temperature=0.85)
        if out and out.get('story') and out.get('hook_angles'):
            out.setdefault('emotion_type', 'insight')
            out.setdefault('relatability_score', 60)
            out['_source'] = 'llm'
            return out
        logger.info("story: LLM unavailable/invalid — using fallback")
    return _fallback(event)
