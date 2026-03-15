const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
    }
  } catch {}
  return env;
}

const envFile = loadEnvFile(path.join(__dirname, ".env.production"));

module.exports = {
  apps: [
    {
      name: "rag-chat",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
        ...envFile,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
