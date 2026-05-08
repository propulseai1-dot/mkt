/**
 * SILKGENESIS - AES-256 ENCRYPTION
 * Chiffrement side client pour les messages
 */

// Deriver une cle de encryption depuis un password
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Chiffrer un message (SIMPLIFIE - cle fixe pour que tout le monde puisse dechiffrer)
export async function encryptMessage(message, password) {
  try {
    const encoder = new TextEncoder();
    // Utiliser une cle globale fixe pour que tous les users puissent dechiffrer
    const globalKey = 'silkgenesis_global_chat_key_v1';
    const salt = 'silkgenesis_salt_v1';
    const key = await deriveKey(globalKey, salt);
    
    // Generate un IV aleatoire
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Chiffrer
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(message)
    );
    
    // Combiner IV + data encryptedes
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    // Convertir en base64
    return btoa(String.fromCharCode(...combined));
  } catch (e) {
    console.error('Encryption error:', e);
    return message; // Returnsr le message in plain text on error
  }
}

// Decrypt un message
export async function decryptMessage(encryptedBase64, password) {
  try {
    // Utiliser la meme cle globale
    const globalKey = 'silkgenesis_global_chat_key_v1';
    const salt = 'silkgenesis_salt_v1';
    const key = await deriveKey(globalKey, salt);
    
    // Decoder base64
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    
    // Extraire IV et data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    // Decrypt
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (e) {
    console.error('Decryption error:', e);
    return encryptedBase64; // Returnsr le message as-is if decryption fails
  }
}

// Generate une cle de chat unique pour buyer-vendor
export function getChatKey(buyer, vendor) {
  return `${buyer}_${vendor}`;
}


