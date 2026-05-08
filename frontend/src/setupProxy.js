/**
 * Relaie tout /api vers le backend FastAPI (port 5000).
 * Corrige les 404 en dev quand le serveur CRA ne forward pas PUT / gros JSON.
 * Redemarrer `npm start` apres ajout de ce fichier.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const target = process.env.REACT_APP_PROXY_TARGET || 'http://127.0.0.1:5000';
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
    })
  );
};
