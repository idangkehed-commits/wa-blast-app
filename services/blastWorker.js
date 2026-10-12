const { renderTemplate } = require('./spintax');
const xlsx = require('xlsx');

class BlastWorker {
  constructor(waService) {
    this.waService = waService;
    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'scheduled'
    this.jobConfig = null;
    this.contacts = [];
    this.currentIndex = 0;
    this.stats = {
      total: 0,
      sent: 0,
      failed: 0,
      startTime: null,
      endTime: null
    };
    this.logs = [];
    this.listeners = [];
    this.pausePromiseResolve = null;
    this.scheduleTimer = null;
  }

  onUpdate(callback) {
    this.listeners.push(callback);
  }

  broadcast(eventType, data = {}) {
    const payload = {
      type: eventType,
      state: this.state,
      stats: this.stats,
      currentIndex: this.currentIndex,
      timestamp: new Date().toISOString(),
      ...data
    };
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error on blast listener:', err);
      }
    }
  }

  // Setup dan mulai atau jadwalkan blast
  async startJob({
    contacts,
    messageTemplate,
    mediaFile = null,
    minDelay = 10,
    maxDelay = 25,
    batchSize = 20,
    batchPauseMinutes = 3,
    simulateTyping = true,
    verifyNumber = true,
    scheduledAt = null
  }) {
    if (this.state === 'running' || this.state === 'paused') {
      throw new Error('Ada proses blast yang sedang berjalan!');
    }

    if (this.waService.connectionStatus !== 'connected') {
      throw new Error('WhatsApp belum terhubung! Silakan scan QR code terlebih dahulu.');
    }

    if (!contacts || contacts.length === 0) {
      throw new Error('Daftar kontak kosong!');
    }

    // Reset status
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    this.contacts = contacts;
    this.currentIndex = 0;
    this.logs = [];
    this.stats = {
      total: contacts.length,
      sent: 0,
      failed: 0,
      startTime: null,
      endTime: null
    };

    this.jobConfig = {
      messageTemplate,
      mediaFile,
      minDelay: Math.max(3, parseInt(minDelay) || 10),
      maxDelay: Math.max(5, parseInt(maxDelay) || 25),
      batchSize: Math.max(5, parseInt(batchSize) || 20),
      batchPauseMinutes: Math.max(1, parseInt(batchPauseMinutes) || 3),
      simulateTyping: Boolean(simulateTyping),
      verifyNumber: Boolean(verifyNumber),
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null
    };

    // Cek apakah pengiriman terjadwal
    if (this.jobConfig.scheduledAt && this.jobConfig.scheduledAt > new Date()) {
      this.state = 'scheduled';
      const delayMs = this.jobConfig.scheduledAt.getTime() - Date.now();
      console.log(`Blast dijadwalkan pada: ${this.jobConfig.scheduledAt.toLocaleString('id-ID')} (${Math.round(delayMs / 1000)} detik lagi)`);
      this.broadcast('scheduled', {
        scheduledTime: this.jobConfig.scheduledAt.toISOString()
      });

      this.scheduleTimer = setTimeout(() => {
        this.runLoop().catch(err => {
          console.error('[BlastWorker] Error pada scheduled runLoop:', err);
        });
      }, delayMs);

      return { scheduled: true, scheduledAt: this.jobConfig.scheduledAt };
    }

    // Jalankan loop di background agar HTTP response tidak hanging/timeout
    this.runLoop().catch(err => {
      console.error('[BlastWorker] Error pada runLoop:', err);
      this.state = 'stopped';
      this.broadcast('state_change', { message: 'Pengiriman terhenti: ' + err.message });
    });

    return { started: true, total: contacts.length };
  }

  // Loop utama pengiriman
  async runLoop() {
    this.state = 'running';
    this.stats.startTime = new Date();
    this.broadcast('state_change', { message: 'Pengiriman blast dimulai' });

    let consecutiveSentInBatch = 0;

    while (this.currentIndex < this.contacts.length) {
      // 1. Cek jika dihentikan
      if (this.state === 'stopped') {
        break;
      }

      // 2. Cek jika dijeda (pause)
      if (this.state === 'paused') {
        this.broadcast('state_change', { message: 'Blast sedang dijeda' });
        await new Promise(resolve => {
          this.pausePromiseResolve = resolve;
        });
        if (this.state === 'stopped') break;
      }

      // 3. Pastikan WhatsApp masih terhubung (tunggu hingga 30 detik jika sedang auto-reconnect)
      if (this.waService.connectionStatus !== 'connected') {
        console.warn('[BlastWorker] Menunggu koneksi WhatsApp terhubung kembali...');
        let waitAttempts = 0;
        while (this.waService.connectionStatus !== 'connected' && waitAttempts < 15) {
          if (this.state === 'stopped') break;
          await new Promise(r => setTimeout(r, 2000));
          waitAttempts++;
        }
        if (this.waService.connectionStatus !== 'connected') {
          console.error('[BlastWorker] Koneksi WhatsApp terputus permanen.');
          this.state = 'stopped';
          this.broadcast('state_change', { message: 'Koneksi WhatsApp terputus. Silakan hubungkan kembali.' });
          break;
        }
      }

      const contact = this.contacts[this.currentIndex];
      const nowStr = new Date().toLocaleTimeString('id-ID');

      try {
        // A. Validasi nomor ada di WhatsApp
        let targetJid = contact.jid || `${contact.phone}@s.whatsapp.net`;
        if (this.jobConfig.verifyNumber) {
          const check = await this.waService.checkNumberRegistered(contact.phone);
          if (!check.exists) {
            throw new Error('Nomor tidak terdaftar di WhatsApp');
          }
          if (check.jid) targetJid = check.jid;
        }

        // B. Buat variasi pesan dengan Spintax dan data kontak
        const personalizedMessage = renderTemplate(
          this.jobConfig.messageTemplate,
          {
            phone: contact.phone,
            name: contact.name,
            ...contact.customFields
          }
        );

        // C. Kirim Pesan / Media via WhatsApp
        await this.waService.sendMessage(
          targetJid,
          personalizedMessage,
          this.jobConfig.mediaFile,
          this.jobConfig.simulateTyping
        );

        // D. Catat sukses
        this.stats.sent++;
        consecutiveSentInBatch++;
        const logItem = {
          time: nowStr,
          phone: contact.phone,
          name: contact.name || '-',
          status: 'success',
          preview: personalizedMessage.substring(0, 80) + (personalizedMessage.length > 80 ? '...' : ''),
          note: 'Pesan berhasil dikirim'
        };
        this.logs.unshift(logItem);
        this.broadcast('log', { log: logItem });

      } catch (err) {
        // Catat kegagalan
        this.stats.failed++;
        const logItem = {
          time: nowStr,
          phone: contact.phone,
          name: contact.name || '-',
          status: 'failed',
          preview: '-',
          note: err.message || 'Gagal mengirim'
        };
        this.logs.unshift(logItem);
        this.broadcast('log', { log: logItem });
      }

      this.currentIndex++;
      this.broadcast('progress');

      // 3. Cek apakah sudah selesai
      if (this.currentIndex >= this.contacts.length) {
        break;
      }

      // 4. Cek apakah perlu istirahat berkala (Batch Cooldown)
      if (consecutiveSentInBatch >= this.jobConfig.batchSize) {
        consecutiveSentInBatch = 0;
        const cooldownSeconds = this.jobConfig.batchPauseMinutes * 60;
        console.log(`[Anti-Blokir] Mencapai batas batch (${this.jobConfig.batchSize} pesan). Istirahat selama ${this.jobConfig.batchPauseMinutes} menit...`);
        
        // Loop hitung mundur cooldown
        for (let s = cooldownSeconds; s > 0; s--) {
          if (this.state === 'stopped') break;
          this.broadcast('cooldown', {
            isCooldown: true,
            cooldownRemaining: s,
            totalCooldown: cooldownSeconds
          });
          await new Promise(r => setTimeout(r, 1000));
        }

        if (this.state === 'stopped') break;
      } else {
        // 5. Jeda acak (Random Jitter) antar pesan untuk keamanan bot
        const delaySeconds = Math.floor(
          Math.random() * (this.jobConfig.maxDelay - this.jobConfig.minDelay + 1)
        ) + this.jobConfig.minDelay;

        console.log(`[Anti-Blokir] Jeda acak selama ${delaySeconds} detik sebelum nomor berikutnya...`);
        for (let s = delaySeconds; s > 0; s--) {
          if (this.state === 'stopped' || this.state === 'paused') break;
          this.broadcast('interval_tick', {
            delayRemaining: s,
            totalDelay: delaySeconds,
            nextPhone: this.contacts[this.currentIndex]?.phone
          });
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    this.stats.endTime = new Date();
    if (this.state !== 'stopped') {
      this.state = 'completed';
    }
    this.broadcast('state_change', { message: 'Proses blast selesai' });
    return { success: true, stats: this.stats };
  }

  // Jeda
  pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.broadcast('state_change', { message: 'Blast dijeda oleh pengguna' });
      return true;
    }
    return false;
  }

  // Lanjutkan
  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      if (this.pausePromiseResolve) {
        this.pausePromiseResolve();
        this.pausePromiseResolve = null;
      }
      this.broadcast('state_change', { message: 'Blast dilanjutkan' });
      return true;
    }
    return false;
  }

  // Hentikan
  stop() {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    this.state = 'stopped';
    if (this.pausePromiseResolve) {
      this.pausePromiseResolve();
      this.pausePromiseResolve = null;
    }
    this.broadcast('state_change', { message: 'Blast dihentikan oleh pengguna' });
    return true;
  }

  getStatus() {
    return {
      state: this.state,
      stats: this.stats,
      currentIndex: this.currentIndex,
      total: this.contacts.length,
      config: this.jobConfig,
      logs: this.logs.slice(0, 100)
    };
  }

  // Export hasil pengiriman ke format Excel buffer
  exportReportBuffer() {
    const reportData = this.logs.map((log, idx) => ({
      'No': idx + 1,
      'Waktu': log.time,
      'Nomor HP': log.phone,
      'Nama': log.name,
      'Status': log.status === 'success' ? 'BERHASIL' : 'GAGAL',
      'Keterangan': log.note,
      'Isi Pesan': log.preview
    }));

    const worksheet = xlsx.utils.json_to_sheet(reportData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Laporan Blast');

    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }
}

module.exports = BlastWorker;
