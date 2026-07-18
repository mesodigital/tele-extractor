module.exports = {
  apps : [{
    name   : "tele-extractor",
    script : "./src/index.js",
    instances : process.platform === 'win32' ? 1 : "max",
    exec_mode : process.platform === 'win32' ? "fork" : "cluster",
    env: {
      NODE_ENV: "production"
    },
    env_development: {
      NODE_ENV: "development"
    }
  }]
}