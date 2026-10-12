// ==========================================
// STATE & MULTI-SESSION MANAGEMENT
// ==========================================
let sessionId = localStorage.getItem('wa_blast_session_id');
if (!sessionId) {
  sessionId = 'user_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
  localStorage.setItem('wa_blast_session_id', sessionId);
}

let currentContacts = [];
let uploadedMediaFile = null;
let currentWaStatus = 'disconnected';
let blastState = 'idle';
let deferredInstallPrompt = null;

// Helper fetch dengan header sessionId
async function apiFetch(url, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  headers['x-session-id'] = sessionId;
  return fetch(url, { ...options, headers });
}

// DOM ELEMENTS
const waStatusBadge = document.getElementById('waStatusBadge');
const waStatusText = document.getElementById('waStatusText');
const qrContainer = document.getElementById('qrContainer');
const qrLoading = document.getElementById('qrLoading');
const qrImage = document.getElementById('qrImage');
const connectedContainer = document.getElementById('connectedContainer');
const connectedUserName = document.getElementById('connectedUserName');
const connectedUserPhone = document.getElementById('connectedUserPhone');
const btnLogout = document.getElementById('btnLogout');

// WA Pairing Code Elements
const connectionMethodTabs = document.getElementById('connectionMethodTabs');
const tabWaPairing = document.getElementById('tabWaPairing');
const tabWaQr = document.getElementById('tabWaQr');
const pairingPhoneInput = document.getElementById('pairingPhoneInput');
const btnGetPairingCode = document.getElementById('btnGetPairingCode');
const pairingCodeDisplay = document.getElementById('pairingCodeDisplay');
const pairingCodeText = document.getElementById('pairingCodeText');
const btnCopyPairingCode = document.getElementById('btnCopyPairingCode');
const btnRefreshSession = document.getElementById('btnRefreshSession');
const refreshSessionBox = document.getElementById('refreshSessionBox');

// PWA Elements
const pwaInstallBanner = document.getElementById('pwaInstallBanner');
const btnPwaInstall = document.getElementById('btnPwaInstall');
const btnPwaDismiss = document.getElementById('btnPwaDismiss');

// Kontak Elements
const excelDropzone = document.getElementById('excelDropzone');
const excelFileInput = document.getElementById('excelFileInput');
const excelLoading = document.getElementById('excelLoading');
const excelFileInfo = document.getElementById('excelFileInfo');
const excelFileName = document.getElementById('excelFileName');
const btnClearExcel = document.getElementById('btnClearExcel');
const manualContactsInput = document.getElementById('manualContactsInput');
const btnProcessManual = document.getElementById('btnProcessManual');
const contactStatsPill = document.getElementById('contactStatsPill');
const countValid = document.getElementById('countValid');
const countDupes = document.getElementById('countDupes');
const countInvalid = document.getElementById('countInvalid');
const contactsPreviewWrapper = document.getElementById('contactsPreviewWrapper');
const previewCount = document.getElementById('previewCount');
const contactsTableBody = document.getElementById('contactsTableBody');
const btnTogglePreview = document.getElementById('btnTogglePreview');
const customFieldChips = document.getElementById('customFieldChips');

// Pesan & Media Elements
const messageTemplate = document.getElementById('messageTemplate');
const mediaFileInput = document.getElementById('mediaFileInput');
const mediaFileName = document.getElementById('mediaFileName');
const btnRemoveMedia = document.getElementById('btnRemoveMedia');
const mediaPreviewWrapper = document.getElementById('mediaPreviewWrapper');
const mediaPreviewImage = document.getElementById('mediaPreviewImage');
const mediaPreviewVideo = document.getElementById('mediaPreviewVideo');

// Safety & Jadwal Elements
const minDelayInput = document.getElementById('minDelay');
const maxDelayInput = document.getElementById('maxDelay');
const batchSizeInput = document.getElementById('batchSize');
const batchPauseMinutesInput = document.getElementById('batchPauseMinutes');
const simulateTypingInput = document.getElementById('simulateTyping');
const verifyNumberInput = document.getElementById('verifyNumber');
const scheduleRadios = document.querySelectorAll('input[name="scheduleType"]');
const scheduleTimeWrapper = document.getElementById('scheduleTimeWrapper');
const scheduledAtInput = document.getElementById('scheduledAt');

// Action & Progress Elements
const btnStartBlast = document.getElementById('btnStartBlast');
const btnPauseBlast = document.getElementById('btnPauseBlast');
const btnResumeBlast = document.getElementById('btnResumeBlast');
const btnStopBlast = document.getElementById('btnStopBlast');
const btnExportReport = document.getElementById('btnExportReport');
const progressSection = document.getElementById('progressSection');
const countdownAlert = document.getElementById('countdownAlert');
const countdownMessage = document.getElementById('countdownMessage');
const progressPercent = document.getElementById('progressPercent');
const progressBarFill = document.getElementById('progressBarFill');
const statTotal = document.getElementById('statTotal');
const statSent = document.getElementById('statSent');
const statFailed = document.getElementById('statFailed');
const statRemaining = document.getElementById('statRemaining');
const liveLogTableBody = document.getElementById('liveLogTableBody');

// ==========================================
// PWA & SERVICE WORKER SETUP
// ==========================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    console.log('PWA Service Worker terdaftar.');
  }).catch((err) => {
    console.log('SW register failed:', err);
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  pwaInstallBanner.style.display = 'flex';
});

btnPwaInstall.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log(`User response to install: ${outcome}`);
    deferredInstallPrompt = null;
    pwaInstallBanner.style.display = 'none';
  }
});

btnPwaDismiss.addEventListener('click', () => {
  pwaInstallBanner.style.display = 'none';
});

// ==========================================
// INISIALISASI SERVER-SENT EVENTS (SSE)
// ==========================================
function initEventSource() {
  const evtSource = new EventSource(`/api/events?sessionId=${encodeURIComponent(sessionId)}`);

  evtSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    updateWaUI(data.wa);
    updateBlastUI(data.blast);
  });

  evtSource.addEventListener('wa_status', (e) => {
    const data = JSON.parse(e.data);
    updateWaUI(data);
  });

  evtSource.addEventListener('blast_update', (e) => {
    const data = JSON.parse(e.data);
    handleBlastUpdate(data);
  });

  evtSource.onerror = () => {
    waStatusBadge.className = 'status-badge disconnected';
    waStatusText.textContent = 'Menghubungkan ke Server...';
  };
}

// Tab Switcher Koneksi WA (Pairing Code vs QR)
document.querySelectorAll('[data-wa-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-wa-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.waTab === 'pairing') {
      tabWaPairing.style.display = 'block';
      tabWaQr.style.display = 'none';
    } else {
      tabWaPairing.style.display = 'none';
      tabWaQr.style.display = 'block';
    }
  });
});

// Request Kode Pairing
btnGetPairingCode.addEventListener('click', async () => {
  const phone = pairingPhoneInput.value.trim();
  if (!phone) {
    alert('Silakan masukkan nomor WhatsApp Anda terlebih dahulu (contoh: 08123456789)!');
    return;
  }

  try {
    btnGetPairingCode.disabled = true;
    btnGetPairingCode.textContent = 'Meminta Kode...';

    const res = await apiFetch('/api/pairing-code', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || 'Gagal meminta kode pairing');
      return;
    }

    displayPairingCode(data.code);
  } catch (err) {
    alert('Terjadi kesalahan: ' + err.message);
  } finally {
    btnGetPairingCode.disabled = false;
    btnGetPairingCode.textContent = 'Dapatkan Kode';
  }
});

function displayPairingCode(rawCode) {
  if (!rawCode) return;
  let formatted = rawCode;
  if (rawCode.length === 8) {
    formatted = `${rawCode.substring(0, 4)} - ${rawCode.substring(4)}`;
  }
  pairingCodeText.textContent = formatted;
  pairingCodeDisplay.style.display = 'block';
}

btnCopyPairingCode.addEventListener('click', () => {
  const code = pairingCodeText.textContent.replace(/[^a-zA-Z0-9]/g, '');
  navigator.clipboard.writeText(code).then(() => {
    btnCopyPairingCode.textContent = '✅ Tersalin!';
    setTimeout(() => { btnCopyPairingCode.textContent = '📋 Salin'; }, 2000);
  }).catch(() => {
    alert('Kode Anda: ' + code);
  });
});

// Muat Ulang / Buat Sesi Baru
if (btnRefreshSession) {
  btnRefreshSession.addEventListener('click', async () => {
    try {
      btnRefreshSession.disabled = true;
      btnRefreshSession.textContent = 'Memuat Sesi Baru...';
      pairingCodeDisplay.style.display = 'none';
      await apiFetch('/api/reconnect', { method: 'POST' });
    } catch (err) {
      alert('Gagal memuat ulang: ' + err.message);
    } finally {
      btnRefreshSession.disabled = false;
      btnRefreshSession.textContent = '🔄 Muat Ulang / Buat Sesi Baru';
    }
  });
}

// Update UI Koneksi WhatsApp
function updateWaUI(waData) {
  if (!waData) return;
  currentWaStatus = waData.status;

  if (waData.status === 'connected') {
    waStatusBadge.className = 'status-badge connected';
    waStatusText.textContent = 'Terhubung';
    connectionMethodTabs.style.display = 'none';
    tabWaPairing.style.display = 'none';
    tabWaQr.style.display = 'none';
    if (refreshSessionBox) refreshSessionBox.style.display = 'none';
    connectedContainer.style.display = 'block';

    if (waData.user) {
      connectedUserName.textContent = waData.user.name || 'WhatsApp Web';
      connectedUserPhone.textContent = waData.user.phone || '-';
    }
  } else if (waData.status === 'connecting') {
    waStatusBadge.className = 'status-badge connecting';
    waStatusText.textContent = 'Siap Dihubungkan';
    connectedContainer.style.display = 'none';
    connectionMethodTabs.style.display = 'flex';
    if (refreshSessionBox) refreshSessionBox.style.display = 'block';

    // Periksa tab mana yang aktif
    const activeTab = document.querySelector('[data-wa-tab].active')?.dataset.waTab || 'pairing';
    if (activeTab === 'pairing') {
      tabWaPairing.style.display = 'block';
      tabWaQr.style.display = 'none';
    } else {
      tabWaPairing.style.display = 'none';
      tabWaQr.style.display = 'block';
    }

    if (waData.pairingCode) {
      displayPairingCode(waData.pairingCode);
    }

    if (waData.qr) {
      qrLoading.style.display = 'none';
      qrImage.src = waData.qr;
      qrImage.style.display = 'block';
    } else {
      qrLoading.style.display = 'flex';
      qrImage.style.display = 'none';
    }
  } else {
    waStatusBadge.className = 'status-badge disconnected';
    waStatusText.textContent = 'Terputus';
    connectedContainer.style.display = 'none';
    connectionMethodTabs.style.display = 'flex';
    if (refreshSessionBox) refreshSessionBox.style.display = 'block';
  }
}

// Logout Akun
btnLogout.addEventListener('click', async () => {
  if (!confirm('Yakin ingin keluar / ganti akun WhatsApp?')) return;
  try {
    btnLogout.disabled = true;
    btnLogout.textContent = 'Mengeluarkan...';
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (err) {
    alert('Gagal logout: ' + err.message);
  } finally {
    btnLogout.disabled = false;
    btnLogout.textContent = 'Ganti / Keluar Akun';
  }
});

// ==========================================
// TABS & IMPORT KONTAK
// ==========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.dataset.tab === 'excel' ? 'tabExcel' : 'tabManual';
    document.getElementById(tabId).classList.add('active');
  });
});

// Drag & Drop Excel
excelDropzone.addEventListener('click', () => excelFileInput.click());

excelDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  excelDropzone.style.borderColor = 'var(--primary)';
});
excelDropzone.addEventListener('dragleave', () => {
  excelDropzone.style.borderColor = 'var(--border-color)';
});
excelDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  excelDropzone.style.borderColor = 'var(--border-color)';
  if (e.dataTransfer.files.length > 0) {
    handleExcelUpload(e.dataTransfer.files[0]);
  }
});

excelFileInput.addEventListener('change', () => {
  if (excelFileInput.files.length > 0) {
    handleExcelUpload(excelFileInput.files[0]);
  }
});

btnClearExcel.addEventListener('click', () => {
  excelFileInput.value = '';
  excelFileInfo.style.display = 'none';
  excelDropzone.style.display = 'block';
  setContacts([]);
});

// Upload & Parse Excel ke Backend
async function handleExcelUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  excelLoading.style.display = 'flex';
  excelDropzone.querySelector('p').style.display = 'none';

  try {
    const res = await apiFetch('/api/parse-excel', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || 'Gagal membaca file Excel');
      return;
    }

    excelFileName.textContent = `${file.name} (${data.validContacts.length} kontak valid ditemukan)`;
    excelFileInfo.style.display = 'flex';
    excelDropzone.style.display = 'none';

    setContacts(data.validContacts, data.duplicateCount, data.invalidContacts.length, data.availableFields);
  } catch (err) {
    alert('Terjadi kesalahan saat memproses Excel: ' + err.message);
  } finally {
    excelLoading.style.display = 'none';
    excelDropzone.querySelector('p').style.display = 'block';
  }
}

// Proses Kontak Manual
btnProcessManual.addEventListener('click', async () => {
  const text = manualContactsInput.value.trim();
  if (!text) {
    alert('Silakan masukkan nomor telepon terlebih dahulu!');
    return;
  }

  try {
    btnProcessManual.disabled = true;
    btnProcessManual.textContent = 'Memvalidasi...';

    const res = await apiFetch('/api/parse-manual', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || 'Gagal memproses nomor');
      return;
    }

    setContacts(data.validContacts, data.duplicateCount, data.invalidContacts.length, ['nama', 'nomor']);
  } catch (err) {
    alert('Kesalahan: ' + err.message);
  } finally {
    btnProcessManual.disabled = false;
    btnProcessManual.textContent = 'Validasi & Terapkan Nomor';
  }
});

// Menyimpan Kontak & Render Preview
function setContacts(contacts, dupesCount = 0, invalidCount = 0, fields = []) {
  currentContacts = contacts || [];

  if (currentContacts.length > 0) {
    contactStatsPill.style.display = 'flex';
    countValid.textContent = `${currentContacts.length} Siap`;
    countDupes.textContent = `${dupesCount} Duplikat Dihapus`;
    countInvalid.textContent = `${invalidCount} Tidak Valid`;

    renderContactsTable(currentContacts);
    contactsPreviewWrapper.style.display = 'block';
    renderCustomChips(fields);
  } else {
    contactStatsPill.style.display = 'none';
    contactsPreviewWrapper.style.display = 'none';
    customFieldChips.innerHTML = '';
  }
}

function renderCustomChips(fields) {
  customFieldChips.innerHTML = '';
  const standardFields = ['nama', 'nomor', 'phone', 'panggilan', 'tanggal', 'waktu'];

  fields.forEach(f => {
    if (!standardFields.includes(f)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.dataset.tag = `{${f}}`;
      chip.textContent = `{${f}}`;
      chip.addEventListener('click', () => insertTag(`{${f}}`));
      customFieldChips.appendChild(chip);
    }
  });
}

function renderContactsTable(contacts) {
  previewCount.textContent = contacts.length;
  contactsTableBody.innerHTML = '';

  const displayList = contacts.slice(0, 50);
  displayList.forEach((c, idx) => {
    const tr = document.createElement('tr');
    const extraFields = Object.entries(c.customFields || {})
      .filter(([k]) => k !== 'nama' && k !== 'nomor')
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${c.phone}</strong></td>
      <td>${c.name || '-'}</td>
      <td><small class="text-muted">${extraFields || '-'}</small></td>
    `;
    contactsTableBody.appendChild(tr);
  });

  if (contacts.length > 50) {
    const trMore = document.createElement('tr');
    trMore.innerHTML = `<td colspan="4" class="text-center text-muted">...dan ${contacts.length - 50} kontak lainnya</td>`;
    contactsTableBody.appendChild(trMore);
  }
}

btnTogglePreview.addEventListener('click', () => {
  const container = document.getElementById('contactsTableContainer');
  if (container.style.display === 'none') {
    container.style.display = 'block';
    btnTogglePreview.textContent = 'Tutup Tabel';
  } else {
    container.style.display = 'none';
    btnTogglePreview.textContent = 'Lihat Tabel';
  }
});

// ==========================================
// KOMPOSER PESAN & MEDIA
// ==========================================
document.querySelectorAll('.tag-chip').forEach(chip => {
  chip.addEventListener('click', () => insertTag(chip.dataset.tag));
});

function insertTag(tag) {
  const start = messageTemplate.selectionStart;
  const end = messageTemplate.selectionEnd;
  const text = messageTemplate.value;
  messageTemplate.value = text.substring(0, start) + tag + text.substring(end);
  messageTemplate.focus();
  messageTemplate.selectionStart = messageTemplate.selectionEnd = start + tag.length;
}

mediaFileInput.addEventListener('change', async () => {
  if (mediaFileInput.files.length === 0) return;
  const file = mediaFileInput.files[0];

  const formData = new FormData();
  formData.append('media', file);

  try {
    mediaFileName.textContent = 'Mengupload ' + file.name + '...';
    const res = await apiFetch('/api/upload-media', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success && data.file) {
      uploadedMediaFile = data.file;
      mediaFileName.textContent = file.name;
      btnRemoveMedia.style.display = 'inline-block';
      mediaPreviewWrapper.style.display = 'block';

      if (data.file.mimetype.startsWith('image/')) {
        mediaPreviewImage.src = data.file.url;
        mediaPreviewImage.style.display = 'block';
        mediaPreviewVideo.style.display = 'none';
      } else if (data.file.mimetype.startsWith('video/')) {
        mediaPreviewVideo.src = data.file.url;
        mediaPreviewVideo.style.display = 'block';
        mediaPreviewImage.style.display = 'none';
      }
    }
  } catch (err) {
    alert('Gagal upload media: ' + err.message);
    mediaFileName.textContent = 'Gagal upload media';
  }
});

btnRemoveMedia.addEventListener('click', () => {
  uploadedMediaFile = null;
  mediaFileInput.value = '';
  mediaFileName.textContent = 'Belum ada file media dipilih';
  btnRemoveMedia.style.display = 'none';
  mediaPreviewWrapper.style.display = 'none';
  mediaPreviewImage.src = '';
  mediaPreviewVideo.src = '';
});

scheduleRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    scheduleTimeWrapper.style.display = e.target.value === 'scheduled' ? 'block' : 'none';
  });
});

// ==========================================
// BLAST CONTROLS & MONITORING
// ==========================================
btnStartBlast.addEventListener('click', async () => {
  if (currentWaStatus !== 'connected') {
    alert('WhatsApp Anda belum terhubung! Silakan scan QR code terlebih dahulu.');
    return;
  }

  if (!currentContacts || currentContacts.length === 0) {
    alert('Belum ada kontak target yang diimport atau divalidasi!');
    return;
  }

  const template = messageTemplate.value.trim();
  if (!template && !uploadedMediaFile) {
    alert('Silakan tuliskan isi pesan atau pilih media foto/video!');
    return;
  }

  let scheduledAt = null;
  const isScheduled = document.querySelector('input[name="scheduleType"]:checked').value === 'scheduled';
  if (isScheduled) {
    const scheduleVal = scheduledAtInput.value;
    if (!scheduleVal) {
      alert('Silakan tentukan tanggal dan jam pengiriman terjadwal!');
      return;
    }
    scheduledAt = new Date(scheduleVal).toISOString();
  }

  const payload = {
    contacts: currentContacts,
    messageTemplate: template,
    mediaFile: uploadedMediaFile,
    minDelay: parseInt(minDelayInput.value) || 10,
    maxDelay: parseInt(maxDelayInput.value) || 25,
    batchSize: parseInt(batchSizeInput.value) || 20,
    batchPauseMinutes: parseInt(batchPauseMinutesInput.value) || 3,
    simulateTyping: simulateTypingInput.checked,
    verifyNumber: verifyNumberInput.checked,
    scheduledAt: scheduledAt
  };

  const confirmMsg = isScheduled 
    ? `Jadwalkan pengiriman ${currentContacts.length} pesan pada ${new Date(scheduledAt).toLocaleString('id-ID')}?`
    : `Mulai kirim blast ke ${currentContacts.length} kontak sekarang?`;

  if (!confirm(confirmMsg)) return;

  try {
    btnStartBlast.disabled = true;
    const res = await apiFetch('/api/blast/start', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || 'Gagal memulai blast');
      btnStartBlast.disabled = false;
      return;
    }

    progressSection.style.display = 'block';
    liveLogTableBody.innerHTML = '';
  } catch (err) {
    alert('Terjadi kesalahan: ' + err.message);
    btnStartBlast.disabled = false;
  }
});

btnPauseBlast.addEventListener('click', () => apiFetch('/api/blast/pause', { method: 'POST' }));
btnResumeBlast.addEventListener('click', () => apiFetch('/api/blast/resume', { method: 'POST' }));
btnStopBlast.addEventListener('click', () => {
  if (confirm('Yakin ingin membatalkan dan menghentikan pengiriman blast?')) {
    apiFetch('/api/blast/stop', { method: 'POST' });
  }
});

btnExportReport.addEventListener('click', () => {
  window.location.href = `/api/blast/export?sessionId=${encodeURIComponent(sessionId)}`;
});

function updateBlastUI(blast) {
  if (!blast) return;
  blastState = blast.state;

  if (blast.state === 'running') {
    btnStartBlast.style.display = 'none';
    btnPauseBlast.style.display = 'inline-flex';
    btnResumeBlast.style.display = 'none';
    btnStopBlast.style.display = 'inline-flex';
    btnExportReport.style.display = 'none';
    progressSection.style.display = 'block';
  } else if (blast.state === 'paused') {
    btnStartBlast.style.display = 'none';
    btnPauseBlast.style.display = 'none';
    btnResumeBlast.style.display = 'inline-flex';
    btnStopBlast.style.display = 'inline-flex';
    countdownAlert.style.display = 'block';
    countdownMessage.textContent = 'Blast sedang dijeda.';
  } else if (blast.state === 'scheduled') {
    btnStartBlast.style.display = 'none';
    btnPauseBlast.style.display = 'none';
    btnResumeBlast.style.display = 'none';
    btnStopBlast.style.display = 'inline-flex';
    countdownAlert.style.display = 'block';
    countdownMessage.textContent = `Blast terjadwal untuk ${blast.config?.scheduledAt ? new Date(blast.config.scheduledAt).toLocaleString('id-ID') : 'waktu yang ditentukan'}`;
  } else {
    btnStartBlast.style.display = 'inline-flex';
    btnStartBlast.disabled = false;
    btnPauseBlast.style.display = 'none';
    btnResumeBlast.style.display = 'none';
    btnStopBlast.style.display = 'none';

    if (blast.logs && blast.logs.length > 0) {
      btnExportReport.style.display = 'inline-flex';
    }
  }

  const total = blast.total || blast.stats?.total || 0;
  const sent = blast.stats?.sent || 0;
  const failed = blast.stats?.failed || 0;
  const remaining = Math.max(0, total - (sent + failed));

  statTotal.textContent = total;
  statSent.textContent = sent;
  statFailed.textContent = failed;
  statRemaining.textContent = remaining;

  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;
  progressPercent.textContent = `${pct}%`;
  progressBarFill.style.width = `${pct}%`;
}

function handleBlastUpdate(data) {
  updateBlastUI(data);

  if (data.type === 'interval_tick') {
    countdownAlert.style.display = 'flex';
    countdownAlert.className = 'alert-box alert-info';
    countdownMessage.textContent = `[Anti-Blokir] Jeda acak: ${data.delayRemaining} detik tersisa sebelum kirim ke ${data.nextPhone || 'nomor berikutnya'}...`;
  }

  if (data.type === 'cooldown') {
    countdownAlert.style.display = 'flex';
    countdownAlert.className = 'alert-box alert-warning';
    countdownMessage.textContent = `☕ [Anti-Blokir] Istirahat berkala (${data.cooldownRemaining} detik lagi) agar akun tetap aman...`;
  }

  if (data.type === 'log' && data.log) {
    countdownAlert.style.display = 'none';
    addLogRow(data.log);
  }

  if (data.type === 'state_change') {
    if (data.state === 'completed' || data.state === 'stopped') {
      countdownAlert.style.display = 'none';
    }
  }
}

function addLogRow(log) {
  if (liveLogTableBody.querySelector('.text-muted')) {
    liveLogTableBody.innerHTML = '';
  }

  const tr = document.createElement('tr');
  const badgeClass = log.status === 'success' ? 'badge-success' : 'badge-danger';
  const statusLabel = log.status === 'success' ? 'Berhasil' : 'Gagal';

  tr.innerHTML = `
    <td><small>${log.time}</small></td>
    <td><strong>${log.phone}</strong></td>
    <td>${log.name}</td>
    <td><span class="${badgeClass}">${statusLabel}</span></td>
    <td><small title="${log.note}">${log.note}</small></td>
  `;

  liveLogTableBody.insertBefore(tr, liveLogTableBody.firstChild);
}

document.addEventListener('DOMContentLoaded', () => {
  initEventSource();
});
