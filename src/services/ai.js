// Logika instansiasi client OpenAI dan fungsi image-to-text
const fs = require('fs');
const config = require('../config/config');
const logger = require('../utils/logger');

// Section labels untuk parsing hasil
const FIELDS = [
  'Company',
  'Title',
  'Position',
  'Location',
  'Industries',
  'Type of Work',
  'Due date',
  'Apply Via',
  'Requirements',
  'Jobdesc',
];

const SYSTEM_PROMPT = `Analisis gambar poster lowongan pekerjaan ini (bisa dalam Bahasa Indonesia atau Bahasa Inggris). Ekstrak informasi yang tersedia dan kembalikan HANYA dalam format JSON yang valid.
          Gambar bisa multi-halaman poster yang sama; gabungkan info dari semua halaman, jangan tebak field yang tidak ada di salah satu halaman.
          Ketentuan Pengisian Field:
          1. Jika suatu field TIDAK ditemukan atau kosong di dalam poster, isi nilainya dengan null (jangan dikosongkan, jangan dihapus field-nya, dan jangan menebak-nebak).
          2. Tulis nilai apa adanya sesuai yang tertera di poster.
          3. Anda WAJIB mengembalikan output HANYA berupa raw string JSON yang valid.
          4. JANGAN sertakan teks pembuka/penutup, JANGAN sertakan penjelasan apa pun, dan JANGAN gunakan format markdown backtick seperti \`\`\`json ... \`\`\`.
          5. Jika terdapat link yang dibuat barcode, baca barcode tersebut untuk dimasukkan ke dalam struktur JSON terkait
          6. Format kolom "Due date" HARUS dalam format dd-mm-yyyy (contoh: 15-07-2024). Jika tanggal dalam format lain, ubah ke dd-mm-yyyy.
          Struktur JSON yang WAJIB Anda ikuti, jangan ubah nama property. Ikuti sama persis format ini dengan nama property yang sudah ditentukan:
          {
            "Due date": "Tanggal batas akhir pendaftaran, isi null jika tidak tertera",
            "Title": "Judul atau nama lowongan pekerjaan utama",
            "Company": "Nama perusahaan yang membuka lowongan",
            "Position": "Posisi atau jabatan yang dicari",
            "Location": "Lokasi kerja atau alamat kantor perusahaan",
            "Industries": "Sektor industri perusahaan berdasarkan IDX-IC (Indonesia Stock Exchange Industrial Classification). Pilih SALAH SATU dari 12 sektor berikut yang paling sesuai: Energy, Basic Materials, Industrials, Consumer Non-Cyclicals, Consumer Cyclicals, Healthcare, Financials, Infrastructure, Technology, Transportation & Logistics, Properties & Real Estate, Investment Services. Jika perusahaan bukan emiten publik, tetap cari tahu sektor yang paling sesuai dengan bisnis intinya.",
            "Type of Work": "Tipe ikatan kerja, misal: Full-time, Part-time, Internship, Contract. Isi null jika tidak ada",
            "Apply Via": "Cara melamar, seperti alamat email, link website, atau nomor WhatsApp pendaftaran, jika ada QR-Code scan dan berikan link tersebut",
            "Requirements": [
              "Kualifikasi atau syarat pelamar 1",
              "Kualifikasi atau syarat pelamar 2 (buat dalam bentuk array/list string, jika tidak ada buat menjadi array kosong [])"
            ],
            "Jobdesc": [
              "Deskripsi pekerjaan atau tanggung jawab 1",
              "Deskripsi pekerjaan atau tanggung jawab 2 (buat dalam bentuk array/list string, jika tidak ada buat menjadi array kosong [])"
            ]
          }`;

/**
 * Ekstraksi teks dari gambar (tunggal atau multi) menggunakan model AI via fetch langsung
 * @param {string|string[]} filePathOrPaths - Path file gambar, atau array path
 * @returns {Promise<Object>} Data yang diekstraksi
 */
function mimeFromPath(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function extractContentFromApiResponse(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  // Non-stream JSON (OpenAI default, OpenRouter, banyak proxy)
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content) return content;
      // Beberapa proxy pakai text / output
      if (typeof data?.choices?.[0]?.text === 'string') return data.choices[0].text;
      if (typeof data?.content === 'string') return data.content;
    } catch (e) {
      logger.warn(`Non-stream JSON parse failed: ${e.message}`);
    }
  }

  // SSE stream: data: {chunk}\n\ndata: [DONE]
  let extractedText = '';
  for (const line of rawText.split('\n')) {
    const lineTrim = line.trim();
    if (!lineTrim || lineTrim === 'data: [DONE]') continue;
    if (!lineTrim.startsWith('data: ')) continue;
    try {
      const chunk = JSON.parse(lineTrim.slice(6));
      const choice = chunk?.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) extractedText += choice.delta.content;
      if (choice.message?.content) {
        extractedText = choice.message.content;
        break;
      }
    } catch (e) {
      logger.warn(`Failed to parse SSE chunk: ${e.message}`);
    }
  }
  return extractedText;
}

function toImageContent(filePath) {
  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString('base64');
  const mime = mimeFromPath(filePath);
  logger.info(`Image ${filePath}: ${(imageBuffer.length / 1024).toFixed(1)}KB, mime: ${mime}`);
  return {
    type: 'image_url',
    image_url: { url: `data:${mime};base64,${base64Image}` },
  };
}

async function extractTextFromImage(filePathOrPaths) {
  try {
    const paths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
    if (paths.length === 0) throw new Error('No image paths provided');

    logger.info(`Extracting text from ${paths.length} image(s)`);

    const imageContents = paths.map(toImageContent);
    const url = `${config.aiBaseUrl.replace(/\/$/, '')}/chat/completions`;

    const body = JSON.stringify({
      model: config.aiModel,
      stream: false,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: imageContents,
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
    let extractedText = extractContentFromApiResponse(rawText);

    if (!extractedText) {
      logger.error(`Empty AI content. Raw head: ${rawText.slice(0, 500)}`);
      throw new Error('AI returned empty content (response format mismatch or model no vision)');
    }

    // Clean markdown code blocks if AI wraps response in ```json
    extractedText = extractedText.replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim();

    logger.info('AI extraction complete, parsing JSON...');

    let result;
    try {
      result = JSON.parse(extractedText);

      // Fallback: Position → Title jika Position kosong
      if (!result['Position'] || result['Position'] === '' || result['Position'] === null) {
        result['Position'] = result['Title'] || '-';
        if (result['Position'] === '-') logger.info('Position empty, Title also empty, used default');
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
