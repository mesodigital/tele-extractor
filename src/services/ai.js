// Logika instansiasi client OpenAI dan fungsi image-to-text
const fs = require('fs');
const config = require('../config/config');
const logger = require('../utils/logger');

// Section labels untuk parsing hasil
const FIELDS = [
  'Company Name',
  'Job Vacancy Title',
  'Position',
  'Placement / Employment Type',
  'Job Description',
  'Requirements / Qualifications',
  'Benefits / Facilities',
  'How to Apply',
  'Contact Information',
  'Application Deadline',
  'Additional Notes',
];

/**
 * Ekstraksi teks dari gambar menggunakan model AI via fetch langsung
 * @param {string} filePath - Path ke file gambar
 * @returns {Promise<Object>} Data yang diekstraksi
 */
async function extractTextFromImage(filePath) {
  try {
    logger.info(`Extracting text from ${filePath}`);

    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    logger.info(`Image size: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

    const url = `${config.aiBaseUrl}/chat/completions`;

    const body = JSON.stringify({
      model: config.aiModel,
      messages: [
        {
          role: 'system',
          content: `Analisis gambar poster lowongan pekerjaan ini (bisa dalam Bahasa Indonesia atau Bahasa Inggris). Ekstrak informasi yang tersedia dan kembalikan HANYA dalam format JSON yang valid.
          Ketentuan Pengisian Field:
          1. Jika suatu field TIDAK ditemukan atau kosong di dalam poster, isi nilainya dengan null (jangan dikosongkan, jangan dihapus field-nya, dan jangan menebak-nebak).
          2. Tulis nilai apa adanya sesuai yang tertera di poster.
          3. Anda WAJIB mengembalikan output HANYA berupa raw string JSON yang valid.
          4. JANGAN sertakan teks pembuka/penutup, JANGAN sertakan penjelasan apa pun, dan JANGAN gunakan format markdown backtick seperti \`\`\`json ... \`\`\`.
          5. Jika terdapat link yang dibuat barcode, baca barcode tersebut untuk dimasukkan ke dalam struktur JSON terkait
          Struktur JSON yang WAJIB Anda ikuti:
          {
            "due_date": "Tanggal batas akhir pendaftaran, isi null jika tidak tertera",
            "job_vacancy_title": "Judul atau nama lowongan pekerjaan utama",
            "company_name": "Nama perusahaan yang membuka lowongan",
            "position": "Posisi atau jabatan yang dicari",
            "location": "Lokasi kerja atau alamat kantor perusahaan",
            "industries": "Bidang industri perusahaan (misal: IT, F&B, Edukasi, dll)",
            "employment_type": "Tipe ikatan kerja, misal: Full-time, Part-time, Internship, Contract. Isi null jika tidak ada",
            "how_to_apply": "Cara melamar, seperti alamat email, link website, atau nomor WhatsApp pendaftaran",
            "requirements": [
              "Kualifikasi atau syarat pelamar 1",
              "Kualifikasi atau syarat pelamar 2 (buat dalam bentuk array/list string, jika tidak ada buat menjadi array kosong [])"
            ],
            "job_description": [
              "Deskripsi pekerjaan atau tanggung jawab 1",
              "Deskripsi pekerjaan atau tanggung jawab 2 (buat dalam bentuk array/list string, jika tidak ada buat menjadi array kosong [])"
            ]
          }`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          ],
        },
      ],
      temperature: 0.3,
    });

    logger.debug(`Sending request to ${url} with model ${config.aiModel}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.aiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`AI API error: ${response.status} ${response.statusText}`);
      logger.error(`Response body: ${errorBody}`);
      throw new Error(`AI API returned ${response.status}: ${response.statusText}`);
    }

    const rawText = await response.text();
    // API appends data: [DONE] directly after JSON (no newline)
    const jsonStr = rawText.replace(/data:\s*\[DONE\]\s*$/, '');
    const data = JSON.parse(jsonStr);
    let extractedText = data.choices[0].message.content;

    // Clean markdown code blocks if AI wraps response in ```json
    extractedText = extractedText.replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim();

    logger.info('AI extraction complete, parsing JSON...');

    let result;
    try {
      result = JSON.parse(extractedText);

      // Fallback: position → job_vacancy_title jika position kosong
      if (!result.position || result.position === '' || result.position === null) {
        result.position = result.job_vacancy_title;
        logger.info('Position empty, fell back to job_vacancy_title');
      }
    } catch (e) {
      logger.warn(`JSON parse failed, falling back to text parsing: ${e.message}`);
      result = parseStructuredText(extractedText);
    }

    logger.info('Successfully extracted data from image');
    return result;

  } catch (error) {
    logger.error(`Error during AI extraction: ${error.message}`);
    throw error;
  }
}

/**
 * Parsing plain text terstruktur menjadi object
 */
function parseStructuredText(text) {
  const result = {};

  for (let i = 0; i < FIELDS.length; i++) {
    const field = FIELDS[i];
    const nextField = FIELDS[i + 1];
    const pattern = nextField
      ? new RegExp(`${escapeRegex(field)}\\s*:\\s*([\\s\\S]*?)(?=${escapeRegex(nextField)}\\s*:|$)`, 'i')
      : new RegExp(`${escapeRegex(field)}\\s*:\\s*([\\s\\S]*)`, 'i');
    const match = text.match(pattern);
    if (match) {
      const key = field.toLowerCase().replace(/[^a-z]/g, '_').replace(/_+/g, '_');
      result[key] = match[1].trim();
    }
  }

  if (Object.keys(result).length === 0) {
    return { raw_text: text };
  }

  // Convert arrays to newline-separated strings for consistent output
  for (const key of Object.keys(result)) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].join('\n');
    }
  }

  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { extractTextFromImage };
