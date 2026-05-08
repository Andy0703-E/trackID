'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { trackPackage } = require('./_lib/tracker');

const TOKEN = process.env.BOT_TOKEN || '8654259206:AAEqJTnPFKyQUuqs_z9pqr5LBOD8d8qMQVA';
const bot = new TelegramBot(TOKEN);

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }) + ' WIB';
  } catch { return iso; }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { chatId, resi, courier } = req.body;
    if (!chatId || !resi || !courier) throw new Error('Data tidak lengkap');

    const data = await trackPackage(resi, courier);
    
    const statusLabels = { delivered: '✅ Terkirim', transit: '🚚 Dalam Pengiriman', pickup: '📦 Dijemput', problem: '⚠️ Bermasalah', unknown: '🔄 Dalam Proses' };
    let msg = `*NOTIFIKASI TRACKID*\n━━━━━━━━━━━━━━\n`;
    msg += `📮 *Resi:* \`${data.resi}\`\n`;
    msg += `🚛 *Ekspedisi:* ${data.courierName}\n`;
    msg += `📌 *Status:* ${statusLabels[data.statusKey] || data.status}\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `🕐 *Riwayat Terakhir:*\n\n`;
    
    if (data.history.length > 0) {
      const h = data.history[0];
      msg += `• *${fmtDate(h.date)}*\n  ${h.desc}\n`;
    }

    await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
