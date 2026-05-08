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
  let msg = `${statusLabels[data.statusKey] || '🔄'} *HASIL PELACAKAN*\n━━━━━━━━━━━━━━\n`;
  msg += `📮 *Resi:* \`${data.resi}\`\n`;
  msg += `🚛 *Ekspedisi:* ${data.courierName}\n`;
  msg += `📌 *Status:* ${data.status}\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `🕐 *Riwayat Terbaru:*\n\n`;

  const logs = data.history.slice(0, 8);
  logs.forEach(h => {
    msg += `• *${fmtDate(h.date)}*\n  ${h.desc}\n\n`;
  });
  
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `_Powered by TrackID_`;
  return msg;
}

module.exports = async (req, res) => {
  // Dukung pesan baru (message) maupun pesan yang diedit (edited_message)
  const msgObj = req.body.message || req.body.edited_message;
  
  if (!msgObj || !msgObj.text) {
    return res.status(200).send('OK');
  }

  const chatId = msgObj.chat.id;
  const text = msgObj.text.trim();

  try {
    if (text === '/start') {
      await bot.sendMessage(chatId, `👋 Halo! Kirim nomor resi dan kode ekspedisi untuk melacak.\n\nFormat: \`/lacak [resi] [ekspedisi]\`\nContoh: \`/lacak SPXID061577510985 spx\`\n\nID Chat Anda: \`${chatId}\``, { parse_mode: 'Markdown' });
    } else if (text.toLowerCase().startsWith('/lacak')) {
      // Gunakan regex untuk memisahkan berdasarkan spasi/baris baru apapun
      const parts = text.split(/\s+/); 
      
      if (parts.length < 3) {
        await bot.sendMessage(chatId, '❌ *Format salah.*\n\nGunakan: `/lacak [resi] [ekspedisi]`\nContoh: `/lacak JX123 jnt`', { parse_mode: 'Markdown' });
      } else {
        const resi = parts[1];
        const courier = parts[2];
        
        await bot.sendMessage(chatId, `⏳ Sedang melacak resi \`${resi}\` dari \`${courier.toUpperCase()}\`...`, { parse_mode: 'Markdown' });
        const data = await trackPackage(resi, courier);
        await bot.sendMessage(chatId, buildMsg(data), { parse_mode: 'Markdown' });
      }
    } else {
      // Abaikan jika bukan perintah
    }
  } catch (err) {
    console.error('[BOT ERROR]', err.message);
    await bot.sendMessage(chatId, `❌ *Gagal Melacak*\n\n${err.message}`, { parse_mode: 'Markdown' });
  }

  res.status(200).send('OK');
};
