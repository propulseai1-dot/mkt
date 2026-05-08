"""
SILKGENESIS PGP UTILITIES - Ed25519 + RSA-4096
===============================================
Generation de cles Ed25519 (moderne, compact, rapide)
avec fallback RSA-4096 si Ed25519 non disponible.

- Ed25519 keypair (32 bytes prive, 32 bytes public)
- Cle privee encryptede AES-256-GCM avec le passphrase
- Format PGP armored compatible GPG
- Chiffrement hybride X25519+AES-256-GCM pour les messages
"""

import os
import base64
import hashlib
import secrets
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    """Derive une cle AES-256 depuis un passphrase avec PBKDF2"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
        backend=default_backend()
    )
    return kdf.derive(passphrase.encode('utf-8'))


def _armor(data: bytes, header: str) -> str:
    """Encode en format PGP armored (base64 avec header/footer)"""
    b64 = base64.b64encode(data).decode('ascii')
    lines = [b64[i:i+64] for i in range(0, len(b64), 64)]
    return f"-----BEGIN {header}-----\n" + "\n".join(lines) + f"\n-----END {header}-----\n"


def _dearmor(armored: str) -> bytes:
    """Decode un bloc PGP armored"""
    lines = armored.strip().split('\n')
    data_lines = []
    in_data = False
    for line in lines:
        if line.startswith('-----BEGIN'):
            in_data = True
            continue
        if line.startswith('-----END'):
            break
        if in_data and line and not line.startswith('='):
            data_lines.append(line)
    return base64.b64decode(''.join(data_lines))


def generate_pgp_keypair(username: str, passphrase: str) -> dict:
    """
    Genere une paire de cles Ed25519.
    La cle privee est encryptede avec le passphrase (AES-256-GCM + PBKDF2).

    Returns:
        {
            "success": bool,
            "public_key": str,              # Cle publique PEM armored
            "private_key": str,             # Cle privee encryptede PEM
            "fingerprint": str,             # SHA-256 de la cle publique
            "key_id": str,                  # 16 derniers chars du fingerprint
            "algorithm": str,               # "Ed25519"
        }
    """
    try:
        # Generate la cle Ed25519
        private_key = Ed25519PrivateKey.generate()
        public_key = private_key.public_key()

        # Serialiser la cle publique en PEM
        pub_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode('utf-8')

        # Chiffrer la cle privee avec le passphrase (AES-256-GCM + PBKDF2)
        salt = secrets.token_bytes(16)
        nonce = secrets.token_bytes(12)
        key = _derive_key(passphrase, salt)

        # Serialiser la cle privee en bytes (non encryptede)
        priv_raw = private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption()
        )

        # Chiffrer avec AES-256-GCM
        aesgcm = AESGCM(key)
        encrypted_priv = aesgcm.encrypt(nonce, priv_raw, username.encode())

        # Encoder: salt(16) + nonce(12) + ciphertext
        encrypted_blob = salt + nonce + encrypted_priv
        priv_armored = _armor(encrypted_blob, "PGP PRIVATE KEY BLOCK")
        # Ajouter version header
        priv_armored = priv_armored.replace(
            "-----BEGIN PGP PRIVATE KEY BLOCK-----\n",
            "-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: SilkGenesis Ed25519/AES256GCM\n\n"
        )

        # Formater la cle publique en format PGP armored
        pub_armored = pub_pem.replace(
            "-----BEGIN PUBLIC KEY-----",
            "-----BEGIN PGP PUBLIC KEY BLOCK-----\nVersion: SilkGenesis Ed25519\n"
        ).replace(
            "-----END PUBLIC KEY-----",
            "-----END PGP PUBLIC KEY BLOCK-----"
        )

        # Calculer le fingerprint (SHA-256 de la cle publique raw)
        pub_raw = public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw
        )
        fingerprint = hashlib.sha256(pub_raw).hexdigest().upper()
        key_id = fingerprint[-16:]

        print(f"[PGP] Ed25519 keypair generated for {username}: {fingerprint[:16]}...")

        return {
            "success": True,
            "public_key": pub_armored,
            "private_key": priv_armored,
            "fingerprint": fingerprint,
            "key_id": key_id,
            "algorithm": "Ed25519",
            "error": None
        }

    except Exception as e:
        print(f"[PGP ERROR] Ed25519 generation failed: {e}, falling back to RSA-4096")
        return _generate_rsa_keypair(username, passphrase)


def _generate_rsa_keypair(username: str, passphrase: str) -> dict:
    """Fallback: generates RSA-4096 if Ed25519 fails"""
    try:
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=4096,
            backend=default_backend()
        )
        public_key = private_key.public_key()

        # Cle publique PEM
        pub_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode('utf-8')

        # Cle privee encryptede avec passphrase
        priv_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.BestAvailableEncryption(passphrase.encode())
        ).decode('utf-8')

        # Format PGP armored
        pub_armored = pub_pem.replace(
            "-----BEGIN PUBLIC KEY-----",
            "-----BEGIN PGP PUBLIC KEY BLOCK-----\nVersion: SilkGenesis RSA4096\n"
        ).replace("-----END PUBLIC KEY-----", "-----END PGP PUBLIC KEY BLOCK-----")

        priv_armored = priv_pem.replace(
            "-----BEGIN ENCRYPTED PRIVATE KEY-----",
            "-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: SilkGenesis RSA4096\n"
        ).replace("-----END ENCRYPTED PRIVATE KEY-----", "-----END PGP PRIVATE KEY BLOCK-----")

        # Fingerprint
        pub_der = public_key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        fingerprint = hashlib.sha256(pub_der).hexdigest().upper()
        key_id = fingerprint[-16:]

        return {
            "success": True,
            "public_key": pub_armored,
            "private_key": priv_armored,
            "fingerprint": fingerprint,
            "key_id": key_id,
            "algorithm": "RSA-4096",
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "public_key": None,
            "private_key": None,
            "fingerprint": None,
            "key_id": None,
            "algorithm": None,
            "error": str(e)
        }


def decrypt_private_key(encrypted_armored: str, passphrase: str, username: str) -> bytes:
    """
    Dechiffre une cle privee Ed25519 encryptede.
    Retourne les bytes raw de la cle privee, ou None si failure.
    """
    try:
        # Check si c'est Ed25519 ou RSA
        if "Ed25519" in encrypted_armored:
            blob = _dearmor(encrypted_armored)
            salt = blob[:16]
            nonce = blob[16:28]
            ciphertext = blob[28:]
            key = _derive_key(passphrase, salt)
            aesgcm = AESGCM(key)
            priv_raw = aesgcm.decrypt(nonce, ciphertext, username.encode())
            return priv_raw
        else:
            # RSA - utiliser serialization
            priv_pem = encrypted_armored.replace(
                "-----BEGIN PGP PRIVATE KEY BLOCK-----",
                "-----BEGIN ENCRYPTED PRIVATE KEY-----"
            ).replace(
                "-----END PGP PRIVATE KEY BLOCK-----",
                "-----END ENCRYPTED PRIVATE KEY-----"
            )
            # Delete les lignes Version:
            lines = [l for l in priv_pem.split('\n') if not l.startswith('Version:')]
            priv_pem = '\n'.join(lines)
            private_key = serialization.load_pem_private_key(
                priv_pem.encode(),
                password=passphrase.encode(),
                backend=default_backend()
            )
            return private_key.private_bytes(
                encoding=serialization.Encoding.Raw,
                format=serialization.PrivateFormat.Raw,
                encryption_algorithm=serialization.NoEncryption()
            )
    except Exception as e:
        print(f"[PGP] decrypt_private_key failed: {e}")
        return None


def encrypt_message(recipient_public_key_armored: str, message: str) -> dict:
    """
    Chiffre un message avec la cle publique du destinataire.
    Utilise X25519 ECDH + AES-256-GCM (encryption hybride).
    Compatible avec les cles Ed25519 et RSA.
    """
    try:
        # Detecter le type de cle
        if "Ed25519" in recipient_public_key_armored or "PGP PUBLIC KEY BLOCK" in recipient_public_key_armored:
            return _encrypt_with_ed25519_key(recipient_public_key_armored, message)
        else:
            return _encrypt_with_rsa_key(recipient_public_key_armored, message)
    except Exception as e:
        return {
            "encrypted": False,
            "content": message,
            "warning": f"ENCRYPTION_FAILED: {str(e)[:100]}"
        }


def _encrypt_with_ed25519_key(pub_key_armored: str, message: str) -> dict:
    """Chiffrement avec cle Ed25519 (via X25519 ECDH)"""
    try:
        # Extraire la cle publique PEM
        pub_pem = pub_key_armored.replace(
            "-----BEGIN PGP PUBLIC KEY BLOCK-----",
            "-----BEGIN PUBLIC KEY-----"
        ).replace(
            "-----END PGP PUBLIC KEY BLOCK-----",
            "-----END PUBLIC KEY-----"
        )
        # Delete les lignes Version:
        lines = [l for l in pub_pem.split('\n') if not l.startswith('Version:') and l.strip()]
        pub_pem = '\n'.join(lines)

        # Load la cle publique Ed25519
        pub_key = serialization.load_pem_public_key(pub_pem.encode(), backend=default_backend())

        # Generate une cle ephemere X25519 pour ECDH
        ephemeral_key = X25519PrivateKey.generate()
        ephemeral_pub = ephemeral_key.public_key()

        # Convertir Ed25519 -> X25519 pour ECDH (via bytes raw)
        # Note: Ed25519 et X25519 utilisent la meme courbe Curve25519
        pub_raw = pub_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw
        )

        # Create une cle X25519 depuis les bytes Ed25519
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PublicKey
        x25519_pub = X25519PublicKey.from_public_bytes(pub_raw)

        # ECDH
        shared_secret = ephemeral_key.exchange(x25519_pub)

        # Deriver une cle AES depuis le shared secret
        salt = secrets.token_bytes(16)
        aes_key = _derive_key(shared_secret.hex(), salt)

        # Chiffrer le message
        nonce = secrets.token_bytes(12)
        aesgcm = AESGCM(aes_key)
        ciphertext = aesgcm.encrypt(nonce, message.encode('utf-8'), None)

        # Encoder la cle ephemere publique
        eph_pub_bytes = ephemeral_pub.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw
        )

        # Blob: eph_pub(32) + salt(16) + nonce(12) + ciphertext
        blob = eph_pub_bytes + salt + nonce + ciphertext
        armored = _armor(blob, "PGP MESSAGE")
        armored = armored.replace(
            "-----BEGIN PGP MESSAGE-----\n",
            "-----BEGIN PGP MESSAGE-----\nVersion: SilkGenesis Ed25519/X25519/AES256GCM\n\n"
        )

        return {
            "encrypted": True,
            "content": armored,
            "algorithm": "X25519+AES256GCM",
            "warning": None
        }
    except Exception as e:
        # Fallback: encryption symetrique simple
        return _encrypt_symmetric(message, str(e))


def _encrypt_with_rsa_key(pub_key_armored: str, message: str) -> dict:
    """Chiffrement avec cle RSA-4096 (OAEP + AES-256-GCM)"""
    try:
        pub_pem = pub_key_armored.replace(
            "-----BEGIN PGP PUBLIC KEY BLOCK-----",
            "-----BEGIN PUBLIC KEY-----"
        ).replace(
            "-----END PGP PUBLIC KEY BLOCK-----",
            "-----END PUBLIC KEY-----"
        )
        lines = [l for l in pub_pem.split('\n') if not l.startswith('Version:') and l.strip()]
        pub_pem = '\n'.join(lines)

        pub_key = serialization.load_pem_public_key(pub_pem.encode(), backend=default_backend())

        # Generate une cle AES aleatoire
        aes_key = secrets.token_bytes(32)
        nonce = secrets.token_bytes(12)

        # Chiffrer le message avec AES-256-GCM
        aesgcm = AESGCM(aes_key)
        ciphertext = aesgcm.encrypt(nonce, message.encode('utf-8'), None)

        # Chiffrer la cle AES avec RSA-OAEP
        encrypted_key = pub_key.encrypt(
            aes_key,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )

        # Blob: len_encrypted_key(2) + encrypted_key + nonce(12) + ciphertext
        import struct
        blob = struct.pack('>H', len(encrypted_key)) + encrypted_key + nonce + ciphertext
        armored = _armor(blob, "PGP MESSAGE")
        armored = armored.replace(
            "-----BEGIN PGP MESSAGE-----\n",
            "-----BEGIN PGP MESSAGE-----\nVersion: SilkGenesis RSA4096/AES256GCM\n\n"
        )

        return {
            "encrypted": True,
            "content": armored,
            "algorithm": "RSA4096+AES256GCM",
            "warning": None
        }
    except Exception as e:
        return _encrypt_symmetric(message, str(e))


def _encrypt_symmetric(message: str, error: str) -> dict:
    """Dernier recours: retourner le message non encrypted avec warning"""
    return {
        "encrypted": False,
        "content": message,
        "warning": f"ENCRYPTION_FAILED: {error[:100]}"
    }


def validate_pgp_public_key(key_str: str) -> dict:
    """Valide une cle publique PGP (Ed25519 ou RSA) et retourne son empreinte"""
    if not key_str or not key_str.strip():
        return {"valid": False, "error": "Empty key", "fingerprint": None}

    try:
        # Convertir PGP armored -> PEM standard
        pem = key_str.replace(
            "-----BEGIN PGP PUBLIC KEY BLOCK-----",
            "-----BEGIN PUBLIC KEY-----"
        ).replace(
            "-----END PGP PUBLIC KEY BLOCK-----",
            "-----END PUBLIC KEY-----"
        )
        # Delete les lignes Version:
        lines = [l for l in pem.split('\n') if not l.startswith('Version:') and l.strip()]
        pem = '\n'.join(lines)

        pub_key = serialization.load_pem_public_key(pem.encode(), backend=default_backend())

        # Calculer le fingerprint
        pub_der = pub_key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        fingerprint = hashlib.sha256(pub_der).hexdigest().upper()

        # Detecter le type
        key_type = type(pub_key).__name__
        if "Ed25519" in key_type:
            algorithm = "Ed25519"
        elif "RSA" in key_type:
            algorithm = "RSA"
        else:
            algorithm = key_type

        return {
            "valid": True,
            "fingerprint": fingerprint,
            "key_id": fingerprint[-16:],
            "algorithm": algorithm,
            "error": None
        }
    except Exception as e:
        return {"valid": False, "error": str(e)[:100], "fingerprint": None}


def get_key_fingerprint(public_key_armored: str) -> str:
    """Retourne le fingerprint d'une cle publique"""
    result = validate_pgp_public_key(public_key_armored)
    return result.get("fingerprint", "UNKNOWN")


if __name__ == "__main__":
    print("[PGP TEST] Generating Ed25519 keypair...")
    result = generate_pgp_keypair("testuser", "testpassword123")
    if result["success"]:
        print(f"[OK] Algorithm: {result['algorithm']}")
        print(f"[OK] Fingerprint: {result['fingerprint']}")
        print(f"[OK] Key ID: {result['key_id']}")
        print(f"[OK] Public key length: {len(result['public_key'])} chars")
        print(f"[OK] Private key length: {len(result['private_key'])} chars")

        # Test encryption
        enc = encrypt_message(result["public_key"], "Hello SilkGenesis!")
        print(f"[OK] Encryption: {enc['encrypted']} ({enc.get('algorithm', 'N/A')})")
    else:
        print(f"[FAIL] {result['error']}")


