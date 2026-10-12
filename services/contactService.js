const xlsx = require('xlsx');

/**
 * Normalisasi nomor HP Indonesia
 * Format yang didukung:
 * - 08123456789 -> 628123456789
 * - +628123456789 -> 628123456789
 * - 62812-3456-789 -> 628123456789
 * - 8123456789 -> 628123456789
 */
function normalizeIndonesianPhone(rawInput) {
  if (!rawInput) return { isValid: false, reason: 'Nomor kosong' };

  // Konversi ke string dan bersihkan karakter selain angka
  let cleaned = String(rawInput).trim().replace(/[^0-9]/g, '');

  if (!cleaned) {
    return { isValid: false, reason: 'Tidak ada digit angka' };
  }

  // Jika diawali 08... -> ganti 0 dengan 62
  if (cleaned.startsWith('08')) {
    cleaned = '62' + cleaned.substring(1);
  }
  // Jika diawali 8... -> tambahkan 62
  else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  // Jika diawali 6208... -> hapus angka 0 berlebih
  else if (cleaned.startsWith('6208')) {
    cleaned = '628' + cleaned.substring(4);
  }

  // Validasi: Harus diawali 628 (format seluler Indonesia)
  if (!cleaned.startsWith('628')) {
    return { 
      isValid: false, 
      phone: cleaned, 
      original: rawInput, 
      reason: 'Bukan nomor HP seluler Indonesia (harus diawali 08/628)' 
    };
  }

  // Validasi panjang digit nomor seluler Indonesia (biasanya 10 - 15 digit total termasuk 62)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return { 
      isValid: false, 
      phone: cleaned, 
      original: rawInput, 
      reason: `Panjang nomor tidak valid (${cleaned.length} digit, standar 10-15)` 
    };
  }

  return {
    isValid: true,
    phone: cleaned,
    original: rawInput,
    jid: `${cleaned}@s.whatsapp.net`
  };
}

/**
 * Deteksi kolom nomor telepon dan nama dari baris Excel
 */
function findColumnKey(keys, candidateList) {
  for (const candidate of candidateList) {
    const found = keys.find(k => k.trim().toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  // Coba partial match
  for (const candidate of candidateList) {
    const found = keys.find(k => k.trim().toLowerCase().includes(candidate.toLowerCase()));
    if (found) return found;
  }
  return null;
}

/**
 * Parsing file Excel (.xlsx, .xls) atau CSV
 */
function parseExcelFile(filePath) {
  const workbook = xlsx.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rows || rows.length === 0) {
    return {
      success: false,
      message: 'File Excel kosong atau tidak memiliki data.',
      contacts: [],
      availableFields: []
    };
  }

  const sampleRow = rows[0];
  const columnKeys = Object.keys(sampleRow);

  // Cari kolom telepon
  const phoneCandidates = [
    'nomor', 'no hp', 'nohp', 'no. hp', 'phone', 'whatsapp', 'wa', 
    'no_hp', 'telepon', 'telp', 'mobile', 'contact', 'no wa', 'handphone'
  ];
  let phoneKey = findColumnKey(columnKeys, phoneCandidates);

  // Jika belum ketemu dari header, tebak dari isi data baris pertama
  if (!phoneKey) {
    for (const key of columnKeys) {
      const val = String(sampleRow[key] || '');
      const test = normalizeIndonesianPhone(val);
      if (test.isValid) {
        phoneKey = key;
        break;
      }
    }
  }

  // Cari kolom nama
  const nameCandidates = [
    'nama', 'name', 'full name', 'fullname', 'nama lengkap', 
    'customer', 'pelanggan', 'pembeli', 'klien', 'client'
  ];
  const nameKey = findColumnKey(columnKeys, nameCandidates);

  if (!phoneKey) {
    return {
      success: false,
      message: 'Tidak ditemukan kolom nomor telepon/HP di file Excel. Pastikan ada header seperti "Nomor", "No HP", atau "WhatsApp".',
      detectedColumns: columnKeys
    };
  }

  const validContacts = [];
  const invalidContacts = [];
  const seenPhones = new Set();
  let duplicateCount = 0;

  rows.forEach((row, index) => {
    const rawPhone = row[phoneKey];
    const norm = normalizeIndonesianPhone(rawPhone);

    if (!norm.isValid) {
      if (rawPhone) {
        invalidContacts.push({
          row: index + 2,
          rawPhone,
          reason: norm.reason
        });
      }
      return;
    }

    // Cek duplikasi
    if (seenPhones.has(norm.phone)) {
      duplicateCount++;
      return;
    }
    seenPhones.add(norm.phone);

    // Ambil nama
    const name = nameKey && row[nameKey] ? String(row[nameKey]).trim() : 'Bapak/Ibu';

    // Simpan semua kolom untuk custom tags {kolom}
    const customFields = {};
    for (const key of columnKeys) {
      const cleanKey = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      customFields[cleanKey] = row[key];
    }

    validContacts.push({
      phone: norm.phone,
      name: name,
      jid: norm.jid,
      original: norm.original,
      customFields: customFields
    });
  });

  return {
    success: true,
    totalRows: rows.length,
    validContacts,
    invalidContacts,
    duplicateCount,
    detectedPhoneColumn: phoneKey,
    detectedNameColumn: nameKey || '(Default: Bapak/Ibu)',
    availableFields: columnKeys.map(k => k.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  };
}

/**
 * Parsing teks nomor manual (bisa per baris, koma, atau format: 081234567, Nama)
 */
function parseManualContacts(rawText) {
  if (!rawText || !rawText.trim()) {
    return { validContacts: [], invalidContacts: [], duplicateCount: 0 };
  }

  const lines = rawText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const validContacts = [];
  const invalidContacts = [];
  const seenPhones = new Set();
  let duplicateCount = 0;

  lines.forEach((line, index) => {
    let rawPhone = line;
    let name = 'Bapak/Ibu';

    // Cek jika user memasukkan "0812345678, Budi" atau "0812345678; Budi" atau "0812345678 - Budi"
    if (line.includes(',') || line.includes(';') || line.includes('-') && !line.startsWith('0812-')) {
      const parts = line.split(/[,;\t]/);
      if (parts.length >= 2) {
        // Cek mana yang nomor dan mana yang nama
        const part0Norm = normalizeIndonesianPhone(parts[0]);
        const part1Norm = normalizeIndonesianPhone(parts[1]);

        if (part0Norm.isValid) {
          rawPhone = parts[0];
          name = parts.slice(1).join(' ').trim();
        } else if (part1Norm.isValid) {
          rawPhone = parts[1];
          name = parts[0].trim();
        }
      }
    }

    const norm = normalizeIndonesianPhone(rawPhone);
    if (!norm.isValid) {
      invalidContacts.push({
        line: index + 1,
        raw: line,
        reason: norm.reason
      });
      return;
    }

    if (seenPhones.has(norm.phone)) {
      duplicateCount++;
      return;
    }
    seenPhones.add(norm.phone);

    validContacts.push({
      phone: norm.phone,
      name: name || 'Bapak/Ibu',
      jid: norm.jid,
      original: line,
      customFields: {
        nama: name || 'Bapak/Ibu',
        nomor: norm.phone
      }
    });
  });

  return {
    validContacts,
    invalidContacts,
    duplicateCount,
    totalLines: lines.length
  };
}

module.exports = {
  normalizeIndonesianPhone,
  parseExcelFile,
  parseManualContacts
};
