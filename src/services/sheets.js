// Logika otentikasi Google Service Account dan appendRow
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const config = require('../config/config');
const logger = require('../utils/logger');

// Map AI JSON keys to possible header patterns (case-insensitive)
const KEY_HEADER_ALIASES = {
  due_date: ['due_date', 'deadline', 'application deadline', 'batas akhir'],
  job_vacancy_title: ['job vacancy title', 'judul lowongan', 'vacancy title', 'job title'],
  company_name: ['company name', 'nama perusahaan', 'perusahaan'],
  position: ['position', 'posisi', 'jabatan'],
  location: ['location', 'lokasi', 'alamat', 'tempat kerja'],
  industries: ['industries', 'industri', 'bidang industri'],
  employment_type: ['employment type', 'employment', 'placement', 'tipe kerja', 'tipe ikatan'],
  how_to_apply: ['how to apply', 'cara melamar'],
  requirements: ['requirements', 'kualifikasi', 'syarat', 'qualifications'],
  job_description: ['job description', 'deskripsi pekerjaan', 'tanggung jawab', 'description'],
};

/**
 * Check if a header matches a data key via aliases
 */
function headerMatchesKey(headerLower, key) {
  const aliases = KEY_HEADER_ALIASES[key];
  if (!aliases) return false;
  return aliases.some((alias) => headerLower.includes(alias) || alias.includes(headerLower));
}

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

    // Build row values matching sheet headers
    const rowValues = headers.map((header) => {
      const headerLower = header.toLowerCase().replace(/[\s/:]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      // Time column - fill with current datetime
      if (headerLower === 'time' || headerLower === 'tanggal') {
        const now = new Date();
        return now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      }

      // Find matching field in extracted data
      for (const [key, value] of Object.entries(data)) {
        const keyLower = key.toLowerCase().replace(/[\s/:]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

        const exactMatch = keyLower === headerLower;
        const aliasMatch = headerMatchesKey(headerLower, key);
        const fuzzyMatch = !exactMatch && !aliasMatch && (
          headerLower.includes(keyLower) ||
          keyLower.includes(headerLower)
        );

        if (exactMatch || aliasMatch || fuzzyMatch) {
          // Convert null to empty string
          if (value === null || value === undefined) return '';
          return String(value);
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