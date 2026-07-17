// Entry point utama (inisialisasi service dan listener)
const config = require('./config/config');
const { bot } = require('./services/telegram');
const logger = require('./utils/logger');

const PORT = config.port || 4746;

async function start() {
  try {
    logger.info(`🚀 Tele-Extractor started in ${config.nodeEnv} mode`);
    logger.info(`📡 Listening on port ${PORT}`);

    // Siapkan server HTTP untuk webhook (opsional)
    const http = require('http');
    http.createServer((req, res) => {
      if (req.url === '/webhook') {
        bot.onWebhook(req, res);
      } else {
        res.writeHead(200);
        res.end('OK');
      }
    }).listen(PORT, () => {
      logger.info(`✅ Server berjalan di port ${PORT}`);
    });

  } catch (error) {
    logger.error(`❌ Gagal memulai aplikasi: ${error.message}`);
    process.exit(1);
  }
}

start();
