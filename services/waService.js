const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

let baileysModule = null;
async function getBaileys() {
  if (!baileysModule) {
    baileysModule = await import('@whiskeysockets/baileys');
  }
  return baileysModule;
}

class WhatsAppService {
  constructor(authDir) {
    this.authDir = authDir || path.join(__dirname, '../auth_info_baileys');
    this.sock = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.connectedUser = null;
    this.eventListeners = [];
    this.isReconnecting = false;
  }

  // Registrasi event listener untuk SSE / Server update
  onStatusChange(callback) {
    this.eventListeners.push(callback);
  }

  notifyStatus() {
    const payload = {
      status: this.connectionStatus,
      qr: this.qrDataUrl,
      pairingCode: this.pairingCode,
      user: this.connectedUser
    };
    for (const listener of this.eventListeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error on status listener:', err);
      }
    }
  }

  async init() {
    try {
      const baileys = await getBaileys();
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners();
          this.sock.end(undefined);
        } catch (e) {
          // ignore
        }
        this.sock = null;
      }

      if (!fs.existsSync(this.authDir)) {
        fs.mkdirSync(this.authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.connectionStatus = 'connecting';
      this.notifyStatus();

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async () => undefined,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
            this.connectionStatus = 'connecting';
            this.notifyStatus();
          } catch (qrErr) {
            console.error('Gagal generate QR code:', qrErr);
          }
        }

        if (connection === 'open') {
          this.connectionStatus = 'connected';
          this.qrDataUrl = null;
          this.pairingCode = null;
          const userJid = this.sock.user?.id || '';
          const userPhone = userJid.split(':')[0] || userJid.split('@')[0];
          this.connectedUser = {
            id: userJid,
            phone: userPhone,
            name: this.sock.user?.name || 'Akun Anda'
          };
          console.log(`WhatsApp terhubung: ${userPhone}`);
          this.notifyStatus();
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`Koneksi terputus (status: ${statusCode}). Reconnect? ${shouldReconnect}`);
          this.connectionStatus = 'disconnected';
          this.qrDataUrl = null;
          this.connectedUser = null;
          this.notifyStatus();

          if (shouldReconnect) {
            if (!this.isReconnecting) {
              this.isReconnecting = true;
              setTimeout(() => {
                this.isReconnecting = false;
                this.init();
              }, 3000);
            }
          } else {
            console.log('Sesi kedaluwarsa/logout, membuat sesi baru yang bersih...');
            this.clearAuth();
            if (!this.isReconnecting) {
              this.isReconnecting = true;
              setTimeout(() => {
                this.isReconnecting = false;
                this.init();
              }, 2000);
            }
          }
        }
      });
    } catch (err) {
      console.error('Error saat inisialisasi WhatsApp Socket:', err);
      this.connectionStatus = 'disconnected';
      this.notifyStatus();
    }
  }

  // Cek apakah nomor terdaftar di WhatsApp sebelum blast dikirim
  async checkNumberRegistered(phoneOnly) {
    if (!this.sock || this.connectionStatus !== 'connected') {
      throw new Error('WhatsApp belum terhubung.');
    }
    const cleanDigits = String(phoneOnly).replace(/[^0-9]/g, '');
    const defaultJid = `${cleanDigits}@s.whatsapp.net`;
    try {
      const results = await this.sock.onWhatsApp(cleanDigits);
      if (results && results.length > 0) {
        return { exists: Boolean(results[0].exists), jid: results[0].jid || defaultJid };
      }
      return { exists: true, jid: defaultJid };
    } catch (err) {
      // Jika USync gagal atau timeout, jangan putuskan koneksi, fallback ke nomor normal
      console.warn(`Peringatan cek nomor ${cleanDigits}:`, err.message);
      return { exists: true, jid: defaultJid };
    }
  }

  // Simulasi status sedang mengetik (Human-like presence)
  async simulateTyping(jid, durationMs = 2500) {
    if (!this.sock || this.connectionStatus !== 'connected') return;
    try {
      // Catatan: JANGAN panggil presenceSubscribe(jid) karena WhatsApp server akan mereset koneksi
      // (stream closed / error 400) jika kontak target bukan mutual contact!
      await this.sock.sendPresenceUpdate('composing', jid);
      await new Promise(r => setTimeout(r, durationMs));
      await this.sock.sendPresenceUpdate('paused', jid);
    } catch (err) {
      // Abaikan error presence
    }
  }

  // Kirim pesan teks atau media (foto/video)
  async sendMessage(targetJid, contentText, mediaFile = null, simulateTyping = true) {
    if (!this.sock || this.connectionStatus !== 'connected') {
      throw new Error('WhatsApp belum terhubung!');
    }

    // Pastikan targetJid memiliki format WhatsApp yang benar (@s.whatsapp.net)
    let jid = targetJid;
    if (!jid.includes('@')) {
      const cleanDigits = String(jid).replace(/[^0-9]/g, '');
      jid = `${cleanDigits}@s.whatsapp.net`;
    }

    // 1. Simulasi mengetik agar natural
    if (simulateTyping) {
      const randomTypingTime = Math.floor(Math.random() * 2000) + 1500; // 1.5 - 3.5 detik
      await this.simulateTyping(jid, randomTypingTime);
    }

    // 2. Kirim media atau teks
    if (mediaFile && fs.existsSync(mediaFile.path)) {
      const buffer = fs.readFileSync(mediaFile.path);
      const mime = mediaFile.mimetype || '';

      if (mime.startsWith('image/')) {
        return await this.sock.sendMessage(jid, {
          image: buffer,
          caption: contentText || '',
          mimetype: mime
        });
      } else if (mime.startsWith('video/')) {
        return await this.sock.sendMessage(jid, {
          video: buffer,
          caption: contentText || '',
          mimetype: mime
        });
      } else {
        // Fallback dokumen (PDF/dll)
        return await this.sock.sendMessage(jid, {
          document: buffer,
          fileName: mediaFile.originalname || 'document',
          caption: contentText || '',
          mimetype: mime
        });
      }
    } else {
      // Hanya pesan teks biasa
      return await this.sock.sendMessage(jid, {
        text: contentText
      });
    }
  }

  // Permintaan kode pairing untuk koneksi via nomor telepon (tanpa scan QR)
  async getPairingCode(rawPhoneNumber) {
    if (!rawPhoneNumber) throw new Error('Nomor HP tidak boleh kosong');
    let clean = String(rawPhoneNumber).replace(/[^0-9]/g, '');
    if (clean.startsWith('08')) clean = '62' + clean.substring(1);
    else if (clean.startsWith('8')) clean = '62' + clean;

    if (!clean.startsWith('628') || clean.length < 10) {
      throw new Error('Nomor HP tidak valid. Masukkan format seluler Indonesia seperti 08123456789');
    }

    // Pastikan socket aktif dan bukan disconnected
    if (!this.sock || this.connectionStatus === 'disconnected') {
      await this.init();
      await new Promise(r => setTimeout(r, 2500));
    }

    if (this.sock?.authState?.creds?.registered) {
      throw new Error('WhatsApp akun ini sudah terhubung!');
    }

    try {
      console.log(`[Pairing] Meminta kode pairing untuk nomor: ${clean}`);
      const code = await this.sock.requestPairingCode(clean);
      console.log(`[Pairing] Kode pairing berhasil diterima: ${code}`);
      this.pairingCode = code;
      this.notifyStatus();
      return code;
    } catch (err) {
      console.error('Error saat request pairing code:', err);
      this.init();
      throw new Error('Gagal meminta kode pairing: ' + (err.message || 'Koneksi timeout. Silakan klik tombol sekali lagi.'));
    }
  }

  // Logout dan hapus sesi
  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (err) {
      // Abaikan jika sudah terputus
    }
    this.clearAuth();
    this.connectionStatus = 'disconnected';
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectedUser = null;
    this.notifyStatus();
    // Restart init untuk menampilkan QR baru
    setTimeout(() => this.init(), 1000);
  }

  clearAuth() {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('Gagal menghapus folder auth:', err);
    }
  }

  getStatus() {
    return {
      status: this.connectionStatus,
      qr: this.qrDataUrl,
      pairingCode: this.pairingCode,
      user: this.connectedUser
    };
  }
}

module.exports = WhatsAppService;
