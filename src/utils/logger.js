// Lightweight logger (no winston) — lower RSS on 1GB boards
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const isDev = config.nodeEnv === 'development';
const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const current = isDev ? levels.debug : levels.info;

let errorStream = null;
if (!isDev) {
  const logDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  errorStream = fs.createWriteStream(path.join(logDir, 'error.log'), { flags: 'a' });
}

function ts() {
  return new Date().toISOString();
}

function write(level, msg) {
  if (levels[level] > current) return;
  const line = `${ts()} [${level}] ${msg}`;
  if (level === 'error') {
    console.error(line);
    if (errorStream) errorStream.write(line + '\n');
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  error: (m) => write('error', m),
  warn: (m) => write('warn', m),
  info: (m) => write('info', m),
  debug: (m) => write('debug', m),
};
