'use strict';

const axios = require('axios');

const COURIERS = {
  jne:       { name: 'JNE Express',          biteship: 'jne'      },
  jnt:       { name: 'J&T Express',          biteship: 'jnt'      },
  sicepat:   { name: 'SiCepat',              biteship: 'sicepat'  },
  spx:       { name: 'SPX / Shopee Express', special: 'spx'       },
  anteraja:  { name: 'Anteraja',             biteship: 'anteraja' },
  tiki:      { name: 'TIKI',                 biteship: 'tiki'     },
  ninja:     { name: 'Ninja Xpress',         biteship: 'ninja'    },
  pos:       { name: 'POS Indonesia',        biteship: 'pos'      },
  lion:      { name: 'Lion Parcel',          biteship: 'lion'     },
  idexpress: { name: 'ID Express',           biteship: 'idexpress'},
};

const COURIER_ALIASES = {
  'j&t': 'jnt', 'jt': 'jnt', 'shopee': 'spx', 'shopeeexpress': 'spx',
};

function resolveCourier(input) {
  const clean = input.toLowerCase().replace(/[\s\-_]/g, '');
  return COURIERS[clean] ? clean : (COURIER_ALIASES[clean] || null);
}

function classifyStatus(s = '') {
  const t = s.toLowerCase();
  if (/delivered|diterima|terima|selesai|sampai|sukses/.test(t)) return 'delivered';
  if (/transit|proses|pengiriman|dalam|sorting|hub|dikirim|disortir/.test(t)) return 'transit';
  if (/pickup|dijemput|ambil|collected/.test(t)) return 'pickup';
  if (/gagal|fail|retur|return|cancel|batal/.test(t)) return 'problem';
  return 'unknown';
}

async function trackBiteship(resi, courierCode) {
  const url = `https://api.biteship.com/v1/public/trackings/${resi}/couriers/${courierCode}`;
  const { data } = await axios.get(url, {
    headers: {
      accept: 'application/json',
      authorization: 'Public',
      origin: 'https://biteship.com',
      referer: 'https://biteship.com/',
    },
    timeout: 10000,
  });
  
  const history = (data.history || []).map(h => ({
    date: h.updated_at || h.date || '',
    desc: h.note || h.status || '',
    loc:  h.location || '',
  }));
  const status = data.status || history[0]?.desc || '';

  return {
    resi,
    courierName: COURIERS[courierCode]?.name || courierCode,
    status,
    statusKey: classifyStatus(status),
    origin: data.origin || '',
    dest: data.destination || '',
    service: data.service_type || data.courier_type || '',
    history,
  };
}

async function trackSPX(resi) {
  const url = `https://spx.co.id/shipment/order/open/order/get_order_info?spx_tn=${resi}&language_code=id`;
  const { data: json } = await axios.get(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: 'app_source=nss; app_lang=id',
      referer: `https://spx.co.id/m/tracking-detail/${resi}`,
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    },
    timeout: 10000,
  });

  const payload = json?.data?.sls_tracking_info ? json.data : (json?.sls_tracking_info ? json : json?.data || json);

  if (!payload?.sls_tracking_info) throw new Error('Data SPX tidak ditemukan.');

  const sls = payload.sls_tracking_info;
  const records = (sls.records || []).filter(r => r.display_flag_v2 !== 0);
  const src = records.length ? records : (sls.records || []);

  const history = src.map(r => ({
    date: r.actual_time ? new Date(r.actual_time * 1000).toISOString() : '',
    desc: r.buyer_description || r.description || '',
    loc:  r.current_location?.location_name || '',
  }));

  const status = payload.order_status_desc || src[0]?.milestone_name || history[0]?.desc || 'Dalam Pengiriman';

  return {
    resi: sls.sls_tn || resi,
    courierName: 'SPX / Shopee Express',
    status,
    statusKey: classifyStatus(status),
    origin: src[src.length - 1]?.current_location?.location_name || '',
    dest: src[0]?.next_location?.location_name || '',
    service: 'SPX Express',
    history,
  };
}

async function trackPackage(resi, courierInput) {
  const key = resolveCourier(courierInput);
  if (!key) throw new Error(`Ekspedisi tidak dikenal: ${courierInput}`);

  const c = COURIERS[key];
  if (c.special === 'spx') return trackSPX(resi);
  if (c.biteship) return trackBiteship(resi, c.biteship);
  throw new Error('Ekspedisi belum didukung');
}

module.exports = { trackPackage, COURIERS };
