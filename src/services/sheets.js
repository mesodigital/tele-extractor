// Logika otentikasi Google Service Account dan appendRow
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Append row data ke Google Sheets
 * @param {Object} data - Data yang akan ditambahkan sebagai baris baru
 */
async function appendRow(data) {
  try {
    logger.info('Connecting to Google Sheets...');

    const serviceAccountAuth = new JWT({
      email: config.googleServiceAccountEmail,
      key: config.googlePrivateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(config.googleSheetId, serviceAccountAuth);

    await doc.loadInfo();

    // Use first sheet
    const sheet = doc.sheetsByIndex[0];
    if (!sheet) {
      logger.warn('No sheets found in spreadsheet');
      return;
    }

    // Load header row to determine column mapping
    await sheet.loadHeaderRow();
    const headers = sheet.headerValues;

    // Map extracted data to match sheet headers (case-insensitive)
    const rowValues = headers.map((header) => {
      const headerLower = header.toLowerCase().replace(/[:\s]+/g, '');

      // Find matching field in extracted data
      for (const [key, value] of Object.entries(data)) {
        const keyLower = key.toLowerCase().replace(/[:\s]+/g, '');

        // Direct match or header starts/ends with key
        if (
          keyLower === headerLower ||
          headerLower.includes(keyLower) ||
          keyLower.includes(headerLower)
        ) {
          return value;
        }
      }

      // No match found, leave empty
      return '';
    });

    // Append row
    logger.info('Appending new row to Google Sheets...');
    await sheet.addRow(rowValues);

    logger.info('Successfully appended row to Google Sheets');

  } catch (error) {
    logger.error(`Error appending to Google Sheets: ${error.message}`);
    throw error;
  }
}

module.exports = { appendRow };
