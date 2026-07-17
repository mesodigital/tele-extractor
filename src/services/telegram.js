// Logika bot (menerima pesan, download file, kirim balasan)
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const aiService = require('./ai');
const sheetsService = require('./sheets');
const fileHelper = require('../utils/fileHelper');
const config = require('../config/config');
const logger = require('../utils/logger');

const bot = new TelegramBot(config.telegramBotToken, { polling: true });

// Handle incoming message
bot.on('message', async (msg) => {
  let downloadedPath = null;

  // Hanya proses pesan dari chat yang diizinkan
  if (String(msg.chat.id) !== String(config.allowedChatId)) {
    return;
  }

  // Hanya proses pesan dengan gambar
  if (!msg.photo || msg.photo.length === 0) {
    await bot.sendMessage(msg.chat.id, 'Silakan kirim gambar!');
    return;
  }

  try {
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    logger.info(`Downloading image ${photoId}`);

    // Download file ke /tmp (downloadFile returns the full path)
    downloadedPath = await bot.downloadFile(photoId, '/tmp');

    logger.info(`Saved image to ${downloadedPath}`);

    // Ekstraksi AI
    logger.info('Sending image to AI for extraction...');
    const result = await aiService.extractTextFromImage(downloadedPath);

    // Simpan hasil sebagai file JSON di logs/
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `extraction_${photoId}_${timestamp}.json`);
    fs.writeFileSync(logFile, JSON.stringify(result, null, 2));
    logger.info(`Saved extraction result to ${logFile}`);

    // Simpan hasil ke Google Sheets
    logger.info('Appending row to Google Sheets...');
    await sheetsService.appendRow(result);

    // Kirim konfirmasi ke pengguna
    await bot.sendMessage(msg.chat.id, '✅ Data berhasil diekstrak dan disimpan!');

  } catch (error) {
    logger.error(`Error processing message: ${error.message}`);

    // Kirim error ke pengguna
    await bot.sendMessage(msg.chat.id, '❌ Terjadi kesalahan saat memproses gambar. Silakan coba lagi.');

  } finally {
    // Hapus file sementara (selalu, sukses atau gagal)
    if (downloadedPath) {
      try {
        await fileHelper.unlinkAsync(downloadedPath);
      } catch (e) {
        logger.warn(`Could not delete ${downloadedPath}: ${e.message}`);
      }
    }
  }
});

module.exports = { bot };
