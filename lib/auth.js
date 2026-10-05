const crypto = require('crypto');
const { client } = require('./api-client');

const CACHE_TTL_MS = parseInt(process.env.AUTH_CACHE_TTL_MS || '300000');
const cache = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

async function verifyToken(token) {
  if (!token) throw new Error('Token kosong');

  const key = hashToken(token);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const payload = decodeJwtPayload(token);
  if (!payload) throw new Error('Token tidak valid (bukan JWT)');

  const kd = payload.kd_pengguna ?? payload.kd;
  if (!kd) throw new Error('Token tidak memuat field kd_pengguna');

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error('Token expired');
  }

  let user;
  try {
    const res = await client.get(`pengguna/getbykd/${kd}`, {
      headers: { Authorization: token },
    });
    user = res.data;
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'verify failed';
    throw new Error(`Verifikasi token gagal: ${msg}`);
  }

  if (!user || user.status === false) {
    throw new Error('User tidak aktif / tidak ditemukan');
  }

  cache.set(key, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  return user;
}

function getCachedUser(token) {
  const c = cache.get(hashToken(token));
  if (c && c.expiresAt > Date.now()) return c.user;
  return null;
}

function clearAuthCache() {
  cache.clear();
}

module.exports = {
  verifyToken,
  decodeJwtPayload,
  getCachedUser,
  clearAuthCache,
};