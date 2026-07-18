module.exports = {
  apps: [{
    name: "tele-extractor",
    script: "./src/index.js",
    // Bot polling + single HTTP health port: 1 process only.
    // Cluster "max" wastes RAM and breaks Telegram getUpdates.
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "200M",
    env: {
      NODE_ENV: "production"
    },
    env_development: {
      NODE_ENV: "development"
    }
  }]
}
