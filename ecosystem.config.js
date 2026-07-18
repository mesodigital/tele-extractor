module.exports = {
  apps: [{
    name: "tele-extractor",
    script: "./src/index.js",
    // Bot polling + single HTTP health port: 1 process only.
    instances: 1,
    exec_mode: "fork",
    // Cap Node heap — fit 1GB boards; peak naik sebentar saat proses gambar
    // --expose-gc: enables global.gc() hint in polling cycle (see telegram.js patch)
    node_args: "--max-old-space-size=96 --expose-gc",
    max_memory_restart: "150M",
    env: {
      NODE_ENV: "production"
    },
    env_development: {
      NODE_ENV: "development"
    }
  }]
}
