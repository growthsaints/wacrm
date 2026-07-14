// PM2 process manager config for a Hostinger VPS deployment.
//
// Usage (from the repo root, after `npm ci && npm run build`):
//   pm2 start deploy/ecosystem.config.js
//   pm2 save
//   pm2 startup   # prints a systemd command to run once, so PM2
//                 # survives a VPS reboot
//
// Logs land in ~/.pm2/logs/ by default; `pm2 logs wacrm` tails them.
module.exports = {
  apps: [
    {
      name: 'wacrm',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      autorestart: true,
      // Real secrets live in the server's own `.env.production` /
      // shell environment (loaded by `next start` via `.env.production`
      // in the project root) — never commit them here.
    },
  ],
};
