const path = require('path');
const fs = require('fs');
const WhatsAppService = require('./waService');
const BlastWorker = require('./blastWorker');

class SessionManager {
  constructor(baseSessionsDir) {
    this.baseSessionsDir = baseSessionsDir || path.join(__dirname, '../sessions');
    this.sessions = new Map(); // sessionId -> { waService, blastWorker, lastActive }

    if (!fs.existsSync(this.baseSessionsDir)) {
      fs.mkdirSync(this.baseSessionsDir, { recursive: true });
    }
  }

  // Mendapatkan atau membuat sesi baru untuk setiap pengguna
  getOrCreateSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID diperlukan');
    }

    // Bersihkan karakter aneh pada sessionId agar aman untuk nama folder
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
    if (!safeSessionId) {
      throw new Error('Session ID tidak valid');
    }

    if (this.sessions.has(safeSessionId)) {
      const session = this.sessions.get(safeSessionId);
      session.lastActive = Date.now();
      return session;
    }

    const authDir = path.join(this.baseSessionsDir, safeSessionId);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const waService = new WhatsAppService(authDir);
    const blastWorker = new BlastWorker(waService);

    const sessionObj = {
      id: safeSessionId,
      waService,
      blastWorker,
      lastActive: Date.now()
    };

    this.sessions.set(safeSessionId, sessionObj);

    // Inisialisasi koneksi WA secara otomatis untuk sesi ini
    waService.init();

    return sessionObj;
  }

  // Menghapus sesi (saat logout)
  async deleteSession(sessionId) {
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (this.sessions.has(safeSessionId)) {
      const session = this.sessions.get(safeSessionId);
      try {
        await session.waService.logout();
      } catch (err) {
        console.warn(`Error logout sesi ${safeSessionId}:`, err.message);
      }
      this.sessions.delete(safeSessionId);
    }

    // Hapus folder credential
    const authDir = path.join(this.baseSessionsDir, safeSessionId);
    if (fs.existsSync(authDir)) {
      try {
        fs.rmSync(authDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }

  // Mendapatkan semua sesi aktif
  getActiveCount() {
    return this.sessions.size;
  }
}

module.exports = SessionManager;
