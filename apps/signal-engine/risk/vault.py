"""
Python-side credential vault — must match apps/web/src/lib/vault.ts byte-for-byte.

Algorithm:    AES-256-GCM
Key:          base64-encoded 32 bytes in CREDENTIAL_ENCRYPTION_KEY env var
Wire format:  base64(iv[12]) + ':' + base64(authTag[16]) + ':' + base64(ciphertext)

The web app encrypts when a user submits broker credentials. The signal-engine
decrypts here at execution time. Same key, same format, both directions.
"""
from __future__ import annotations
import base64
import os
from typing import Optional

# `cryptography` is already pulled in transitively by supabase; if not, add it
# to requirements.txt
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover — environment without cryptography
    AESGCM = None   # type: ignore


class VaultError(RuntimeError):
    """Vault-level error. `code` is one of: no_key | malformed | auth_failed | unavailable."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def _load_key() -> bytes:
    raw = os.environ.get('CREDENTIAL_ENCRYPTION_KEY')
    if not raw:
        raise VaultError('CREDENTIAL_ENCRYPTION_KEY not configured', 'no_key')
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as e:
        raise VaultError(f'CREDENTIAL_ENCRYPTION_KEY is not valid base64: {e}', 'malformed') from e
    if len(key) != 32:
        raise VaultError(
            f'CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (got {len(key)})',
            'malformed',
        )
    return key


def is_vault_available() -> bool:
    if AESGCM is None:
        return False
    try:
        _load_key()
        return True
    except VaultError:
        return False


def decrypt(blob: str) -> str:
    """Decrypt a vault blob written by the web app."""
    if not blob:
        return ''
    if AESGCM is None:
        raise VaultError('cryptography package not installed', 'unavailable')

    parts = blob.split(':')
    if len(parts) != 3:
        raise VaultError('Malformed vault blob (expected iv:tag:ct)', 'malformed')

    iv_b64, tag_b64, ct_b64 = parts
    try:
        iv  = base64.b64decode(iv_b64,  validate=True)
        tag = base64.b64decode(tag_b64, validate=True)
        ct  = base64.b64decode(ct_b64,  validate=True)
    except Exception as e:
        raise VaultError(f'Vault blob has invalid base64: {e}', 'malformed') from e

    if len(iv) != 12 or len(tag) != 16:
        raise VaultError(
            f'Vault blob has wrong IV/tag length (iv={len(iv)}, tag={len(tag)})',
            'malformed',
        )

    key    = _load_key()
    aesgcm = AESGCM(key)
    # `cryptography` expects the auth tag appended to the ciphertext
    try:
        plaintext = aesgcm.decrypt(iv, ct + tag, associated_data=None)
    except Exception as e:
        raise VaultError(
            'Decryption failed — wrong key or tampered ciphertext',
            'auth_failed',
        ) from e
    return plaintext.decode('utf-8')


def encrypt(plaintext: str) -> str:
    """Encrypt — primarily for server-side bootstrapping / tests.
    Production credentials are typically encrypted by the web app's lib/vault.ts.
    """
    if not plaintext:
        return ''
    if AESGCM is None:
        raise VaultError('cryptography package not installed', 'unavailable')

    key    = _load_key()
    aesgcm = AESGCM(key)
    iv     = os.urandom(12)
    sealed = aesgcm.encrypt(iv, plaintext.encode('utf-8'), associated_data=None)
    # `cryptography` returns ciphertext+tag concatenated; split for wire format
    ct, tag = sealed[:-16], sealed[-16:]
    return ':'.join([
        base64.b64encode(iv).decode('ascii'),
        base64.b64encode(tag).decode('ascii'),
        base64.b64encode(ct).decode('ascii'),
    ])


def mask(secret: Optional[str]) -> str:
    """For logging — never log full secrets."""
    if not secret:
        return ''
    if len(secret) <= 8:
        return '••••'
    return f'••••{secret[-4:]}'
