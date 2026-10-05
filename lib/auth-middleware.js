const { verifyToken } = require('./auth');

async function authMiddleware(req, res, next) {
  // Public paths
  if (req.path === '/health') return next();
  // Static assets (html, css, js di /public) tidak butuh auth
  if (!req.path.startsWith('/api/')) return next();

  let token = req.headers['authorization'];
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  // Toleran: strip "Bearer " kalau ada, utamanya raw token
  if (token.startsWith('Bearer ')) token = token.slice(7).trim();

  try {
    const user = await verifyToken(token);
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.warn('[auth] Reject:', err.message);
    res.status(401).json({
      error: 'Unauthorized',
      detail: err.message,
    });
  }
}

module.exports = authMiddleware;