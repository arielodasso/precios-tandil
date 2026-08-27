module.exports = {
  apps: [
    {
      name: 'precios-api',
      cwd: './apps/api',
      script: 'node',
      args: '--import tsx/esm src/server.ts',
      env: {
        DATABASE_URL: 'postgresql://neondb_owner:npg_HZN0lp3ERxmg@ep-nameless-sky-ay3iwzx2-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
        REDIS_URL: 'redis://localhost:6379',
        PORT: '3001',
        NODE_ENV: 'production',
        ADMIN_TOKEN_DEV: 'dev-token',
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
        DATABASE_URL: 'postgresql://neondb_owner:npg_HZN0lp3ERxmg@ep-nameless-sky-ay3iwzx2-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
    },
  ],
};
