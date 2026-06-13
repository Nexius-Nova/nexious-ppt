const path = require('node:path');

const cwd = __dirname;

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'nexious-ppt-api',
      cwd,
      script: 'pnpm',
      args: 'run server',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '3001',
        STORAGE_ROOT: process.env.STORAGE_ROOT || '/var/lib/nexious-ppt',
        PYTHON_BIN: process.env.PYTHON_BIN || path.join(cwd, '.venv', 'bin', 'python'),
      },
      max_memory_restart: process.env.PM2_MAX_MEMORY || '800M',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 10000,
      out_file: path.join(cwd, 'logs', 'pm2-out.log'),
      error_file: path.join(cwd, 'logs', 'pm2-error.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: (process.env.PM2_APP_NAME || 'nexious-ppt-api') + '-worker',
      cwd,
      script: 'pnpm',
      args: 'run worker',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        STORAGE_ROOT: process.env.STORAGE_ROOT || '/var/lib/nexious-ppt',
        PYTHON_BIN: process.env.PYTHON_BIN || path.join(cwd, '.venv', 'bin', 'python'),
      },
      max_memory_restart: process.env.PM2_WORKER_MAX_MEMORY || '1G',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 15000,
      out_file: path.join(cwd, 'logs', 'pm2-worker-out.log'),
      error_file: path.join(cwd, 'logs', 'pm2-worker-error.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
