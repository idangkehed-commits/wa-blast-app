const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const SessionManager = require('./services/sessionManager');
const { parseExcelFile, parseManualContacts } = require('./services/contactService');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('=== WhatsApp Blast Server Starting ===');
console.log('[System] Node Version:', process.version);
console.log('[System] Environment PORT:', process.env.PORT);
console.log('[System] Active PORT:', PORT);

// Error handlers agar log Render jelas jika ada error
process.on('uncaughtException', (err) => {
  console.error('[Fatal Error] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal Error] unhandledRejection:', reason);
});

// Setup direktori upload & sessions (Mendukung Persistent Disk Render.com via DATA_DIR)
let BASE_DATA_DIR = __dirname;
if (process.env.DATA_DIR) {
  try {
    if (!fs.existsSync(process.env.DATA_DIR)) {
      fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    }
    fs.accessSync(process.env.DATA_DIR, fs.constants.W_OK);
    BASE_DATA_DIR = process.env.DATA_DIR;
  } catch (err) {
    console.warn(`[Warning] DATA_DIR (${process.env.DATA_DIR}) tidak dapat ditulis, fallback ke folder lokal:`, err.message);
    BASE_DATA_DIR = __dirname;
  }
}

const UPLOAD_DIR = path.join(BASE_DATA_DIR, 'uploads');
const SESSIONS_DIR = path.join(BASE_DATA_DIR, 'sessions');

try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) { console.warn('Warning create UPLOAD_DIR:', e.message); }

try {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
} catch (e) { console.warn('Warning create SESSIONS_DIR:', e.message); }

console.log(`[Storage] Base Directory: ${BASE_DATA_DIR}`);
console.log(`[Storage] Folder Sessions: ${SESSIONS_DIR}`);
console.log(`[Storage] Folder Uploads: ${UPLOAD_DIR}`);

const sessionManager = new SessionManager(SESSIONS_DIR);

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Max 50MB
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// SSE Clients map: sessionId -> Set of res
const sseClients = new Map();

function broadcastToSession(sessionId, event, data) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(message);
    } catch (err) {
      clients.delete(client);
    }
  }
}

// Helper middleware untuk resolve user session
app.use('/api', (req, res, next) => {
  const sessionId = req.headers['x-session-id'] || req.query.sessionId || req.body?.sessionId || 'default_user';
  req.sessionId = String(sessionId).trim();
  req.userSession = sessionManager.getOrCreateSession(req.sessionId);
  next();
});

// Health check endpoint untuk Render
app.get('/health', (req, res) => res.status(200).send('OK'));

// ==========================================
// ROUTES & API
// ==========================================

// 1. Endpoint SSE per pengguna (Real-time updates terisolasi)
app.get('/api/events', (req, res) => {
  const { sessionId, userSession } = req;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  const clientSet = sseClients.get(sessionId);
  clientSet.add(res);

  // Daftarkan listener spesifik untuk sesi ini jika belum ada
  if (!userSession._listenerAttached) {
    userSession._listenerAttached = true;
    userSession.waService.onStatusChange((statusData) => {
      broadcastToSession(sessionId, 'wa_status', statusData);
    });
    userSession.blastWorker.onUpdate((blastData) => {
      broadcastToSession(sessionId, 'blast_update', blastData);
    });
  }

  // Kirim status awal saat pertama kali buka
  const initialData = {
    wa: userSession.waService.getStatus(),
    blast: userSession.blastWorker.getStatus()
  };
  res.write(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`);

  req.on('close', () => {
    clientSet.delete(res);
    if (clientSet.size === 0) {
      sseClients.delete(sessionId);
    }
  });
});

// 2. Status WhatsApp
app.get('/api/status', (req, res) => {
  const { userSession } = req;
  res.json({
    wa: userSession.waService.getStatus(),
    blast: userSession.blastWorker.getStatus()
  });
});

// 3. Logout WhatsApp Sesi Ini
app.post('/api/logout', async (req, res) => {
  try {
    const { sessionId } = req;
    await sessionManager.deleteSession(sessionId);
    res.json({ success: true, message: 'Berhasil logout dari WhatsApp' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Hubungkan ulang WhatsApp
app.post('/api/reconnect', async (req, res) => {
  try {
    const { userSession } = req;
    await userSession.waService.init();
    res.json({ success: true, message: 'Menghubungkan ulang ke WhatsApp...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4b. Minta Kode Pairing (Tautan dengan nomor telepon)
app.post('/api/pairing-code', async (req, res) => {
  try {
    const { phone } = req.body;
    const code = await req.userSession.waService.getPairingCode(phone);
    res.json({ success: true, code });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 5. Upload & Parsing Excel / CSV
app.post('/api/parse-excel', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
  }

  try {
    const result = parseExcelFile(req.file.path);
    setTimeout(() => {
      try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (e) {}
    }, 1000);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membaca file: ' + err.message });
  }
});

// 6. Parsing Kontak Manual
app.post('/api/parse-manual', (req, res) => {
  const { text } = req.body;
  try {
    const result = parseManualContacts(text);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Upload Media
app.post('/api/upload-media', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'File media tidak ditemukan' });
  }
  res.json({
    success: true,
    file: {
      path: req.file.path,
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`
    }
  });
});

// 8. Mulai Blast
app.post('/api/blast/start', async (req, res) => {
  try {
    const { userSession } = req;
    const {
      contacts,
      messageTemplate,
      mediaFile,
      minDelay,
      maxDelay,
      batchSize,
      batchPauseMinutes,
      simulateTyping,
      verifyNumber,
      scheduledAt
    } = req.body;

    const result = await userSession.blastWorker.startJob({
      contacts,
      messageTemplate,
      mediaFile,
      minDelay,
      maxDelay,
      batchSize,
      batchPauseMinutes,
      simulateTyping,
      verifyNumber,
      scheduledAt
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 9. Kontrol Blast
app.post('/api/blast/pause', (req, res) => {
  const ok = req.userSession.blastWorker.pause();
  res.json({ success: ok, message: ok ? 'Blast dijeda' : 'Gagal menjeda' });
});

app.post('/api/blast/resume', (req, res) => {
  const ok = req.userSession.blastWorker.resume();
  res.json({ success: ok, message: ok ? 'Blast dilanjutkan' : 'Gagal melanjutkan' });
});

app.post('/api/blast/stop', (req, res) => {
  const ok = req.userSession.blastWorker.stop();
  res.json({ success: ok, message: ok ? 'Blast dihentikan' : 'Gagal menghentikan' });
});

// 10. Status Blast
app.get('/api/blast/status', (req, res) => {
  res.json(req.userSession.blastWorker.getStatus());
});

// 11. Unduh Laporan Excel
app.get('/api/blast/export', (req, res) => {
  try {
    const buffer = req.userSession.blastWorker.exportReportBuffer();
    const filename = `Laporan_WA_Blast_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membuat laporan: ' + err.message });
  }
});

// Jalankan Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🚀 WhatsApp Blast Web & PWA Multi-User Siap!`);
  console.log(`🌐 Akses Lokal: http://localhost:${PORT}`);
  console.log(`📱 Siap diinstall di HP via browser (Add to Home Screen)`);
  console.log(`=================================================`);
});
