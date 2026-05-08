"""
SILKGENESIS - 2FA TOTP (RFC 6238)
Generation QR code + verification TOTP
Compatible Google Authenticator, Aegis, etc.
"""
import pyotp
import qrcode
import qrcode.image.svg
import base64
import io
import os
import secrets

def generate_totp_secret() -> str:
    """Genere un secret TOTP aleatoire (base32)"""
    return pyotp.random_base32()

def get_totp_uri(secret: str, username: str, issuer: str = "SilkGenesis") -> str:
    """Genere l'URI otpauth:// pour le QR code"""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name=issuer)

def generate_qr_code_base64(secret: str, username: str) -> str:
    """Genere un QR code en base64 PNG"""
    uri = get_totp_uri(secret, username)
    
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    
    return base64.b64encode(buffer.getvalue()).decode('utf-8')

def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """
    Checks un code TOTP
    window=1 accepte le code precedent et suivant (30s de tolerance)
    """
    if not secret or not code:
        return False
    try:
        totp = pyotp.TOTP(secret)
        return totp.verify(code.strip(), valid_window=window)
    except Exception:
        return False

def generate_backup_codes(count: int = 8) -> list:
    """Genere des codes de secours a usage unique"""
    return [secrets.token_hex(4).upper() for _ in range(count)]

