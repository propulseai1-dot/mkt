/**
 * SILKGENESIS - Client-side PGP (OpenPGP.js)
 * ==========================================
 * Tout le travail cryptographique est fait dans le navigateur:
 *   - Generation de la paire ECC (curve25519, defaut OpenPGP.js v5)
 *   - La cle privee n'est JAMAIS envoyee au serveur, jamais stockee en clair
 *   - On envoie SEULEMENT la cle publique armored au /api/register
 *   - La cle privee armored est protegee par un passphrase (le password de l'user)
 *     et stockee dans localStorage. L'utilisateur DOIT aussi telecharger un
 *     backup pour ne pas perdre l'acces a son chat en cas de wipe navigateur.
 *
 * Aucune confiance dans le serveur pour la confidentialite des messages.
 */

// openpgp v5 utilise des modules ES; CRA 5 le supporte.
let _openpgp;
async function _getOpenPGP() {
  if (!_openpgp) {
    _openpgp = await import('openpgp');
  }
  return _openpgp;
}

const PRIVATE_KEY_LOCALSTORAGE = 'silk_pgp_priv_v1'; // armored, encrypted by passphrase
const PUBLIC_KEY_LOCALSTORAGE = 'silk_pgp_pub_v1';   // armored

/**
 * Generate a new keypair locally. Returns { publicKey, privateKey, fingerprint }.
 * publicKey  : armored ASCII (a envoyer au backend)
 * privateKey : armored ASCII chiffre avec passphrase (jamais transmis)
 */
export async function generatePgpKeyPair(username, passphrase) {
  if (!username || typeof username !== 'string') throw new Error('username required');
  if (!passphrase || passphrase.length < 8) throw new Error('passphrase too short');
  const openpgp = await _getOpenPGP();
  const userIDs = [{ name: username, email: `${username}@silkgenesis.onion` }];
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs,
    passphrase,
    format: 'armored',
  });
  // fingerprint
  const pubObj = await openpgp.readKey({ armoredKey: publicKey });
  const fingerprint = pubObj.getFingerprint().toUpperCase();
  return { publicKey, privateKey, fingerprint };
}

/** Persist the encrypted private key + public key locally. */
export function savePgpKeysLocal({ publicKey, privateKey }) {
  if (publicKey) localStorage.setItem(PUBLIC_KEY_LOCALSTORAGE, publicKey);
  if (privateKey) localStorage.setItem(PRIVATE_KEY_LOCALSTORAGE, privateKey);
}

export function loadPgpKeysLocal() {
  return {
    publicKey: localStorage.getItem(PUBLIC_KEY_LOCALSTORAGE) || '',
    privateKey: localStorage.getItem(PRIVATE_KEY_LOCALSTORAGE) || '',
  };
}

export function clearPgpKeysLocal() {
  localStorage.removeItem(PUBLIC_KEY_LOCALSTORAGE);
  localStorage.removeItem(PRIVATE_KEY_LOCALSTORAGE);
}

/** Encrypt message to a recipient's armored public key. */
export async function encryptForRecipient(plaintext, recipientPublicKeyArmored) {
  if (!plaintext) throw new Error('empty plaintext');
  if (!recipientPublicKeyArmored) throw new Error('no recipient key');
  const openpgp = await _getOpenPGP();
  const encryptionKey = await openpgp.readKey({ armoredKey: recipientPublicKeyArmored });
  const ciphertext = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: plaintext }),
    encryptionKeys: encryptionKey,
    format: 'armored',
  });
  return ciphertext;
}

/** Decrypt an armored PGP message using the local encrypted private key + passphrase. */
export async function decryptWithLocalKey(armoredMessage, passphrase) {
  const openpgp = await _getOpenPGP();
  const armoredPrivate = localStorage.getItem(PRIVATE_KEY_LOCALSTORAGE) || '';
  if (!armoredPrivate) throw new Error('no local private key — please import or regenerate');
  const encryptedPrivate = await openpgp.readPrivateKey({ armoredKey: armoredPrivate });
  const privateKey = await openpgp.decryptKey({ privateKey: encryptedPrivate, passphrase });
  const message = await openpgp.readMessage({ armoredMessage });
  const { data: plaintext } = await openpgp.decrypt({ message, decryptionKeys: privateKey });
  return plaintext;
}

/** Export the encrypted private key as a downloadable .asc file. */
export function downloadPrivateKeyBackup(username) {
  const armoredPrivate = localStorage.getItem(PRIVATE_KEY_LOCALSTORAGE) || '';
  if (!armoredPrivate) return false;
  const blob = new Blob([armoredPrivate], { type: 'application/pgp-keys' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `silkgenesis_pgp_private_${username || 'user'}.asc`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Import a previously-saved private key (.asc) into local storage. */
export async function importPrivateKeyArmored(armored, passphrase) {
  const openpgp = await _getOpenPGP();
  // Validate it parses + the passphrase is correct.
  const k = await openpgp.readPrivateKey({ armoredKey: armored });
  await openpgp.decryptKey({ privateKey: k, passphrase });
  localStorage.setItem(PRIVATE_KEY_LOCALSTORAGE, armored);
  return true;
}

/** Helper: fetch a user's PGP public key from the API. */
export async function fetchUserPublicKey(silkApiUrl, username) {
  const res = await fetch(silkApiUrl(`/api/pgp/${encodeURIComponent(username)}`), {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('PGP key fetch failed');
  const data = await res.json();
  return data.pgp_public_key || data.pgp_key || '';
}
