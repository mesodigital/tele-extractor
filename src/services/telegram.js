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

const bot = new TelegramBot(config.telegramBotToken, {
  polling: {
    interval: 500,
    params: {
      timeout: 30,
      limit: 10,
    },
  },
});

bot.on('polling_error', (err) => {
  logger.error(`Polling error: ${err?.message || err?.code || err}`);
});

bot.on('error', (err) => {
  logger.error(`Bot error: ${err?.message || err?.code || err}`);
});

const MEDIA_GROUP_DEBOUNCE_MS = 1000;
/** @type {Map<string, { chatId: number, photos: { file_id: string, message_id: number }[], caption: string|null, timer: NodeJS.Timeout|null, locked: boolean }>} */
const mediaGroups = new Map();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function applyCaptionSourceLink(result, caption) {
  if (!caption) return;
  const urlMatch = caption.match(/(https?:\/\/[^\s]+)/gi);
  if (urlMatch && urlMatch.length > 0) {
    result.source_link = urlMatch[0];
    logger.info(`Found source link in caption: ${result.source_link}`);
  }
}

function saveExtractionLog(result) {
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
}

async function cleanupPaths(paths) {
  for (const p of paths) {
    try {
      await fileHelper.unlinkAsync(p);
    } catch (e) {
      logger.warn(`Could not delete ${p}: ${e.message}`);
    }
  }
}

async function sendError(chatId, messageId, error) {
  logger.error(`Error processing message: ${error.message}`);
  const raw = error.stack || String(error);
  const detail = raw.length > 3500 ? `${raw.slice(0, 3500)}\n…` : raw;
  await bot.sendMessage(
    chatId,
    `❌ Terjadi kesalahan saat memproses gambar.\n\n<blockquote expandable>${escapeHtml(detail)}</blockquote>`,
    { parse_mode: 'HTML', reply_to_message_id: messageId }
  );
}

/**
 * Download + AI + log + sheets + 1 balasan. Selalu cleanup temp.
 * @param {{ chatId: number, messageId: number, fileIds: string[], caption: string|null, mediaGroupId?: string }} opts
 */
async function processJob({ chatId, messageId, fileIds, caption, mediaGroupId }) {
  const downloadedPaths = [];
  try {
    for (const fileId of fileIds) {
      logger.info(`Downloading image ${fileId}`);
      const downloadedPath = await bot.downloadFile(fileId, os.tmpdir());
      downloadedPaths.push(downloadedPath);
    }

    if (mediaGroupId) {
      logger.info(
        `Media group ${mediaGroupId}: ${downloadedPaths.length} photo(s), paths=${JSON.stringify(downloadedPaths)}`
      );
    }

    logger.info(`Sending ${downloadedPaths.length} image(s) to AI for extraction...`);
    const input = downloadedPaths.length === 1 ? downloadedPaths[0] : downloadedPaths;
    const result = await aiService.extractTextFromImage(input);

    applyCaptionSourceLink(result, caption);
    saveExtractionLog(result);

    logger.info('Appending row to Google Sheets...');
    await sheetsService.appendRow(result);

    await bot.sendMessage(chatId, '✅ Data berhasil diekstrak dan disimpan!');
  } catch (error) {
    await sendError(chatId, messageId, error);
  } finally {
    await cleanupPaths(downloadedPaths);
  }
}

async function flushMediaGroup(groupId) {
  const group = mediaGroups.get(groupId);
  if (!group || group.locked) return;

  group.locked = true;
  if (group.timer) {
    clearTimeout(group.timer);
    group.timer = null;
  }

  // Ambil snapshot lalu hapus entry biar foto terlambat tidak double-process
  const { chatId, photos, caption } = group;
  mediaGroups.delete(groupId);

  const fileIds = photos.map((p) => p.file_id);
  const messageId = photos[0]?.message_id;

  logger.info(`Flush media group ${groupId}: ${fileIds.length} photo(s)`);
  await processJob({
    chatId,
    messageId,
    fileIds,
    caption,
    mediaGroupId: groupId,
  });
}

// Handle incoming message
bot.on('message', async (msg) => {
  try {
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

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  // Media group: buffer + debounce, proses sekali setelah album lengkap
  if (msg.media_group_id) {
    const groupId = msg.media_group_id;
    let group = mediaGroups.get(groupId);

    if (group?.locked) {
      logger.info(`Ignore late photo for locked media group ${groupId}`);
      return;
    }

    if (!group) {
      group = {
        chatId: msg.chat.id,
        photos: [],
        caption: null,
        timer: null,
        locked: false,
      };
      mediaGroups.set(groupId, group);
    }

    group.photos.push({ file_id: photoId, message_id: msg.message_id });
    if (!group.caption && msg.caption) {
      group.caption = msg.caption;
    }

    if (group.timer) clearTimeout(group.timer);
    group.timer = setTimeout(() => {
      flushMediaGroup(groupId).catch((err) => {
        logger.error(`flushMediaGroup failed: ${err.message}`);
      });
    }, MEDIA_GROUP_DEBOUNCE_MS);

    logger.info(
      `Buffered media group ${groupId}: ${group.photos.length} photo(s), caption=${Boolean(group.caption)}`
    );
    return;
  }

  // Foto tunggal
  await processJob({
    chatId: msg.chat.id,
    messageId: msg.message_id,
    fileIds: [photoId],
    caption: msg.caption || null,
  });
  } catch (err) {
    logger.error(`Message handler error: ${err?.message || err}`);
  }
});

module.exports = { bot };
