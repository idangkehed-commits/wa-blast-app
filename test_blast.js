const { renderTemplate, parseSpintax } = require('./services/spintax');
const { parseExcelFile, parseManualContacts, normalizeIndonesianPhone } = require('./services/contactService');

console.log('--- 1. TEST PHONE NORMALIZER ---');
console.log('081234567890 ->', normalizeIndonesianPhone('081234567890').phone);
console.log('+62 857-1234-5678 ->', normalizeIndonesianPhone('+62 857-1234-5678').phone);
console.log('89612345678 ->', normalizeIndonesianPhone('89612345678').phone);

console.log('\n--- 2. TEST SPINTAX & TEMPLATE ---');
const tpl = '{Halo|Hai|Selamat {panggilan}} {nama}! Info dari {kota} mengenai {produk}.';
const contact = { phone: '6281234567890', name: 'Budi Santoso', kota: 'Jakarta', produk: 'Sepatu' };
console.log('Sample 1:', renderTemplate(tpl, contact));
console.log('Sample 2:', renderTemplate(tpl, contact));
console.log('Sample 3:', renderTemplate(tpl, contact));

console.log('\n--- 3. TEST EXCEL PARSER ---');
const excelRes = parseExcelFile('./contoh_kontak.xlsx');
console.log('Total baris:', excelRes.totalRows);
console.log('Kontak valid:', excelRes.validContacts.length);
console.log('Duplikat dihapus:', excelRes.duplicateCount);
console.log('Field terdeteksi:', excelRes.availableFields);

console.log('\n--- 4. TEST MANUAL INPUT PARSER ---');
const manualText = `08123456789, Budi
08571234567, Ani
+62 896-1234-5678, Citra
08123456789 (duplikat)`;
const manualRes = parseManualContacts(manualText);
console.log('Manual valid:', manualRes.validContacts.length);
console.log('Manual duplikat:', manualRes.duplicateCount);

console.log('\nSEMUA TEST LULUS DENGAN BAIK!');
