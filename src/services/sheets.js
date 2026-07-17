// Logika otentikasi Google Service Account dan appendRow
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const config = require('../config/config');
const logger = require('../utils/logger');

// Simple mutex to serialize sheet append operations (prevents duplicate No on concurrent submits)
let appendQueue = Promise.resolve();

function withMutex(fn) {
  return new Promise((resolve, reject) => {
    appendQueue = appendQueue.then(() => fn().then(resolve, reject));
  });
}

// Map AI JSON keys to possible header patterns (case-insensitive)
const KEY_HEADER_ALIASES = {
  'Due date': ['due date', 'deadline', 'application deadline', 'batas akhir'],
  Title: ['title', 'judul lowongan', 'vacancy title', 'job title', 'job vacancy title'],
  Company: ['company', 'company name', 'nama perusahaan', 'perusahaan'],
  Position: ['position', 'posisi', 'jabatan'],
  Location: ['location', 'lokasi', 'alamat', 'tempat kerja'],
  Industries: ['industries', 'industri', 'bidang industri', 'sektor'],
  'Type of Work': ['type of work', 'employment type', 'employment', 'placement', 'tipe kerja', 'tipe ikatan'],
  source_link: ['source link', 'link', 'url', 'sumber', 'source'],
  'Apply Via': ['apply via', 'how to apply', 'cara melamar'],
  Requirements: ['requirements', 'kualifikasi', 'syarat', 'qualifications'],
  Jobdesc: ['jobdesc', 'job description', 'deskripsi pekerjaan', 'tanggung jawab', 'description'],
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
 * Format date string to dd-mm-yyyy
 */
function formatDateToDDMMYYYY(value) {
  if (!value || value === null) return '';
  const str = String(value).trim();
  if (!str) return '';

  // Already dd-mm-yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;

  // Try parsing common formats
  let date = null;

  // dd/mm/yyyy or d/m/yyyy
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    date = new Date(parseInt(slashMatch[3]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[1]));
  }

  // yyyy-mm-dd
  const dashMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    date = new Date(parseInt(dashMatch[1]), parseInt(dashMatch[2]) - 1, parseInt(dashMatch[3]));
  }

  // dd Month yyyy (e.g., 15 Juli 2024, 15 July 2024)
  const textMatch = str.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (textMatch) {
    date = new Date(textMatch[3] + ' ' + textMatch[2] + ' ' + textMatch[1]);
  }

  if (date && !isNaN(date.getTime())) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
  }

  // Fallback: try native Date parse
  const nativeDate = new Date(str);
  if (!isNaN(nativeDate.getTime())) {
    const d = String(nativeDate.getDate()).padStart(2, '0');
    const m = String(nativeDate.getMonth() + 1).padStart(2, '0');
    const y = nativeDate.getFullYear();
    return `${d}-${m}-${y}`;
  }

  return str;
}

/**
 * Format current time to dd-mm-yyyy hh:mm WIB
 */
function getCurrentTimeFormatted() {
  const now = new Date();
  // Convert to Asia/Jakarta (UTC+7)
  const jakartaOffset = 7 * 60;
  const localOffset = now.getTimezoneOffset();
  const jakarta = new Date(now.getTime() + (localOffset + jakartaOffset) * 60000);
  const d = String(jakarta.getUTCDate()).padStart(2, '0');
  const m = String(jakarta.getUTCMonth() + 1).padStart(2, '0');
  const y = jakarta.getUTCFullYear();
  const hh = String(jakarta.getUTCHours()).padStart(2, '0');
  const mm = String(jakarta.getUTCMinutes()).padStart(2, '0');
  return `${d}-${m}-${y} ${hh}:${mm}`;
}

/**
 * Append row data ke Google Sheets
 * @param {Object} data - Data yang akan ditambahkan sebagai baris baru
 */
async function appendRow(data) {
  return withMutex(async () => {
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

      // Default column headers untuk sheet baru
      const DEFAULT_HEADERS = [
        'No', 'Time', 'Due date', 'Title', 'Company', 'Position', 'Location',
        'Industries', 'Type of Work', 'Apply Via', 'Requirements', 'Jobdesc',
        'Status', 'Source Link',
      ];

      // Load header row, set default jika kosong
      let headers;
      try {
        await sheet.loadHeaderRow();
        headers = sheet.headerValues;
      } catch (e) {
        logger.warn('Header row empty, setting default headers...');
        await sheet.setHeaderRow(DEFAULT_HEADERS);
        headers = DEFAULT_HEADERS;
      }

      // Hitung nomor urut (row 1 header, row 2 = No 1, dst)
      let nextNo = 1;
      try {
        const rows = await sheet.getRows();
        // getRows() returns rows from row 2 onward (header row 1 excluded).
        // So rows.length is the actual data count.
        nextNo = rows.length + 1;
      } catch (e) {
        logger.warn(`Could not count rows, starting No at 1: ${e.message}`);
      }

      // Build row values matching sheet headers
      const rowValues = headers.map((header) => {
        const headerLower = header.toLowerCase().replace(/[\s/:]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

        // No column - auto number
        if (headerLower === 'no' || headerLower === 'nomor' || headerLower === 'number') {
          return String(nextNo);
        }

        // Time column - fill with current datetime (dd-mm-yyyy hh:mm)
        if (headerLower === 'time' || headerLower === 'tanggal' || headerLower === 'waktu') {
          return getCurrentTimeFormatted();
        }

        // Status column - default "Pending"
        if (headerLower === 'status') {
          return 'Pending';
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
            if (value === null || value === undefined) return '';

            // Format Due date to dd-mm-yyyy
            if (key === 'Due date') {
              return formatDateToDDMMYYYY(value);
            }

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
  });
}

module.exports = { appendRow };