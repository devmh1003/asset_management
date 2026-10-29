// 환율 자동 갱신 — open.er-api.com (무료, 키 불필요, 하루 1회 갱신)
// 결과: { USD: 1450.12, ... } (1 단위당 원), updatedAt (ISO)
const API = 'https://open.er-api.com/v6/latest/KRW';

export async function fetchRates(codes) {
  const res = await fetch(API, { cache: 'no-store' });
  if (!res.ok) throw new Error(`환율 API 응답 오류 (${res.status})`);
  const json = await res.json();
  if (json.result !== 'success' || !json.rates) throw new Error('환율 데이터를 읽지 못했습니다');
  const out = {};
  for (const c of codes) {
    if (c === 'KRW') { out.KRW = 1; continue; }
    const perKrw = json.rates[c];
    if (perKrw) out[c] = +(1 / perKrw).toFixed(c === 'JPY' || c === 'TWD' ? 4 : 2);
  }
  return { rates: out, updatedAt: new Date().toISOString(), source: json.time_last_update_utc || '' };
}

export const isStale = (iso, hours = 12) => !iso || Date.now() - new Date(iso).getTime() > hours * 3600 * 1000;
