// Logika otentikasi Google Service Account dan appendRow
const { google } = require('googleapis');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Otentikasi Google Service Account dan dapatkan instance spreadsheet
 */
function getAuthClient() {
  const key = new Buffer(config.googlePrivateKey, 'base64').toString('utf8');
  return google.auth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    keyFile: key,
    projectId: process.env.GOOGLE_PROJECT_ID || 'tele-extractor',
  });
}

/**
 * Append row data ke Google Sheets
 * @param {Object} data - Data yang akan ditambahkan sebagai baris baru
 */
async function appendRow(data) {
  try {
    logger.info('Connecting to Google Sheets...');

    const authClient = getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // Dapatkan kolom dari sheet pertama jika kosong
    const response = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: config.googleSheetId,
      range: 'A1:Z1000', // Agak asumtif untuk header
    });

    const values = response.data.values;

    if (!values || values.length === 0) {
      logger.warn('Sheet is empty or no data found');
      return;
    }

    // Tentukan jumlah kolom berdasarkan header
    const numColumns = values[0].length;

    // Siapkan data baru
    const newRow = [];
    for (let i = 0; i < numColumns; i++) {
      newRow.push(data[String.fromCharCode(65 + i)] || null);
    }

    // Tambahkan baris baru
    logger.info('Appending new row to Google Sheets...');
    await sheets.spreadsheets.values.append({
      auth: authClient,
      spreadsheetId: config.googleSheetId,
      range: 'A2', // Mulai dari baris kedua setelah header
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] },
    });

    logger.info('Successfully appended row to Google Sheets');

  } catch (error) {
    logger.error(`Error appending to Google Sheets: ${error.message}`);
    throw error;
  }
}

module.exports = { appendRow };
