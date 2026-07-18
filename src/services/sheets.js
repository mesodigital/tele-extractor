// Logika otentikasi Google Service Account dan appendRow
// Lazy-load Google libs saat append — hemat RSS idle
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
 * Format date string to yyyy-mm-dd (ISO date) so Google Sheets auto-detects as date
 */
function formatDateToSheets(value) {
  if (!value || value === null) return '';
  const str = String(value).trim();
  if (!str) return '';

  let date = null;

  // Already yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    date = new Date(str + 'T00:00:00');
    if (!isNaN(date.getTime())) return str;
  }

  // dd-mm-yyyy or d-m-yyyy
  const dashMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    date = new Date(parseInt(dashMatch[3]), parseInt(dashMatch[2]) - 1, parseInt(dashMatch[1]));
  }

  // dd/mm/yyyy or d/m/yyyy
  if (!date) {
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      date = new Date(parseInt(slashMatch[3]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[1]));
    }
  }

  // yyyy-mm-dd (already checked above, but catch other variations)
  if (!date) {
    const revMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (revMatch) {
      date = new Date(parseInt(revMatch[1]), parseInt(revMatch[2]) - 1, parseInt(revMatch[3]));
    }
  }

  // dd Month yyyy (e.g., 15 Juli 2024, 15 July 2024)
  if (!date) {
    const textMatch = str.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
    if (textMatch) {
      date = new Date(textMatch[3] + ' ' + textMatch[2] + ' ' + textMatch[1]);
    }
  }

  if (date && !isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Fallback: try native Date parse
  const nativeDate = new Date(str);
  if (!isNaN(nativeDate.getTime())) {
    const y = nativeDate.getFullYear();
    const m = String(nativeDate.getMonth() + 1).padStart(2, '0');
    const d = String(nativeDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return str;
}

/**
 * Format current time to yyyy-mm-dd hh:mm so Google Sheets auto-detects as date
 */
function getCurrentTimeFormatted() {
  const now = new Date();
  // Jakarta is UTC+7, no DST. Add 7h to Unix timestamp directly.
  const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = jakarta.getUTCFullYear();
  const m = String(jakarta.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jakarta.getUTCDate()).padStart(2, '0');
  const hh = String(jakarta.getUTCHours()).padStart(2, '0');
  const mm = String(jakarta.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

/**
 * Append row data ke Google Sheets
 * @param {Object} data - Data yang akan ditambahkan sebagai baris baru
 */
async function appendRow(data) {
  return withMutex(async () => {
    try {
      // Validate required fields
      if (!data || data.Company === null || data.Company === undefined || data.Company === '' ||
          data.Position === null || data.Position === undefined || data.Position === '') {
        throw new Error('Output must contain "Company" and "Position" fields');
      }

      logger.info('Connecting to Google Sheets...');

      const { GoogleSpreadsheet } = require('google-spreadsheet');
      const { JWT } = require('google-auth-library');

      const serviceAccountAuth = new JWT({
        email: config.googleServiceAccountEmail,
        key: config.googlePrivateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const doc = new GoogleSpreadsheet(config.googleSheetId, serviceAccountAuth);

      await doc.loadInfo();

      // Find sheet by name (from GOOGLE_SHEET_NAME), fallback to first sheet
      let sheet = doc.sheetsByTitle[config.googleSheetName];
      if (!sheet) {
        logger.warn(`Sheet "${config.googleSheetName}" not found, using first sheet`);
        sheet = doc.sheetsByIndex[0];
      }
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

        // Time column - fill with current datetime (yyyy-mm-dd hh:mm)
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
            if (value === null || value === undefined) {
              // Default 'On-site' for Type of Work when not in poster
              if (key === 'Type of Work') return 'On-site';
              return '';
            }

            // Format Due date to yyyy-mm-dd for Sheets auto-detection
            if (key === 'Due date') {
              return formatDateToSheets(value);
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