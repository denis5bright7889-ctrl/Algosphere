"""
Viral Content Generator — REELS FIRST.

Story → Instagram content, with the Reel as the primary output (image
carousel is the fallback for non-video items). Founder-diary voice, no
jargon, emotional pacing, hook in the first 2 seconds.

Output:
  {
    "format": "reel",
    "hook": "...",
    "caption": "<hook>\\n\\n<story>\\n\\n<lesson>\\n\\n<cta>\\n\\n<hashtags>",
    "reel_scenes": [ {"id","text","seconds"} , ... ],   # drives video.py
    "carousel": ["slide1", ... "slide7"],               # fallback
  }

LLM-first; deterministic fallback builds the same structure from the story so
a reel always renders even with no LLM key.
"""
from __future__ import annotations

import json

from loguru import logger

import llm
from story import FOUNDER_CONTEXT

_HASHTAGS = ('#buildinpublic #foundersjourney #startup #trading #fintech '
             '#kenya #solofounder #entrepreneur #tradingjourney #algotrading')

_SYSTEM = f"""{FOUNDER_CONTEXT}

You turn ONE founder story into an Instagram REEL (this is the priority — NOT
an image post). Reels win on reach; write for video.

RULES:
- Hook lands in the FIRST 2 SECONDS. Scene 1 must stop the scroll.
- 5-7 scenes, 15-40s total. Each scene = one short on-screen line (<=10 words)
  + a duration in seconds (2.0-4.0). Emotional pacing: tension -> turn -> lesson.
- Caption: hook line, then the story in simple human language, then the lesson,
  then ONE engagement question. No engineering jargon.
- Diary energy, first person, Kenya/solo-founder reality, money & pressure real.

Return ONLY JSON (keep it compact — no markdown, no trailing commas):
{{
  "hook": "the strongest one-liner",
  "reel_scenes": [{{"text":"<=10 words","seconds":2.5}}, ... 5-7 items],
  "caption": "full caption WITHOUT hashtags"
}}"""


def _user_prompt(story: dict) -> str:
    return (
        "STORY:\n"
        f"- hook angles: {story.get('hook_angles')}\n"
        f"- story: {story.get('story')}\n"
        f"- emotion: {story.get('emotion_type')}\n"
        f"- lesson: {story.get('lesson')}\n"
        f"- conflict: {story.get('key_conflict')}\n\n"
        "Write the reel now."
    )


def _split_sentences(text: str) -> list[str]:
    out, cur = [], ''
    for ch in str(text):
        cur += ch
        if ch in '.!?' and len(cur.strip()) > 3:
            out.append(cur.strip()); cur = ''
    if cur.strip():
        out.append(cur.strip())
    return out


def _fallback(story: dict) -> dict:
    hook = (story.get('hook_angles') or ['I almost gave up today.'])[0]
    sentences = _split_sentences(story.get('story') or '')[:4] or ['Building alone is hard.']
    lesson = story.get('lesson') or 'Keep going.'

    scenes = [{'text': hook[:60], 'seconds': 2.0}]
    for s in sentences:
        scenes.append({'text': s[:70], 'seconds': 3.0})
    scenes.append({'text': lesson[:70], 'seconds': 3.5})
    scenes.append({'text': 'Building AlgoSphere from Kenya.', 'seconds': 2.5})

    caption = (f"{hook}\n\n{story.get('story','')}\n\n"
               f"Lesson: {lesson}\n\n"
               f"Have you been here too? 👇")
    carousel = ([hook] + sentences + [f"Lesson: {lesson}", "What would you have done? 👇"])
    return {
        'format': 'reel', 'hook': hook, 'caption': caption,
        'reel_scenes': scenes, 'carousel': carousel[:7], '_source': 'fallback',
    }


def generate_reel(story: dict) -> dict:
    """Story → reel-first content. Always returns a renderable reel."""
    out = None
    if llm.available():
        out = llm.generate_json(_SYSTEM, _user_prompt(story), temperature=0.95)
    if out and out.get('reel_scenes') and out.get('caption'):
        scenes = [
            {'text': str(s.get('text', ''))[:80],
             'seconds': max(1.5, min(4.5, float(s.get('seconds', 3) or 3)))}
            for s in out['reel_scenes'][:7] if s.get('text')
        ]
        if scenes:
            hook = out.get('hook') or scenes[0]['text']
            # Carousel is derived from the reel (reels-first; carousel is the
            # fallback surface), so the LLM only has to return the reel + caption.
            carousel = [hook] + [s['text'] for s in scenes[1:6]] + ['What would you have done? 👇']
            return {
                'format': 'reel', 'hook': hook, 'caption': out['caption'],
                'reel_scenes': scenes, 'carousel': carousel[:7], '_source': 'llm',
            }
        logger.info("reels: LLM scenes empty — fallback")
    return _fallback(story)


def with_hashtags(caption: str) -> str:
    return caption.rstrip() + '\n\n' + _HASHTAGS
