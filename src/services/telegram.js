// Logika bot (menerima pesan, download file, kirim balasan)
const { Bot } = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');
const aiService = require('./ai');
const sheetsService = require('./sheets');
const fileHelper = require('../utils/fileHelper');
const config = require('../config/config');
const logger = require('../utils/logger');

const bot = new Bot(config.telegramBotToken, { polling: true });

// Handle incoming message
bot.on('message', async (msg) => {
  // Hanya proses pesan dari chat yang diizinkan
  if (msg.chat.id !== config.allowedChatId) {
    return;
  }

  // Hanya proses pesan dengan gambar
  if (!msg.photo || msg.photo.length === 0) {
    await bot.sendMessage(msg.chat.id, 'Silakan kirim gambar!');
    return;
  }

  const photoId = msg.photo[msg.photo.length - 1].id;
  const filePath = path.join('/tmp', `${Date.now()}_${photoId}.jpg`);

  try {
    logger.info(`Downloading image ${photoId} to ${filePath}`);

    // Download file ke /tmp
    await bot.downloadFile(photoId, filePath);

    // Ekstraksi AI
    logger.info('Sending image to AI for extraction...');
    const result = await aiService.extractTextFromImage(filePath);

    // Simpan hasil ke Google Sheets
    logger.info('Appending row to Google Sheets...');
    await sheetsService.appendRow(result);

    // Hapus file sementara
    await fileHelper.unlinkAsync(filePath);

    // Kirim konfirmasi ke pengguna
    await bot.sendMessage(msg.chat.id, '✅ Data berhasil diekstrak dan disimpan!');

  } catch (error) {
    logger.error(`Error processing message: ${error.message}`);

    // Hapus file jika terjadi error
    if (fs.existsSync(filePath)) {
      await fileHelper.unlinkAsync(filePath);
    }

    // Kirim error ke pengguna
    await bot.sendMessage(msg.chat.id, '❌ Terjadi kesalahan saat memproses gambar. Silakan coba lagi.');
  }
});

module.exports = { bot };
