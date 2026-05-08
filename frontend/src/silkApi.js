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
