/**
 * Spintax & Template Engine
 * Membantu membuat variasi pesan unik per kontak agar tidak terdeteksi spam.
 */

// Menghitung ucapan waktu Indonesia
function getIndonesianTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 11) return 'Pagi';
  if (hour >= 11 && hour < 15) return 'Siang';
  if (hour >= 15 && hour < 18) return 'Sore';
  return 'Malam';
}

// Memproses spintax format {pilihan1|pilihan2|pilihan3}
function parseSpintax(text) {
  if (!text) return '';
  // Hanya cari kurung kurawal yang mengandung karakter pipa '|'
  const spintaxRegex = /\{([^{}]*\|[^{}]*)\}/;
  let result = text;
  let maxLoop = 50; // Safety guard terhadap infinite loop

  while (spintaxRegex.test(result) && maxLoop > 0) {
    maxLoop--;
    result = result.replace(spintaxRegex, (match, group) => {
      const choices = group.split('|');
      const randomChoice = choices[Math.floor(Math.random() * choices.length)];
      return randomChoice.trim();
    });
  }

  return result;
}

// Mengganti variabel template: {nama}, {nomor}, {panggilan}, dan kolom custom Excel
function renderTemplate(template, contactData = {}) {
  if (!template) return '';

  // 1. Siapkan data default
  const now = new Date();
  const defaultVars = {
    panggilan: getIndonesianTimeGreeting(),
    tanggal: now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    waktu: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    nomor: contactData.phone || '',
    nama: contactData.name || 'Bapak/Ibu'
  };

  const merged = { ...defaultVars, ...contactData };

  // 2. Ganti semua placeholder {kunci} terlebih dahulu
  let message = template;
  for (const [key, val] of Object.entries(merged)) {
    if (val !== undefined && val !== null) {
      const reg = new RegExp(`\\{${key}\\}`, 'gi');
      message = message.replace(reg, String(val));
    }
  }

  // 3. Eksekusi spintax pada pesan yang sudah diisi variabel
  message = parseSpintax(message);

  return message;
}

module.exports = {
  parseSpintax,
  renderTemplate,
  getIndonesianTimeGreeting
};
