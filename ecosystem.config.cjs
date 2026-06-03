module.exports = {
  apps: [
    {
      name: "portal-acolitado",
      script: "cmd",
      args: "/c npm run dev",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      env: {
        NODE_ENV: "development",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
    },
  ],
};
