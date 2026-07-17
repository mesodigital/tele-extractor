// Logika instansiasi client OpenAI dan fungsi image-to-text
const OpenAI = require('openai');
const fs = require('fs');
const config = require('../config/config');
const logger = require('../utils/logger');

// Instansiasi klien OpenAI
const openai = new OpenAI({
  apiKey: config.aiApiKey,
  baseURL: config.aiBaseUrl,
});

/**
 * Ekstraksi teks dari gambar menggunakan model AI
 * @param {string} filePath - Path ke file gambar
 * @returns {Promise<Object>} Data yang diekstraksi dalam format JSON
 */
async function extractTextFromImage(filePath) {
  try {
    logger.info(`Extracting text from ${filePath}`);

    // Baca file gambar
    const imageBuffer = await fs.readFileSync(filePath);

    // Panggil API AI dengan prompt khusus
    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        {
          role: 'system',
          content: `Anda adalah asisten ekstraksi data berbasis gambar. Harap analisis gambar berikut dan ekstrak informasi struktural dalam format JSON. Keluarkan hanya JSON tanpa penjelasan tambahan. Contoh output: {"nama": "Contoh", "tanggal": "2024-01-01", "deskripsi": "Deskripsi singkat"}`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } },
          ],
        },
      ],
      temperature: 0.3,
    });

    const extractedText = response.choices[0].message.content;

    // Parsing JSON hasil ekstraksi
    const result = JSON.parse(extractedText);

    logger.info('Successfully extracted data from image');
    return result;

  } catch (error) {
    logger.error(`Error during AI extraction: ${error.message}`);
    throw error;
  }
}

module.exports = { extractTextFromImage };
