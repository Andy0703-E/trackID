'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { trackPackage } = require('./_lib/tracker');

const TOKEN = process.env.BOT_TOKEN || '8654259206:AAEqJTnPFKyQUuqs_z9pqr5LBOD8d8qMQVA';
const bot = new TelegramBot(TOKEN);

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }) + ' WIB';
  } catch { return iso; }
}

function buildMsg(data) {
  const statusLabels = { delivered: '✅ Terkirim', transit: '🚚 Dalam Pengiriman', pickup: '📦 Dijemput', problem: '⚠️ Bermasalah', unknown: '🔄 Dalam Proses' };
  let msg = `*HASIL PELACAKAN*\n━━━━━━━━━━━━━━\n`;
  msg += `📮 *Resi:* \`${data.resi}\`\n`;
  msg += `🚛 *Ekspedisi:* ${data.courierName}\n`;
  msg += `📌 *Status:* ${statusLabels[data.statusKey] || data.status}\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `🕐 *Riwayat Terbaru:*\n\n`;

  const logs = data.history.slice(0, 5);
  logs.forEach(h => {
    msg += `• *${fmtDate(h.date)}*\n  ${h.desc}\n\n`;
  });
  
  msg += `_Powered by TrackID_`;
  return msg;
}

module.exports = async (req, res) => {
  console.log('[BOT] Method:', req.method);
  
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is active and waiting for Webhook.');
  }

  const { message } = req.body;
  console.log('[BOT] Body:', JSON.stringify(req.body));

  if (!message || !message.text) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  try {
    if (text === '/start') {
      await bot.sendMessage(chatId, `👋 Halo! Kirim nomor resi dan kode ekspedisi untuk melacak.\n\nFormat: \`/lacak [resi] [ekspedisi]\`\nContoh: \`/lacak SPXID061577510985 spx\`\n\nID Chat Anda: \`${chatId}\``, { parse_mode: 'Markdown' });
    } else if (text.startsWith('/lacak')) {
      const parts = text.split(' ');
      if (parts.length < 3) {
        await bot.sendMessage(chatId, '❌ Format salah. Gunakan: `/lacak [resi] [ekspedisi]`\nContoh: `/lacak JX123 jnt`');
      } else {
        const resi = parts[1];
        const courier = parts[2];
        
        await bot.sendMessage(chatId, `⏳ Sedang melacak resi \`${resi}\`...`, { parse_mode: 'Markdown' });
        const data = await trackPackage(resi, courier);
        await bot.sendMessage(chatId, buildMsg(data), { parse_mode: 'Markdown' });
      }
    } else {
      await bot.sendMessage(chatId, `Gunakan perintah /lacak [resi] [ekspedisi] untuk mulai melacak.`);
    }
  } catch (err) {
    console.error('[BOT ERROR]', err.message);
    await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }

  // Penting: Selalu kirim respons 200 OK agar Telegram tidak mengirim ulang pesan yang sama
  res.status(200).send('OK');
};
