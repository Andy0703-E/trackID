'use strict';

// ── Courier config ─────────────────────────────────────────────────
const COURIERS = {
  jne:       { name:'JNE Express',        abbr:'JNE',  bg:'linear-gradient(135deg,#b91c1c,#ef4444)', biteship:'jne'      },
  jnt:       { name:'J&T Express',        abbr:'J&T',  bg:'linear-gradient(135deg,#b91c1c,#f97316)', biteship:'jnt'      },
  sicepat:   { name:'SiCepat',            abbr:'SCP',  bg:'linear-gradient(135deg,#c2410c,#fb923c)', biteship:'sicepat'  },
  spx:       { name:'SPX / Shopee Xpress',abbr:'SPX',  bg:'linear-gradient(135deg,#c2410c,#f97316)', special:'spx'       },
  anteraja:  { name:'Anteraja',           abbr:'ANT',  bg:'linear-gradient(135deg,#0369a1,#0ea5e9)', biteship:'anteraja' },
  tiki:      { name:'TIKI',               abbr:'TIKI', bg:'linear-gradient(135deg,#1d4ed8,#3b82f6)', biteship:'tiki'     },
  ninja:     { name:'Ninja Xpress',       abbr:'NXP',  bg:'linear-gradient(135deg,#374151,#6b7280)', biteship:'ninja'    },
  pos:       { name:'POS Indonesia',      abbr:'POS',  bg:'linear-gradient(135deg,#b45309,#f59e0b)', biteship:'pos'      },
  lion:      { name:'Lion Parcel',        abbr:'LP',   bg:'linear-gradient(135deg,#0891b2,#22d3ee)', biteship:'lion'     },
  sap:       { name:'SAP Express',        abbr:'SAP',  bg:'linear-gradient(135deg,#0369a1,#60a5fa)', biteship:'sap'      },
  jd:        { name:'JD Logistics',       abbr:'JD',   bg:'linear-gradient(135deg,#991b1b,#f87171)', biteship:'jd'       },
  ncs:       { name:'NCS',               abbr:'NCS',  bg:'linear-gradient(135deg,#065f46,#34d399)', biteship:'ncs'      },
  rpx:       { name:'RPX',               abbr:'RPX',  bg:'linear-gradient(135deg,#5b21b6,#a78bfa)', biteship:'rpx'      },
  paxel:     { name:'Paxel',             abbr:'PXL',  bg:'linear-gradient(135deg,#b45309,#fbbf24)', biteship:'paxel'    },
  idexpress: { name:'ID Express',         abbr:'IDX',  bg:'linear-gradient(135deg,#065f46,#4ade80)', biteship:'idexpress'},
  wahana:    { name:'Wahana',             abbr:'WHN',  bg:'linear-gradient(135deg,#9a3412,#fb923c)', biteship:'wahana'   },
  gosend:    { name:'GoSend',             abbr:'GO',   bg:'linear-gradient(135deg,#15803d,#22c55e)', biteship:'gosend'   },
  grab:      { name:'GrabExpress',        abbr:'GX',   bg:'linear-gradient(135deg,#15803d,#4ade80)', biteship:'grab'     },
  lazada:    { name:'Lazada Express',     abbr:'LZD',  bg:'linear-gradient(135deg,#9d174d,#f472b6)', biteship:'lazada'   },
  lalamove:  { name:'Lalamove',           abbr:'LLM',  bg:'linear-gradient(135deg,#c2410c,#fb923c)', biteship:'lalamove' },
};

// ── Fetch helpers ──────────────────────────────────────────────────
const PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function tryFetch(url, opts = {}, timeout = 9000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

async function fetchProxy(url, opts = {}) {
  // Try each proxy until one works
  let last;
  for (const proxy of PROXIES) {
    try {
      return await tryFetch(proxy(url), opts, 9000);
    } catch (e) {
      last = e;
      console.warn('[proxy] fallback…', e.message);
    }
  }
  throw last || new Error('Semua sumber gagal');
}

// ── API Strategies ─────────────────────────────────────────────────
async function trackBiteship(resi, code) {
  const url = `https://api.biteship.com/v1/public/trackings/${resi}/couriers/${code}`;
  const r = await fetchProxy(url, {
    headers: { accept:'application/json', authorization:'Public', origin:'https://biteship.com', referer:'https://biteship.com/' }
  });
  const d = await r.json();
  if (d?.error || !d) throw new Error(d?.error || 'Resi tidak ditemukan');
  return normBiteship(d, resi, code);
}

async function trackSPX(resi) {
  const url = `https://spx.co.id/shipment/order/open/order/get_order_info?spx_tn=${resi}&language_code=id`;
  const r = await fetchProxy(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'id-ID',
      cookie: 'app_source=nss; app_lang=id',
      referer: `https://spx.co.id/m/tracking-detail/${resi}`,
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    }
  });
  const json = await r.json();

  // Unwrap response shape (direct or wrapped in .data)
  const payload =
    json?.data?.sls_tracking_info ? json.data :
    json?.sls_tracking_info       ? json :
    json?.data                    ? json.data :
    json;

  if (!payload?.sls_tracking_info && !payload?.fulfillment_info) {
    throw new Error('Data SPX tidak ditemukan. Cek kembali nomor resi.');
  }
  return normSPX(payload, resi);
}

// ── Normalizers ────────────────────────────────────────────────────
function normBiteship(raw, resi, code) {
  const c = COURIERS[code] || { name: code, abbr: code.toUpperCase(), bg:'linear-gradient(135deg,#555,#777)' };
  const history = (raw.history || []).map(h => ({
    date: h.updated_at || h.date || '',
    desc: h.note || h.status || '',
    loc:  h.location || '',
  }));
  const st = raw.status || history[0]?.desc || '';
  return { resi, code, name: c.name, abbr: c.abbr, bg: c.bg,
    status: st, statusKey: classify(st),
    origin: raw.origin || '', dest: raw.destination || '',
    service: raw.service_type || raw.courier_type || '', history, raw };
}

function normSPX(raw, resi) {
  const c = COURIERS.spx;
  const sls = raw?.sls_tracking_info || {};
  const all = Array.isArray(sls.records) ? sls.records : [];
  // Show records with display_flag_v2 !== 0; fallback to all
  const vis = all.filter(r => r.display_flag_v2 !== 0);
  const src = vis.length ? vis : all;

  const history = src.map(r => ({
    date: r.actual_time ? new Date(r.actual_time * 1000).toISOString() : '',
    desc: r.buyer_description || r.description || '',
    loc:  r.current_location?.location_name || '',
  }));

  const first = src[0] || {};
  const last  = src[src.length - 1] || {};
  const st = raw?.order_status_desc || first.milestone_name || history[0]?.desc || 'Dalam Pengiriman';

  return { resi: sls.sls_tn || resi, code:'spx', name: c.name, abbr: c.abbr, bg: c.bg,
    status: st, statusKey: classify(st),
    origin: last.current_location?.location_name  || '',
    dest:   first.next_location?.location_name    || '',
    service: 'SPX Express', history, raw };
}

function classify(s = '') {
  const t = s.toLowerCase();
  if (/delivered|diterima|terima|selesai|sampai|sukses/.test(t)) return 'delivered';
  if (/transit|proses|pengiriman|dalam|sorting|hub|dikirim|disortir/.test(t)) return 'transit';
  if (/pickup|dijemput|ambil|collected|penjemputan/.test(t)) return 'pickup';
  if (/gagal|fail|retur|return|cancel|batal/.test(t)) return 'problem';
  return 'unknown';
}

async function trackPackage(resi, key) {
  const c = COURIERS[key];
  if (!c) throw new Error('Ekspedisi tidak dikenal');
  if (c.special === 'spx') return trackSPX(resi);
  if (c.biteship)          return trackBiteship(resi, c.biteship);
  throw new Error('Ekspedisi ini belum didukung');
}

// ── Helpers ────────────────────────────────────────────────────────
function fmtDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return s; }
}

const statusLabels = { delivered:'Terkirim', transit:'Dalam Pengiriman', pickup:'Dijemput', problem:'Bermasalah', unknown:'Dalam Proses' };

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── UI ─────────────────────────────────────────────────────────────
function setLoading(on) {
  const overlay  = document.getElementById('cardOverlay');
  const btnText  = document.getElementById('btnText');
  const btnLoad  = document.getElementById('btnLoader');
  const trackBtn = document.getElementById('trackBtn');
  const resiInput= document.getElementById('resiInput');
  const selEl    = document.getElementById('courierSelect');
  const examples = document.querySelectorAll('.ex-btn');

  overlay.classList.toggle('hidden', !on);
  btnText.classList.toggle('hidden', on);
  btnLoad.classList.toggle('hidden', !on);
  trackBtn.disabled  = on;
  resiInput.disabled = on;
  selEl.disabled     = on;
  examples.forEach(b => b.disabled = on);
}

function showSection(id) {
  ['heroSection','resultSec','errorSec'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
  // keep hero visible with result
  if (id === 'resultSec') document.getElementById('heroSection').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderResult(data) {
  document.getElementById('resiTag').textContent = data.resi;

  const icon = document.getElementById('courierIcon');
  icon.style.background = data.bg;
  icon.textContent = data.abbr;

  document.getElementById('courierName').textContent = data.name;
  document.getElementById('courierResi').textContent = data.resi;

  const pill = document.getElementById('statusPill');
  pill.textContent = statusLabels[data.statusKey] || 'Dalam Proses';
  pill.className = `status-pill ${data.statusKey}`;

  // Meta
  const metas = [
    { k:'Status',  v: data.status  || '—' },
    { k:'Asal',    v: data.origin  || '—' },
    { k:'Tujuan',  v: data.dest    || '—' },
    { k:'Layanan', v: data.service || '—' },
  ].filter(m => m.v !== '—' || m.k === 'Status');
  document.getElementById('metaGrid').innerHTML = metas.map(m =>
    `<div class="meta-box"><div class="meta-k">${m.k}</div><div class="meta-v">${esc(m.v)}</div></div>`
  ).join('');

  // Timeline
  const tl = document.getElementById('timeline');
  if (!data.history?.length) {
    tl.innerHTML = '<p style="color:var(--txt-3);font-size:.825rem">Belum ada riwayat pengiriman.</p>';
  } else {
    const locPin = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    tl.innerHTML = data.history.map((h, i) => {
      const cls = i === 0 ? 'first' : i === data.history.length - 1 ? 'last' : 'middle';
      const loc = h.loc ? `<div class="tl-loc">${locPin}${esc(h.loc)}</div>` : '';
      return `<div class="tl-item"><div class="tl-dot ${cls}"></div>
        <div class="tl-time">${esc(fmtDate(h.date))}</div>
        <div class="tl-desc">${esc(h.desc)}</div>${loc}</div>`;
    }).join('');
  }

  document.getElementById('jsonPre').textContent = JSON.stringify(data.raw, null, 2);
  showSection('resultSec');
}

function renderError(msg) {
  document.getElementById('errMsg').textContent = msg || 'Terjadi kesalahan. Coba beberapa saat lagi.';
  showSection('errorSec');
}

// ── Main ───────────────────────────────────────────────────────────
async function doTrack() {
  const resi = document.getElementById('resiInput').value.trim();
  const key  = document.getElementById('courierSelect').value;

  if (!resi) {
    shake(document.getElementById('resiInput')); return;
  }
  if (!key) {
    shake(document.getElementById('courierSelect')); return;
  }

  setLoading(true);
  // Rotate overlay messages
  const msgs = ['Menghubungi server ekspedisi…','Mengambil data pengiriman…','Memproses informasi resi…'];
  let mi = 0;
  const msgEl = document.getElementById('overlayText');
  const msgTick = setInterval(() => { mi=(mi+1)%msgs.length; msgEl.textContent=msgs[mi]; }, 1800);

  try {
    const data = await trackPackage(resi, key);
    renderResult(data);
  } catch (err) {
    console.error('[TrackID]', err);
    renderError(err.message);
  } finally {
    clearInterval(msgTick);
    setLoading(false);
  }
}

function shake(el) {
  el.style.borderColor = 'var(--red)';
  el.style.animation = 'none';
  el.animate([
    { transform:'translateX(0)' },
    { transform:'translateX(-5px)' },
    { transform:'translateX(5px)' },
    { transform:'translateX(-4px)' },
    { transform:'translateX(4px)' },
    { transform:'translateX(0)' },
  ], { duration:320, easing:'ease-out' });
  setTimeout(() => { el.style.borderColor=''; }, 1400);
  el.focus();
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const resiInput = document.getElementById('resiInput');
  const clearBtn  = document.getElementById('clearBtn');

  resiInput.addEventListener('input', () => {
    clearBtn.classList.toggle('on', resiInput.value.length > 0);
    resiInput.style.borderColor = '';
  });
  resiInput.addEventListener('keydown', e => { if (e.key === 'Enter') doTrack(); });
  clearBtn.addEventListener('click', () => {
    resiInput.value = '';
    clearBtn.classList.remove('on');
    resiInput.focus();
  });

  document.getElementById('trackBtn').addEventListener('click', doTrack);
  document.getElementById('backBtn').addEventListener('click', () => showSection('heroSection'));
  document.getElementById('retryBtn').addEventListener('click', () => showSection('heroSection'));
  document.getElementById('logoHome').addEventListener('click', e => { e.preventDefault(); showSection('heroSection'); });
  document.getElementById('navTrack').addEventListener('click', e => { e.preventDefault(); showSection('heroSection'); });

  // Quick examples
  document.querySelectorAll('.ex-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      resiInput.value = btn.dataset.resi;
      document.getElementById('courierSelect').value = btn.dataset.c;
      clearBtn.classList.add('on');
    });
  });

  // JSON toggle
  const jsonToggle = document.getElementById('jsonToggle');
  const jsonBox    = document.getElementById('jsonBox');
  jsonToggle.addEventListener('click', () => {
    const open = jsonBox.classList.toggle('hidden');
    jsonToggle.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> ${open ? 'Lihat Data Mentah (JSON)' : 'Sembunyikan JSON'}`;
  });

  // FAQ accordion
  document.querySelectorAll('.faq-item').forEach(item => {
    item.querySelector('.faq-q').addEventListener('click', () => {
      const was = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
      if (!was) item.classList.add('open');
    });
  });

  // Smooth anchor nav
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const t = document.querySelector(a.getAttribute('href'));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior:'smooth' }); }
    });
  });

  // Telegram Integration Logic
  const btnSendTg = document.getElementById('btnSendTg');
  const tgChatIdInput = document.getElementById('tgChatId');
  const tgStatus = document.getElementById('tgStatus');
  const tgBtnText = document.getElementById('tgBtnText');
  const tgBtnLoader = document.getElementById('tgBtnLoader');

  if (btnSendTg) {
    btnSendTg.addEventListener('click', async () => {
      const chatId = tgChatIdInput.value.trim();
      const resi = document.getElementById('courierResi').textContent;
      const courier = document.getElementById('courierSelect').value;

      if (!chatId) {
        shake(tgChatIdInput);
        return;
      }

      // UI Loading State
      btnSendTg.disabled = true;
      tgBtnText.classList.add('hidden');
      tgBtnLoader.classList.remove('hidden');
      tgStatus.classList.add('hidden');

      try {
        // Send request to Vercel API
        const response = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, resi, courier })
        });

        const result = await response.json();

        if (result.success) {
          tgStatus.textContent = '✅ Berhasil dikirim ke Telegram!';
          tgStatus.style.color = 'var(--green)';
        } else {
          throw new Error(result.error || 'Gagal mengirim');
        }
      } catch (err) {
        console.error('[Telegram Send Error]', err);
        tgStatus.textContent = '❌ Gagal: ' + (err.message.includes('Failed to fetch') ? 'Server bot belum jalan' : err.message);
        tgStatus.style.color = 'var(--red)';
      } finally {
        tgStatus.classList.remove('hidden');
        btnSendTg.disabled = false;
        tgBtnText.classList.remove('hidden');
        tgBtnLoader.classList.add('hidden');
      }
    });
  }
});
