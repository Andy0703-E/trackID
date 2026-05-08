'use strict';

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { trackPackage, COURIERS } = require('./tracker');

// ── Config ─────────────────────────────────────────────────────────
const TOKEN   = process.env.BOT_TOKEN || '8654259206:AAEqJTnPFKyQUuqs_z9pqr5LBOD8d8qMQVA';
const bot     = new TelegramBot(TOKEN, { polling: true });

// ── Session store (in-memory) ─────────────────────────────────────
// state per chatId: { step: 'await_resi'|'await_courier'|null, resi: string }
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, { step: null, resi: null });
  return sessions.get(chatId);
}

// ── Helpers ────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }) + ' WIB';
  } catch { return iso; }
}

const STATUS_EMOJI = {
  delivered: '✅', transit: '🚚', pickup: '📦', problem: '⚠️', unknown: '🔄',
};
const STATUS_LABEL = {
  delivered: 'Terkirim', transit: 'Dalam Pengiriman',
  pickup: 'Dijemput', problem: 'Bermasalah', unknown: 'Dalam Proses',
};

function buildResultMessage(data) {
  const emoji = STATUS_EMOJI[data.statusKey] || '🔄';
  const label = STATUS_LABEL[data.statusKey] || 'Dalam Proses';

  let msg = `${emoji} *HASIL PELACAKAN*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `📮 *Resi:* \`${data.resi}\`\n`;
  msg += `🚛 *Ekspedisi:* ${data.courierName}\n`;
  if (data.service) msg += `📋 *Layanan:* ${data.service}\n`;
  if (data.origin)  msg += `📍 *Asal:* ${data.origin}\n`;
  if (data.dest)    msg += `🎯 *Tujuan:* ${data.dest}\n`;
  msg += `📌 *Status:* ${label}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `🕐 *Riwayat Pengiriman:*\n\n`;

  if (!data.history?.length) {
    msg += '_Belum ada riwayat pengiriman._\n';
  } else {
    const max = Math.min(data.history.length, 8); // max 8 entries to avoid msg too long
    for (let i = 0; i < max; i++) {
      const h = data.history[i];
      const dot = i === 0 ? '🔵' : '⚪';
      msg += `${dot} *${fmtDate(h.date)}*\n`;
      msg += `    ${h.desc}\n`;
      if (h.loc) msg += `    📍 _${h.loc}_\n`;
      msg += '\n';
    }
    if (data.history.length > max) {
      msg += `_...dan ${data.history.length - max} riwayat sebelumnya_\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Powered by TrackID_`;
  return msg;
}

function courierListMessage() {
  let msg = `📦 *DAFTAR KODE EKSPEDISI*\n━━━━━━━━━━━━━━━━━━\n`;
  const entries = Object.entries(COURIERS).filter(([k]) =>
    !['jet','scp','shopee','jt'].includes(k) // skip aliases
  );
  for (const [code, c] of entries) {
    msg += `• \`${code}\` — ${c.name}\n`;
  }
  msg += `\n_Gunakan kode di atas saat melacak._`;
  return msg;
}

// ── Keyboards ──────────────────────────────────────────────────────
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📦 Lacak Resi' }, { text: '💰 Cek Tarif' }],
      [{ text: '📋 Daftar Ekspedisi' }, { text: '💡 Bantuan' }],
    ],
    resize_keyboard: true,
    persistent: true,
  },
};

const CANCEL_KEYBOARD = {
  reply_markup: {
    keyboard: [[{ text: '❌ Batal' }]],
    resize_keyboard: true,
  },
};

function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } };
}

// ── Commands ────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name   = msg.from?.first_name || 'Pengguna';
  sessions.delete(chatId);

  const text =
    `👋 Halo, *${name}!*\n\n` +
    `Selamat datang di *TrackID Bot* 🚀\n` +
    `Bot pelacak paket Indonesia yang cepat & akurat.\n\n` +
    `💬 *Chat ID kamu:* \`${chatId}\`\n` +
    `_(Salin ID ini jika ingin menerima notifikasi dari website TrackID)_\n\n` +
    `📌 *Yang bisa aku lakukan:*\n` +
    `• Lacak resi dari 20+ ekspedisi\n` +
    `• Cek estimasi tarif pengiriman\n` +
    `• Lihat daftar ekspedisi yang didukung\n\n` +
    `Pilih menu di bawah atau ketik /lacak untuk mulai.`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
});

bot.onText(/\/lacak(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const resi   = match?.[1];
  const courier = match?.[2];

  if (resi && courier) {
    // Direct: /lacak JX123 jnt
    await handleTracking(chatId, resi, courier);
  } else if (resi) {
    // Have resi, need courier
    const s = getSession(chatId);
    s.step = 'await_courier';
    s.resi = resi;
    bot.sendMessage(chatId,
      `📦 Nomor resi: \`${resi}\`\n\nSekarang ketikkan kode ekspedisi:\n_(contoh: jne, jnt, sicepat, spx)_\n\nAtau ketik /ekspedisi untuk daftar kode.`,
      { parse_mode: 'Markdown', ...CANCEL_KEYBOARD }
    );
  } else {
    // Interactive flow
    const s = getSession(chatId);
    s.step = 'await_resi';
    s.resi = null;
    bot.sendMessage(chatId,
      `🔍 *Lacak Resi*\n\nMasukkan nomor resi paket Anda:`,
      { parse_mode: 'Markdown', ...CANCEL_KEYBOARD }
    );
  }
});

bot.onText(/\/ekspedisi/, (msg) => {
  bot.sendMessage(msg.chat.id, courierListMessage(), { parse_mode: 'Markdown' });
});

bot.onText(/\/id/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `💬 *Chat ID Telegram kamu:*\n\n\`${chatId}\`\n\n_Salin ID ini dan masukkan di website TrackID untuk menerima hasil pelacakan langsung ke Telegram._`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/bantuan|\/help/, (msg) => {
  const text =
    `❓ *BANTUAN — TrackID Bot*\n━━━━━━━━━━━━━━━━━━\n\n` +
    `*Cara Lacak Resi:*\n` +
    `1. Ketik /lacak\n` +
    `2. Masukkan nomor resi\n` +
    `3. Masukkan kode ekspedisi\n\n` +
    `*Atau langsung:*\n` +
    `\`/lacak [nomor_resi] [ekspedisi]\`\n` +
    `Contoh: \`/lacak JX3708794672 jnt\`\n\n` +
    `*Perintah Tersedia:*\n` +
    `• /lacak — Lacak resi\n` +
    `• /ekspedisi — Daftar kode ekspedisi\n` +
    `• /id — Lihat Chat ID kamu\n` +
    `• /bantuan — Tampilkan bantuan ini\n\n` +
    `*Website:* TrackID (akses via browser untuk fitur lebih lengkap)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
});

// ── Text message handler (interactive flow) ────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  const s = getSession(chatId);

  // Menu buttons
  if (text === '📦 Lacak Resi') {
    s.step = 'await_resi'; s.resi = null;
    return bot.sendMessage(chatId, `🔍 Masukkan nomor resi:`, { ...CANCEL_KEYBOARD });
  }
  if (text === '📋 Daftar Ekspedisi') {
    return bot.sendMessage(chatId, courierListMessage(), { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
  }
  if (text === '💡 Bantuan') {
    return bot.emit('text', msg, ['/bantuan']);
  }
  if (text === '💰 Cek Tarif') {
    return bot.sendMessage(chatId,
      `💰 *Estimasi Tarif*\n\nFitur ini tersedia di website TrackID.\nBuka di browser dan pilih menu *Estimasi Tarif*.`,
      { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
    );
  }
  if (text === '❌ Batal') {
    sessions.delete(chatId);
    return bot.sendMessage(chatId, `✅ Dibatalkan.`, MAIN_KEYBOARD);
  }

  // Step: waiting for resi
  if (s.step === 'await_resi') {
    s.resi = text;
    s.step = 'await_courier';
    return bot.sendMessage(chatId,
      `📦 Resi: \`${text}\`\n\nSekarang masukkan kode ekspedisi:\n_(contoh: jne, jnt, sicepat, spx, anteraja)_\n\nKetik /ekspedisi untuk daftar kode.`,
      { parse_mode: 'Markdown', ...CANCEL_KEYBOARD }
    );
  }

  // Step: waiting for courier
  if (s.step === 'await_courier') {
    const resi = s.resi;
    s.step = null;
    await handleTracking(chatId, resi, text);
    return;
  }

  // No active session
  bot.sendMessage(chatId,
    `Ketik /lacak untuk melacak resi, atau pilih menu di bawah.`,
    MAIN_KEYBOARD
  );
});

// ── Core tracking handler ──────────────────────────────────────────
async function handleTracking(chatId, resi, courierInput) {
  const loadMsg = await bot.sendMessage(chatId,
    `⏳ Melacak resi \`${resi}\`...\n_Mohon tunggu sebentar._`,
    { parse_mode: 'Markdown' }
  );

  try {
    const data = await trackPackage(resi, courierInput);
    const result = buildResultMessage(data);

    // Edit loading message with result
    await bot.editMessageText(result, {
      chat_id: chatId,
      message_id: loadMsg.message_id,
      parse_mode: 'Markdown',
    });

    // Show main keyboard again
    bot.sendMessage(chatId, `Lacak resi lainnya? Pilih menu di bawah. 👇`, MAIN_KEYBOARD);
  } catch (err) {
    console.error(`[BOT ERROR] chatId=${chatId} resi=${resi}`, err.message);
    await bot.editMessageText(
      `❌ *Gagal melacak resi*\n\n${err.message}\n\n_Pastikan nomor resi dan kode ekspedisi sudah benar._`,
      {
        chat_id: chatId,
        message_id: loadMsg.message_id,
        parse_mode: 'Markdown',
      }
    );
    bot.sendMessage(chatId, `Coba lagi dengan /lacak`, MAIN_KEYBOARD);
  }
}

// ── Send to Chat ID (for website integration) ──────────────────────
// This can be called via HTTP if you add an express server
// POST body: { chatId, resi, courier }
async function sendTrackingToChatId(chatId, resi, courier) {
  try {
    const data = await trackPackage(resi, courier);
    const msg  = buildResultMessage(data);
    await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── HTTP mini-server for website integration ───────────────────────
const http = require('http');
const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { chatId, resi, courier } = JSON.parse(body);
        if (!chatId || !resi || !courier) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'chatId, resi, dan courier wajib diisi' }));
        }
        const result = await sendTrackingToChatId(String(chatId), resi, courier);
        res.writeHead(result.success ? 200 : 500);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'JSON tidak valid' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok', bot: 'TrackID Bot', time: new Date().toISOString() }));
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 TrackID Bot Server`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🤖 Telegram Bot   : aktif (polling)`);
  console.log(`🌐 HTTP Server    : http://localhost:${PORT}`);
  console.log(`📡 Endpoint       : POST /send`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

// ── Error handling ─────────────────────────────────────────────────
bot.on('polling_error', (err) => {
  console.error('[POLLING ERROR]', err.code, err.message);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err);
});

process.on('SIGINT', () => {
  console.log('\n👋 Bot dihentikan.');
  bot.stopPolling();
  process.exit(0);
});
