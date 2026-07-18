// Entry point utama (inisialisasi service dan listener)
const config = require('./config/config');
const { bot } = require('./services/telegram');
const logger = require('./utils/logger');

const PORT = config.port || 4746;

// Safety net: catch any unhandled rejection that slips through
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason?.code || reason}`);
});

async function start() {
  try {
    logger.info(`🚀 Tele-Extractor started in ${config.nodeEnv} mode`);
    logger.info(`📡 Telegram bot polling...`);
    logger.info(`🔒 Chat ID whitelist: ${config.allowedChatId}`);

    // Health check endpoint
    const http = require('http');
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
    // Prevent connection leak from idle keep-alive sockets
    server.keepAliveTimeout = 5000;
    server.headersTimeout = 6000;
    server.listen(PORT, () => {
      logger.info(`✅ HTTP server listening on port ${PORT}`);
    });

  } catch (error) {
    logger.error(`❌ Gagal memulai aplikasi: ${error.message}`);
    process.exit(1);
  }
}

start();
