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
    """Deterministic but VARIED — different events produce different reels even
    with no LLM. Rotation is keyed off the event identity so it's stable on
    retry but distinct across events (no two losses share the same hook)."""
    import hashlib
    et = event.get('event_type', 'note')
    emotion = _EMOTION_BY_TYPE.get(et, 'insight')
    rd = event.get('raw_data') or {}
    subject = (rd.get('summary') or rd.get('message') or rd.get('pair')
               or rd.get('title') or et.replace('_', ' '))
    pips = rd.get('pips')
    seed_src = str(event.get('dedup_key') or rd.get('sha') or subject)
    idx = int(hashlib.sha1(seed_src.encode()).hexdigest(), 16)

    # (hook variants, story-opener variants, lesson variants, conflict)
    banks = {
        'failure': (
            ["I watched it go wrong in real time.", "This one cost me.",
             "Nobody warns you how a loss feels at 2am.", f"{subject}. Ouch.",
             "I almost closed the laptop tonight."],
            [f"Today {subject} didn't go my way.",
             f"A losing trade ({subject}) hit while I was watching live.",
             f"{subject} went against the plan today."],
            ["Losses are tuition — pay attention, not just money.",
             "A red day is data, not a verdict.",
             "The market doesn't care how hard you worked. Adjust anyway."],
            "Wanting it to work vs. accepting what actually happened."),
        'struggle': (
            ["3am. It broke again.", "Solo-founder problems.", "No team to call. Just me.",
             f"{subject} broke and it was on me.", "Tired, but I fixed it anyway."],
            [f"{subject} broke today.",
             f"Something failed: {subject}. With no team, it's mine to fix.",
             f"{subject} went down before users noticed — barely."],
            ["Resilience isn't loud. It's showing up to fix it again.",
             "Reliability is a promise you keep when nobody's watching.",
             "Build boring safety nets before you need them."],
            "Exhaustion vs. the promise I made to people using this."),
        'win': (
            ["It actually worked.", "Small win. Huge for me.",
             "Months of doubt, one good moment.", f"{subject} — finally.",
             "Let myself breathe for a second today."],
            [f"{subject} worked today.",
             f"A win today ({subject}{f', +{pips} pips' if pips else ''}).",
             f"{subject} landed the way it was supposed to."],
            ["Momentum is small proofs that you're not crazy.",
             "Celebrate the process, not the payout.",
             "One win doesn't change the edge — but it refuels you."],
            "Quiet doubt vs. one piece of evidence it's real."),
        'insight': (
            ["I changed my mind today.", "A small thing I got wrong.",
             "Building teaches you fast.", f"Shipped: {subject}.",
             "Constraints made this obvious."],
            [f"Working on {subject} today taught me something.",
             f"Shipped {subject}. It clarified something I'd been avoiding.",
             f"{subject} forced a decision I'd been dodging."],
            ["Clarity comes from constraints, not comfort.",
             "Ship the lesson, not just the feature.",
             "You can't afford to be wrong for long when you're solo."],
            "What I assumed vs. what the work revealed."),
    }
    hooks, openers, lessons, conflict = banks[emotion]
    hook0 = hooks[idx % len(hooks)]
    opener = openers[idx % len(openers)]
    lesson = lessons[idx % len(lessons)]
    tail = {
        'failure': "Building AlgoSphere alone in Kenya, every setback feels personal — and expensive. I sat with it instead of hiding it.",
        'struggle': "No team, tight budget — every failure is mine to catch before users do. I was tired. I shipped the fix.",
        'win': "After months building solo with almost nothing, a small win hits different. Not celebrating yet — just grateful.",
        'insight': "Building a trading platform solo forces clarity. You learn in public or you don't learn fast enough.",
    }[emotion]
    body = f"{opener} {tail}"
    # rotate which 3 hooks we expose as angles
    angles = [hook0] + [h for h in hooks if h != hook0][:2]
    return {
        'hook_angles': angles,
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
