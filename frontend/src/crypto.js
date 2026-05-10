/**
 * SILKGENESIS - crypto.js
 *
 * NOTE DE SECURITE
 * ----------------
 * L'ancienne implementation de ce fichier utilisait une cle AES *codee en dur*
 * dans le bundle JS (et donc identique pour tous les utilisateurs). Ce n'etait
 * pas du chiffrement de bout en bout, juste de l'obfuscation. Toute personne
 * recevant le bundle pouvait dechiffrer n'importe quel message.
 *
 * Cette implementation a ete RETIREE.
 *
 * Le chiffrement des messages doit etre fait via PGP, en utilisant la cle
 * publique PGP du destinataire. Pour le moment, l'API serveur expose
 * /api/pgp/encrypt qui chiffre cote serveur (le serveur voit donc le plaintext)
 * — c'est documente comme limitation et la migration vers openpgp.js cote
 * navigateur est planifiee (voir audit, finding f28 / P2).
 *
 * Les fonctions ci-dessous levent volontairement une erreur pour casser
 * proprement tout code legacy qui les utiliserait par accident, plutot que
 * de continuer en silence avec un faux chiffrement.
 */

const REMOVED =
  'crypto.js: removed (was fake AES with a hardcoded global key). ' +
  'Use PGP encryption via the server API or migrate to openpgp.js client-side.';

export async function encryptMessage(/* message, password */) {
  throw new Error(REMOVED);
}

export async function decryptMessage(/* encryptedBase64, password */) {
  throw new Error(REMOVED);
}

export function getChatKey(buyer, vendor) {
  // Conserve uniquement comme helper pour identifier une conversation buyer-vendor.
  // Aucun secret cryptographique ici.
  return `${buyer}_${vendor}`;
}
