// Fungsi helper (misal: membersihkan file di /tmp)
const fs = require('fs').promises;
const logger = require('./logger');

async function unlinkAsync(filePath) {
  try {
    await fs.unlink(filePath);
    logger.info(`Successfully deleted file: ${filePath}`);
  } catch (error) {
    logger.error(`Error deleting file ${filePath}: ${error.message}`);
  }
}

module.exports = {
  unlinkAsync,
};
