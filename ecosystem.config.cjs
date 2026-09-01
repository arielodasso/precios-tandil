const fs = require('node:fs');
const path = require('node:path');

// Carga el .env del repo (si existe) para no hardcodear secretos en el repo.
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...process.env, ...loadEnv() };

module.exports = {
  apps: [
    {
      name: 'precios-api',
      cwd: './apps/api',
      script: 'node',
      args: '--import tsx/esm src/server.ts',
      env: {
        DATABASE_URL: env.DATABASE_URL,
        REDIS_URL: env.REDIS_URL ?? 'redis://localhost:6379',
        PORT: env.PORT ?? '3001',
        NODE_ENV: 'production',
        ADMIN_TOKEN_DEV: env.ADMIN_TOKEN_DEV ?? 'dev-token',
      },
      max_memory_restart: '256M',
      autorestart: true,
      watch: false,
    },
    {
      name: 'precios-worker',
      cwd: './apps/worker',
      script: 'node',
      args: '--import tsx/esm src/index.ts',
      env: {
        DATABASE_URL: env.DATABASE_URL,
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
    },
  ],
};
