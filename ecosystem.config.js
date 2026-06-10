const path = require('path');

module.exports = {
  apps: [
    {
      name: 'remote-client',
      script: 'start-prod.js',
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      // dotenv loads .env from cwd on startup — create .env from .env.example first
      env: {
        NODE_ENV: 'production',
      },
      env_file: '.env',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
