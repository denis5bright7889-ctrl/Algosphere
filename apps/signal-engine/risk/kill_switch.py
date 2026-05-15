"""
AlgoSphere Quant — Kill Switch
File-based emergency lock. Once triggered, requires manual operator reset.
The flag file is the authoritative signal — if it exists, NO trade may execute.
"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from loguru import logger


class KillSwitch:
    """
    File-backed kill switch. Survives process restart, crash, VPS reboot.
    Authoritative: presence of HALTED.flag → all trading blocked.
    """

    def __init__(self, flag_path: Path):
        self.path = Path(flag_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def is_active(self) -> bool:
        return self.path.exists()

    def trigger(self, reason: str) -> None:
        """Fire the kill switch. Idempotent — safe to call multiple times."""
        try:
            payload = {
                'triggered_at': datetime.now(timezone.utc).isoformat(),
                'reason':       reason,
            }
            # Preserve original trigger if already active
            existing = self.reason()
            if existing and 'triggered_at' in existing:
                payload['triggered_at'] = existing['triggered_at']
                payload['original_reason'] = existing.get('reason', '')
                payload['retrigger_reason'] = reason
            self.path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
            logger.critical(f"KILL SWITCH ACTIVE: {reason}")
        except Exception as e:
            # Even if file write fails, log catastrophically loud
            logger.critical(f"KILL SWITCH FILE WRITE FAILED: {e} | reason was: {reason}")

    def reset(self, operator: str) -> bool:
        """Manual operator unlock. Returns True on success."""
        try:
            if self.path.exists():
                # Archive the flag rather than silently delete
                archive = self.path.with_suffix(f'.flag.cleared.{int(datetime.now().timestamp())}')
                self.path.rename(archive)
                logger.warning(f"KILL SWITCH RESET by operator={operator} — archived to {archive.name}")
            else:
                logger.info(f"Kill switch reset requested by {operator} but flag was not active")
            return True
        except Exception as e:
            logger.error(f"Failed to reset kill switch: {e}")
            return False

    def reason(self) -> Optional[dict]:
        """Return the kill-switch payload (reason + timestamp) or None."""
        if not self.path.exists():
            return None
        try:
            return json.loads(self.path.read_text(encoding='utf-8'))
        except Exception:
            return {'reason': 'unknown — corrupt flag file', 'triggered_at': None}
