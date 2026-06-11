"""
LLM client for the Founder Media Engine — provider-abstracted text/JSON
generation. Defaults to Google AI Studio (Gemini) via AI_STUDIO_API_KEY
because that key already exists in the stack; swap providers by changing
GROWTH_LLM_PROVIDER + the _call_* function. Never raises — callers get
None and fall back to deterministic templates, so the pipeline keeps
running even with no key / a provider outage.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

from loguru import logger

PROVIDER = lambda: os.environ.get('GROWTH_LLM_PROVIDER', 'gemini').lower()
MODEL    = lambda: os.environ.get('GROWTH_LLM_MODEL', 'gemini-2.0-flash')
_KEY     = lambda: (os.environ.get('AI_STUDIO_API_KEY')
                    or os.environ.get('GEMINI_API_KEY')
                    or os.environ.get('GOOGLE_AI_API_KEY'))


def available() -> bool:
    return bool(_KEY())


def _call_gemini(system: str, user: str, *, temperature: float, json_mode: bool) -> str | None:
    key = _KEY()
    if not key:
        return None
    url = (f'https://generativelanguage.googleapis.com/v1beta/models/'
           f'{MODEL()}:generateContent?key={key}')
    body = {
        'systemInstruction': {'parts': [{'text': system}]},
        'contents': [{'role': 'user', 'parts': [{'text': user}]}],
        'generationConfig': {
            'temperature': temperature,
            'maxOutputTokens': 4096,
            **({'responseMimeType': 'application/json'} if json_mode else {}),
        },
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            data = json.loads(r.read().decode())
        return data['candidates'][0]['content']['parts'][0]['text']
    except Exception as e:
        logger.warning(f"llm: gemini call failed — {e}")
        return None


def generate_text(system: str, user: str, *, temperature: float = 0.9) -> str | None:
    if PROVIDER() == 'gemini':
        return _call_gemini(system, user, temperature=temperature, json_mode=False)
    logger.warning(f"llm: unknown provider {PROVIDER()!r}")
    return None


def generate_json(system: str, user: str, *, temperature: float = 0.8) -> dict | None:
    """Return parsed JSON or None. Tolerates code-fenced / chatty output."""
    raw = (_call_gemini(system, user, temperature=temperature, json_mode=True)
           if PROVIDER() == 'gemini' else None)
    if not raw:
        return None
    raw = raw.strip()
    # strip ```json fences if the model added them
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if m:
        raw = m.group(0)
    try:
        return json.loads(raw)
    except Exception:
        pass
    # Lenient repair: strip trailing commas before } or ] (the most common
    # malformation), then retry.
    repaired = re.sub(r',(\s*[}\]])', r'\1', raw)
    try:
        return json.loads(repaired)
    except Exception as e:
        logger.warning(f"llm: JSON parse failed — {e}")
        return None
