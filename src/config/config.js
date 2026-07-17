// Validasi dan ekspor variabel dari .env secara terpusat
require('dotenv').config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 4746,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  allowedChatId: process.env.ALLOWED_CHAT_ID,
  aiBaseUrl: process.env.AI_BASE_URL,
  aiApiKey: process.env.AI_API_KEY,
  aiModel: process.env.AI_MODEL,
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  googleSheetId: process.env.GOOGLE_SHEET_ID,
};

// Basic validation
for (const key in config) {
  if (config[key] === undefined) {
    console.warn(`WARNING: Environment variable ${key} is not set.`);
  }
}

module.exports = config;
