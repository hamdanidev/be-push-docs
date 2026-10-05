const axios = require('axios');

const normalizeBaseUrl = (url) => {
  if (!url) return '';
  return url.endsWith('/') ? url : url + '/';
};

const BASE_URL = normalizeBaseUrl(process.env.API_BASE_URL);

const client = axios.create({
  baseURL: BASE_URL,
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '120000'),
});

let CURRENT_USER = null;

/* ── CLI login (dipakai index.js) ─────────────────────────── */
async function login() {
  const username = process.env.API_USERNAME;
  const password = process.env.API_PASSWORD;

  if (!username || !password) {
    throw new Error('API_USERNAME & API_PASSWORD wajib diisi di .env');
  }

  const res = await client.post(
    'pengguna/login',
    { username, password },
    { headers: { 'Content-Type': 'application/json' } }
  );

  const data = res.data;
  if (!data || !data.token) {
    throw new Error(
      'Login gagal — token tidak ditemukan di response: ' +
      JSON.stringify(data).slice(0, 200)
    );
  }

  CURRENT_USER = data;
  client.defaults.headers.common['Authorization'] = data.token;
  return data;
}

/* ── API mode (dipakai job-worker) ───────────────────────── */
function setToken(token) {
  client.defaults.headers.common['Authorization'] = token;
}

function clearToken() {
  delete client.defaults.headers.common['Authorization'];
}

function getCurrentUser() {
  return CURRENT_USER;
}

module.exports = {
  client,
  login,
  setToken,
  clearToken,
  getCurrentUser,
  BASE_URL,
};