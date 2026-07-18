// Logika bot (menerima pesan, download file, kirim balasan)
const fs = require('fs');
const os = require('os');
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
  const normalizeChatId = (value) => String(value || '').replace(/[^\d-]/g, '');
  const incomingId = normalizeChatId(msg.chat.id);
  const allowedId = normalizeChatId(config.allowedChatId);
  if (incomingId !== allowedId) {
    logger.warn(`Blocked message from chat ${incomingId} (expected ${allowedId})`);
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

    // Download file ke temp dir (cross-platform)
    downloadedPath = await bot.downloadFile(photoId, os.tmpdir());

    logger.info(`Saved image to ${downloadedPath}`);

    // Ekstraksi AI
    logger.info('Sending image to AI for extraction...');
    const result = await aiService.extractTextFromImage(downloadedPath);

    // Extract URL from caption if present
    if (msg.caption) {
      const urlMatch = msg.caption.match(/(https?:\/\/[^\s]+)/gi);
      if (urlMatch && urlMatch.length > 0) {
        result.source_link = urlMatch[0];
        logger.info(`Found source link in caption: ${result.source_link}`);
      }
    }

    // Simpan hasil sebagai file JSON di logs/
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}-${hh}${min}`;
    const sanitize = (s) => (s || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
    const company = sanitize(result.Company);
    const position = sanitize(result.Position);
    const customName = `${company}_${position}`.slice(0, 100);
    const logFile = path.join(logDir, `${dateStr}-(${customName}).json`);
    fs.writeFileSync(logFile, JSON.stringify(result, null, 2));
    logger.info(`Saved extraction result to ${logFile}`);

    // Simpan hasil ke Google Sheets
    logger.info('Appending row to Google Sheets...');
    await sheetsService.appendRow(result);

    // Kirim konfirmasi ke pengguna
    await bot.sendMessage(msg.chat.id, '✅ Data berhasil diekstrak dan disimpan!');

  } catch (error) {
    logger.error(`Error processing message: ${error.message}`);

    // Balas dengan log error format quote (blockquote Telegram)
    const raw = error.stack || String(error);
    const detail = raw.length > 3500 ? `${raw.slice(0, 3500)}\n…` : raw;
    const escapeHtml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    await bot.sendMessage(
      msg.chat.id,
      `❌ Terjadi kesalahan saat memproses gambar.\n\n<blockquote expandable>${escapeHtml(detail)}</blockquote>`,
      { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
    );

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
