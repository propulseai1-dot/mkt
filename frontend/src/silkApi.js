/**
 * API URL: use REACT_APP_API_BASE (e.g. http://127.0.0.1:5000) for static builds;
 * otherwise same-origin paths like /api/... (CRA proxy in npm start).
 */
export function silkApiUrl(path) {
  const raw =
    typeof process !== 'undefined' && process.env.REACT_APP_API_BASE
      ? String(process.env.REACT_APP_API_BASE).trim().replace(/\/$/, '')
      : '';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!raw) return p;
  // REACT_APP_API_BASE sometimes set to .../api — avoid /api/api/...
  if ((p.startsWith('/api/') || p === '/api') && /\/api$/i.test(raw)) {
    const suffix = p === '/api' ? '' : p.slice(4);
    return `${raw}${suffix}`;
  }
  return `${raw}${p}`;
}

// ============================================================
// CSRF + Session cookie helpers
// ============================================================
const CSRF_COOKIE = 'sg_csrf';

function _readCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return '';
  const parts = document.cookie.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    if (decodeURIComponent(p.slice(0, eq)) === name) {
      return decodeURIComponent(p.slice(eq + 1));
    }
  }
  return '';
}

/**
 * silkFetch — wrapper around fetch() that:
 *   - sends cookies with every request (credentials: 'include')
 *   - adds X-CSRF-Token header on mutating methods if a sg_csrf cookie exists
 *   - keeps backward compatibility with explicit Authorization headers
 *
 * Use this instead of bare fetch() for all SilkGenesis API calls.
 */
export async function silkFetch(path, options = {}) {
  const url = silkApiUrl(path);
  const opts = { ...options };
  opts.credentials = opts.credentials ?? 'include';
  const method = (opts.method || 'GET').toUpperCase();
  const headers = new Headers(opts.headers || {});
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = _readCookie(CSRF_COOKIE);
    if (csrf && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', csrf);
    }
  }
  opts.headers = headers;
  return fetch(url, opts);
}

// ============================================================
// Proof-of-Work helper (Hashcash style)
// Demande au serveur un challenge, mine un nonce, retourne la solution
// au format attendu par le backend (api-service/pow.py).
// ============================================================
function _bitsZero(buf, bits) {
  const fullBytes = bits >> 3;
  const remainder = bits & 7;
  for (let i = 0; i < fullBytes; i++) {
    if (buf[i] !== 0) return false;
  }
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (buf[fullBytes] & mask) === 0;
}

async function _sha256Bytes(str) {
  const enc = new TextEncoder().encode(str);
  const dig = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(dig);
}

export async function fetchPowChallenge(context) {
  const ctx = context === 'register' ? 'register' : 'login';
  const res = await fetch(silkApiUrl(`/api/pow/challenge?context=${ctx}`));
  if (!res.ok) throw new Error('POW_CHALLENGE_FAILED');
  return res.json();
}

export async function mineProofOfWork(context = 'login', maxIterations = 5_000_000) {
  const { challenge, difficulty } = await fetchPowChallenge(context);
  let nonce = 0;
  for (; nonce < maxIterations; nonce++) {
    const dig = await _sha256Bytes(`${challenge}:${nonce}`);
    if (_bitsZero(dig, difficulty)) {
      return `${challenge}::${nonce}`;
    }
    // Yield to UI sometimes for non-blocking UX
    if ((nonce & 0xfff) === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  throw new Error('POW_MINE_TIMEOUT');
}
