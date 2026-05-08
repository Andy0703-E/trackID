'use strict';

/**
 * tracker.js — Shared tracking logic for TrackID Bot
 * Supports: Biteship Public API + SPX Direct API
 */

const axios = require('axios');

// ── Courier config ─────────────────────────────────────────────────
const COURIERS = {
  jne:       { name: 'JNE Express',          biteship: 'jne'      },
  jnt:       { name: 'J&T Express',          biteship: 'jnt'      },
  jet:       { name: 'J&T Express',          biteship: 'jnt'      },
  sicepat:   { name: 'SiCepat',              biteship: 'sicepat'  },
  scp:       { name: 'SiCepat',              biteship: 'sicepat'  },
  spx:       { name: 'SPX / Shopee Express', special: 'spx'       },
  shopee:    { name: 'SPX / Shopee Express', special: 'spx'       },
  anteraja:  { name: 'Anteraja',             biteship: 'anteraja' },
  tiki:      { name: 'TIKI',                 biteship: 'tiki'     },
  ninja:     { name: 'Ninja Xpress',         biteship: 'ninja'    },
  pos:       { name: 'POS Indonesia',        biteship: 'pos'      },
  lion:      { name: 'Lion Parcel',          biteship: 'lion'     },
  sap:       { name: 'SAP Express',          biteship: 'sap'      },
  jd:        { name: 'JD Logistics',         biteship: 'jd'       },
  paxel:     { name: 'Paxel',               biteship: 'paxel'    },
  idexpress: { name: 'ID Express',           biteship: 'idexpress'},
  wahana:    { name: 'Wahana',               biteship: 'wahana'   },
  gosend:    { name: 'GoSend',               biteship: 'gosend'   },
  grab:      { name: 'GrabExpress',          biteship: 'grab'     },
  lazada:    { name: 'Lazada Express',       biteship: 'lazada'   },
};

const COURIER_ALIASES = {
  'j&t': 'jnt', 'jt': 'jnt', 'sicepat': 'sicepat', 'shopeeexpress': 'spx',
  'shopeexpress': 'spx', 'spxexpress': 'spx',
};

function resolveCourier(input) {
  const clean = input.toLowerCase().replace(/[\s\-_]/g, '');
  return COURIERS[clean] ? clean
    : COURIER_ALIASES[clean] ? COURIER_ALIASES[clean]
    : null;
}

// ── Axios helpers ──────────────────────────────────────────────────
const PROXY_HEADERS_BITESHIP = {
  accept: 'application/json',
  authorization: 'Public',
  origin: 'https://biteship.com',
  referer: 'https://biteship.com/',
  'user-agent': 'Mozilla/5.0 (compatible; TrackID-Bot/1.0)',
};

const PROXY_HEADERS_SPX = (resi) => ({
  accept: 'application/json, text/plain, */*',
  'accept-language': 'id-ID',
  cookie: 'app_source=nss; app_lang=id',
  referer: `https://spx.co.id/m/tracking-detail/${resi}`,
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
});

// ── API calls ──────────────────────────────────────────────────────
async function trackBiteship(resi, courierCode) {
  const url = `https://api.biteship.com/v1/public/trackings/${resi}/couriers/${courierCode}`;
  const { data } = await axios.get(url, {
    headers: PROXY_HEADERS_BITESHIP,
    timeout: 12000,
  });
  if (data?.error) throw new Error(data.error);
  return normalizeBiteship(data, resi, courierCode);
}

async function trackSPX(resi) {
  const url = `https://spx.co.id/shipment/order/open/order/get_order_info?spx_tn=${resi}&language_code=id`;
  const { data: json } = await axios.get(url, {
    headers: PROXY_HEADERS_SPX(resi),
    timeout: 12000,
  });

  const payload =
    json?.data?.sls_tracking_info ? json.data :
    json?.sls_tracking_info       ? json :
    json?.data                    ? json.data :
    json;

  if (!payload?.sls_tracking_info && !payload?.fulfillment_info) {
    throw new Error('Data SPX tidak ditemukan. Pastikan nomor resi benar.');
  }
  return normalizeSPX(payload, resi);
}

// ── Normalizers ────────────────────────────────────────────────────
function normalizeBiteship(raw, resi, code) {
  const c = COURIERS[code];
  const history = (raw.history || []).map(h => ({
    date: h.updated_at || h.date || '',
    desc: h.note || h.status || '',
    loc:  h.location || '',
  }));
  const status = raw.status || history[0]?.desc || '';
  return {
    resi,
    courierName: c?.name || code,
    status,
    statusKey: classifyStatus(status),
    origin: raw.origin || '',
    dest: raw.destination || '',
    service: raw.service_type || raw.courier_type || '',
    history,
  };
}

function normalizeSPX(raw, resi) {
  const sls = raw?.sls_tracking_info || {};
  const all = Array.isArray(sls.records) ? sls.records : [];
  const vis = all.filter(r => r.display_flag_v2 !== 0);
  const src = vis.length ? vis : all;

  const history = src.map(r => ({
    date: r.actual_time ? new Date(r.actual_time * 1000).toISOString() : '',
    desc: r.buyer_description || r.description || '',
    loc:  r.current_location?.location_name || '',
  }));

  const first = src[0] || {};
  const last  = src[src.length - 1] || {};
  const status = raw?.order_status_desc || first.milestone_name || history[0]?.desc || 'Dalam Pengiriman';

  return {
    resi: sls.sls_tn || resi,
    courierName: 'SPX / Shopee Express',
    status,
    statusKey: classifyStatus(status),
    origin: last.current_location?.location_name || '',
    dest: first.next_location?.location_name || '',
    service: 'SPX Express',
    history,
  };
}

function classifyStatus(s = '') {
  const t = s.toLowerCase();
  if (/delivered|diterima|terima|selesai|sampai|sukses/.test(t)) return 'delivered';
  if (/transit|proses|pengiriman|dalam|sorting|hub|dikirim|disortir/.test(t)) return 'transit';
  if (/pickup|dijemput|ambil|collected/.test(t)) return 'pickup';
  if (/gagal|fail|retur|return|cancel|batal/.test(t)) return 'problem';
  return 'unknown';
}

// ── Main export ────────────────────────────────────────────────────
async function trackPackage(resi, courierInput) {
  const key = resolveCourier(courierInput);
  if (!key) throw new Error(`Ekspedisi tidak dikenal: *${courierInput}*\nGunakan /ekspedisi untuk daftar kode yang valid.`);

  const c = COURIERS[key];
  if (c.special === 'spx') return trackSPX(resi);
  if (c.biteship) return trackBiteship(resi, c.biteship);
  throw new Error('Ekspedisi ini belum didukung');
}

module.exports = { trackPackage, COURIERS, resolveCourier };
