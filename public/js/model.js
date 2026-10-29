// 기본 설정, 엑셀 구조 기반 템플릿, 계산 로직

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const today = () => new Date().toISOString().slice(0, 10);

// 분류체계: 대분류(major) → 그룹(Var 현금성 / Risk 위험자산 / Fixed 고정수익·안전) → 중분류(mids)
export const DEFAULT_TAXONOMY = [
  { major: '현금', group: 'Var', mids: ['입출금', '예금', '적금', '파킹/CMA', '비상금', '보증금', '청약저축', '외화예금'] },
  { major: '투자', group: 'Risk', mids: ['국내주식', '해외주식', 'ETF', '채권형ETF', '펀드', 'ISA', '리츠', '원자재/금', '파생/레버리지', '주식'] },
  { major: '가상자산', group: 'Risk', mids: ['비트코인', '이더리움', '알트코인', '스테이블코인', '거래소 현물', '스테이킹/디파이', '개인지갑', 'NFT', '가상자산'] },
  { major: '대체투자', group: 'Risk', mids: ['NFT', 'P2P', 'PF', '비상장주식/스타트업', '크라우드펀딩', '미술품/조각투자', '기타'] },
  { major: '채권형자산', group: 'Fixed', mids: ['국내채권', '해외채권', 'P2P', 'PF', '대여금'] },
  { major: '연금/보험', group: 'Fixed', mids: ['연금저축', 'IRP', '퇴직연금', '저축성보험'] },
  { major: '부동산', group: 'Fixed', mids: ['거주용', '투자용', '리츠'] },
  { major: '기타', group: 'Fixed', mids: ['외화', '연금', '비상장주식', '금/실물', 'NFT', '기타'] },
];

// 이름 키워드 → [대분류, 중분류] 자동 분류 사전 (앞에 있을수록 우선)
export const CLASSIFY_RULES = [
  [/업비트|upbit|빗썸|bithumb|코인원|coinone|코빗|korbit|바이낸스|binance|바이비트|bybit|okx|coinbase|크라켄|kraken/i, ['가상자산', '거래소 현물']],
  [/스테이킹|staking|디파이|defi|렌딩|nexo|klay|lido|이자농사|yield/i, ['가상자산', '스테이킹/디파이']],
  [/메타마스크|metamask|팬텀|phantom|렛저|ledger|트레저|trezor|콜드월렛|지갑|wallet/i, ['가상자산', '개인지갑']],
  [/비트코인|bitcoin|btc\b|wbtc/i, ['가상자산', '비트코인']],
  [/이더리움|ethereum|\beth\b|steth/i, ['가상자산', '이더리움']],
  [/usdt|usdc|테더|스테이블|stable|dai\b/i, ['가상자산', '스테이블코인']],
  [/솔라나|sol\b|리플|xrp|도지|doge|에이다|ada\b|알트/i, ['가상자산', '알트코인']],
  [/nft|오픈씨|opensea|콩즈|kongz/i, ['대체투자', 'NFT']],
  [/피플펀드|8퍼센트|8percent|어니스트|honest|투게더|렌딧|p2p/i, ['대체투자', 'P2P']],
  [/모햇|태양광|pf\b|프로젝트파이낸싱|부동산펀딩/i, ['대체투자', 'PF']],
  [/비상장|스타트업|엔젤|두나무|민트에어|프리ipo/i, ['대체투자', '비상장주식/스타트업']],
  [/와디즈|wadiz|텀블벅|크라우드/i, ['대체투자', '크라우드펀딩']],
  [/테사|tessa|아트앤가이드|소투|조각|미술품|뮤직카우|카사|kasa/i, ['대체투자', '미술품/조각투자']],
  [/청약/, ['현금', '청약저축']],
  [/비상금|buffer|버퍼/i, ['현금', '비상금']],
  [/보증금|전세|월세보증/, ['현금', '보증금']],
  [/파킹|cma|머니마켓|mmf|대기자금|모으기|저금통/i, ['현금', '파킹/CMA']],
  [/적금/, ['현금', '적금']],
  [/정기예금|예금|예탁/, ['현금', '예금']],
  [/입출금|생활비|월급통장|급여통장|체크/, ['현금', '입출금']],
  [/외화예금|외화통장|다통화/, ['현금', '외화예금']],
  [/달러|usd|엔화|jpy|유로|eur|위안|cny|파운드|gbp|싱가폴|싱가포르|sgd|대만|twd|홍콩|hkd|트래블월렛|트레블월렛|외화/i, ['기타', '외화']],
  [/연금저축/, ['연금/보험', '연금저축']],
  [/irp|개인형퇴직/i, ['연금/보험', 'IRP']],
  [/퇴직연금|dc형|db형/i, ['연금/보험', '퇴직연금']],
  [/보험|변액|저축성/, ['연금/보험', '저축성보험']],
  [/isa\b/i, ['투자', 'ISA']],
  [/리츠|reit/i, ['투자', '리츠']],
  [/금\b|골드|gold|은\b|실버|원자재|원유|구리|corn|옥수수/i, ['투자', '원자재/금']],
  [/레버리지|인버스|tqqq|sqqq|soxl|선물|옵션|곱버스/i, ['투자', '파생/레버리지']],
  [/채권형|국채|회사채|tlt|vclt|bnd\b|채권etf/i, ['투자', '채권형ETF']],
  [/채권|어음|rp\b/i, ['채권형자산', '국내채권']],
  [/etf|spy|qqq|voo|schd|jepi|tiger|kodex|arirang|kbstar/i, ['투자', 'ETF']],
  [/펀드|베트남|인도|인디아|그로스|증권투자신탁|ai 펀드|파운트/i, ['투자', '펀드']],
  [/토스증권|삼성증권|신한.*(증권|금투)|한투|한국투자|kb증권|nh투자|미래에셋|키움|카카오.*증권|해외주식|나스닥|미국주식|테슬라|애플|엔비디아|알파벳|마이크로소프트|아마존/i, ['투자', '해외주식']],
  [/국내주식|삼성전자|코스피|코스닥|하이닉스|현대차/, ['투자', '국내주식']],
  [/주식|증권/, ['투자', '해외주식']],
  [/대여|빌려준|차용/, ['채권형자산', '대여금']],
  [/아파트|오피스텔|빌라|주택|토지|상가/, ['부동산', '거주용']],
  [/토스|카카오뱅크|케이뱅크|kbank|신한|국민|하나|우리|농협|기업은행|은행/i, ['현금', '예금']],
];
export function classifyName(name) {
  const s = String(name || '').trim();
  if (!s) return null;
  for (const [re, cls] of CLASSIFY_RULES) if (re.test(s)) return cls;
  return null;
}
// 이름에 통화 힌트가 있으면 통화 코드 반환
export function currencyHint(name) {
  const s = String(name || '');
  if (/달러|usd|\$/i.test(s) && !/싱가|대만|홍콩|호주|캐나다/.test(s)) return 'USD';
  if (/엔화|jpy|¥|엔\b/i.test(s)) return 'JPY';
  if (/유로|eur|€/i.test(s)) return 'EUR';
  if (/싱가|sgd/i.test(s)) return 'SGD';
  if (/대만|twd|nt\$/i.test(s)) return 'TWD';
  return null;
}

// 금액 문자열 파싱: "1.2억", "500만", "3천", "1,200만원", "$1,000", "₩50000", "1억 2천만" → { value, currency? }
export function parseAmount(input) {
  if (typeof input === 'number') return { value: input };
  let s = String(input ?? '').trim();
  if (!s) return { value: 0 };
  let currency = null;
  if (/^\$|usd/i.test(s)) currency = 'USD';
  else if (/^€|eur/i.test(s)) currency = 'EUR';
  else if (/^¥|jpy|엔$/i.test(s)) currency = 'JPY';
  else if (/^₩|krw|원$/i.test(s)) currency = 'KRW';
  const neg = /^-|^\(.*\)$/.test(s);
  s = s.replace(/[$€¥₩,\s()]/g, '').replace(/^-/, '').replace(/(usd|eur|jpy|krw|원|달러|엔|유로)$/i, '');
  const units = { 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4, 천: 1e3, 백: 1e2 };
  let total = 0, matched = false;
  const re = /(\d+(?:\.\d+)?)(억|천만|백만|만|천|백)?/g;
  let m;
  while ((m = re.exec(s))) {
    if (!m[0]) break;
    matched = true;
    total += parseFloat(m[1]) * (m[2] ? units[m[2]] : 1);
  }
  if (!matched) return { value: 0, currency };
  return { value: neg ? -total : total, currency };
}

// 자동 정리: 공백·중복공백 제거, 분류 미지정(or 기본값) 행 자동 분류. 변경된 행 목록 반환
export function tidyAssets(rows, taxonomy) {
  const changed = [];
  const firstMajor = taxonomy[0]?.major, firstMid = taxonomy[0]?.mids?.[0];
  for (const r of rows) {
    let c = false;
    for (const k of ['name', 'manager', 'note', 'mid', 'major']) {
      const v = String(r[k] ?? '');
      const t = v.replace(/\s+/g, ' ').trim();
      if (t !== v) { r[k] = t; c = true; }
    }
    const isDefault = !r.major || !r.mid || (r.major === firstMajor && r.mid === firstMid && !/생활비|입출금/.test(r.name));
    if (isDefault) {
      const cls = classifyName(r.name) || classifyName(r.manager);
      if (cls && (cls[0] !== r.major || cls[1] !== r.mid)) { r.major = cls[0]; r.mid = cls[1]; c = true; }
    }
    if (!r.currency) { r.currency = currencyHint(r.name) || 'KRW'; c = true; }
    if (c) changed.push(r);
  }
  return changed;
}

export const DEFAULT_SETTINGS = {
  // 원화 환산 환율 (1 단위당 원). JPY 는 1엔 기준
  fx: { KRW: 1, USD: 1450, EUR: 1690, JPY: 9.5, SGD: 1120, TWD: 46 },
  fxUpdatedAt: null,
  fxAuto: true,
  taxonomy: DEFAULT_TAXONOMY,
};

// 기존 설정에 새 분류를 비파괴적으로 추가 (사용자가 만든 분류는 유지)
export function mergeTaxonomy(taxonomy, template = DEFAULT_TAXONOMY) {
  const out = (taxonomy || []).map((t) => ({ ...t, mids: [...(t.mids || [])] }));
  let changed = false;
  for (const d of template || DEFAULT_TAXONOMY) {
    const t = out.find((x) => x.major === d.major);
    if (!t) { out.push({ ...d, mids: [...d.mids] }); changed = true; continue; }
    for (const m of d.mids) if (!t.mids.includes(m)) { t.mids.push(m); changed = true; }
  }
  return { taxonomy: out, changed };
}

export const CF_GROUPS = {
  수입: ['급여', '성과급', '기타소득', '잡소득', '투자수익'],
  지출: ['고정비', '변동비', '기타비용', '잡비용', '투자지출'],
};

// 엑셀(B.S 시트)의 항목 구조 — 금액은 0
const A = (major, mid, name, currency, rate, manager = '', note = '') => ({ major, mid, name, currency, value: 0, rate, manager, note });
export const TEMPLATE_ASSETS = [
  A('현금', '입출금', '생활비', 'KRW', 0, '토스', '생활비'),
  A('현금', '파킹/CMA', '투자대기자금', 'KRW', 0.02, '토스'),
  A('현금', '적금', '적금종합', 'KRW', 0.03, '신한은행'),
  A('현금', '청약저축', '청약통장', 'KRW', 0.035, '신한은행'),
  A('현금', '보증금', '보증금', 'KRW', 0, '오피스텔담보'),
  A('현금', '비상금', 'Buffer 자금', 'KRW', 0, '토스', '비상자금'),
  A('투자', '국내주식', '삼성증권 굴링', 'KRW', 0.15, '삼성증권', 'AI활용투자'),
  A('투자', '국내주식', '기타증권종합', 'KRW', 0.15),
  A('투자', '해외주식', '신한금투(소액)', 'KRW', 0.15, '신한금투'),
  A('투자', '해외주식', '삼성증권 종합', 'KRW', 0.15, '삼성증권'),
  A('투자', '해외주식', '토스증권', 'KRW', 0.3, '토스증권'),
  A('투자', '펀드', '우리미국바이오', 'KRW', 0.15, '신한은행'),
  A('투자', '펀드', '카카오 증권', 'KRW', 0.15, '카카오페이'),
  A('투자', '펀드', '한투 베트남', 'KRW', 0.15, '신한은행'),
  A('투자', '펀드', '삼성증권 인도', 'KRW', 0.15, '신한은행'),
  A('투자', '펀드', '한미성장펀드', 'KRW', 0.15, '국민은행'),
  A('가상자산', '거래소 현물', 'Coinone', 'KRW', 0.4, 'Coinone', '현물'),
  A('가상자산', '거래소 현물', 'Bithumb', 'KRW', 0.4, 'Bithumb', '현물'),
  A('가상자산', '스테이킹', 'Binance', 'USD', 0.4, 'Binance', '단기 Staking'),
  A('가상자산', '스테이킹', 'NEXO', 'USD', 0.4, 'NEXO', '단기 Staking'),
  A('가상자산', '개인지갑', 'Phantom', 'USD', 0.4, 'Phantom', '단기 Staking'),
  A('가상자산', '스테이킹', 'Upbit', 'KRW', 0.4, 'Upbit', '단기 Staking'),
  A('가상자산', '개인지갑', 'MetaMask', 'USD', 0.4, 'MetaMask', 'WBTC'),
  A('채권형자산', 'P2P', '어니스트펀드', 'KRW', 0.02, '어니스트펀드'),
  A('채권형자산', 'P2P', '피플펀드', 'KRW', 0.02, '피플펀드'),
  A('채권형자산', 'PF', '모햇(태양광)', 'KRW', 0.12, '모햇'),
  A('연금/보험', '연금저축', '연금저축', 'KRW', 0.1, '삼성증권'),
  A('기타', '외화', '미국 달러', 'USD', 0, '현금보관'),
  A('기타', '외화', '대만달러', 'TWD', 0, '현금보관'),
  A('기타', '외화', '싱가폴달러', 'SGD', 0, '현금보관'),
  A('기타', '외화', '유로', 'EUR', 0, '현금보관'),
];

export const TEMPLATE_LIABILITIES = [
  { creditor: '한국장학재단', amount: 0, maturity: '', rate: 0.017, repay: '급여', note: '' },
  { creditor: '카카오뱅크', amount: 0, maturity: '2027-02-24', rate: 0.0355, repay: '급여', note: '' },
  { creditor: '신한은행', amount: 0, maturity: '', rate: 0.041, repay: '급여', note: '' },
];

// C.F 시트 항목 구조 (단위: 만원)
export const TEMPLATE_CASHFLOW = [
  ['수입', '급여', '세후급여'],
  ['수입', '성과급', '세후성과급'],
  ['수입', '기타소득', '기타소득'],
  ['수입', '잡소득', '잡소득'],
  ['지출', '고정비', '주거비'],
  ['지출', '고정비', '공과금'],
  ['지출', '고정비', '이자'],
  ['지출', '고정비', '기본생활비'],
  ['지출', '고정비', '경조사비'],
  ['지출', '고정비', '보험비'],
  ['지출', '고정비', '기타 처신비'],
  ['지출', '변동비', '변동비'],
  ['지출', '기타비용', '기타비용'],
  ['지출', '잡비용', '잡비용'],
].map(([type, group, name]) => ({ type, group, name, m: Array(12).fill(0) }));

// 포폴구성 시트 구조
const P = (group, major, mid, form, maxRate, minRate, avgRate) => ({ group, major, mid, form, amount: 0, maxRate, minRate, avgRate, note: '' });
export const TEMPLATE_PORTFOLIO = [
  P('투자자산', '대기자금', '현금', '현금', 0.02, 0, 0.02),
  P('투자자산', '증권', '해외주식', '주식', 0.3, -0.2, 0.1),
  P('투자자산', '증권', '해외주식', '현금', 0, 0, 0),
  P('투자자산', '증권', '국내주식', '주식', 0.05, 0.01, 0.03),
  P('투자자산', '증권', '펀드', '펀드', 0.07, -0.1, 0.03),
  P('투자자산', '암호화폐', 'BTC, ETH', '코인', 0.4, -0.5, 0.2),
  P('안전자산', '적금', '청약통장', '현금', 0.03, 0, 0.03),
  P('안전자산', '채권', '국내외채권', '채권', 0.04, 0.04, 0.04),
];

// 25년결산 시트의 "중점 관리사항" 구조
export const TEMPLATE_GOALS = [
  { item: '부채비율', target: '15% (±5%)', metric: '부채비율', status: '', strategy: '대출 상환 및 신규차입 관리', progress: '진행중' },
  { item: '유동성', target: '30% (±5%)', metric: '유동비율', status: '', strategy: '', progress: '진행중' },
  { item: '전략투자', target: '-', metric: '기대수익률', status: '', strategy: '', progress: '진행중' },
  { item: '자산 Hedge', target: '총자산 比 40%', metric: '안전자산비율', status: '', strategy: '채권비중 확대', progress: '진행중' },
];

// ---------- KPI ----------
// unit: krw(원) | pct(비율) | man(만원) | num
// dir: up(높을수록 좋음) | down(낮을수록 좋음)
export const KPI_METRICS = {
  순자산: { unit: 'krw', dir: 'up', desc: '총자산 − 총부채 (분기말 기준일)' },
  총자산: { unit: 'krw', dir: 'up', desc: '분기말 기준일 총자산' },
  부채비율: { unit: 'pct', dir: 'down', desc: '총부채 ÷ 총자산' },
  유동비율: { unit: 'pct', dir: 'up', desc: 'Var 그룹(현금성) ÷ 총자산' },
  안전자산비율: { unit: 'pct', dir: 'up', desc: 'Var+Fixed 그룹 ÷ 총자산' },
  위험자산비율: { unit: 'pct', dir: 'down', desc: 'Risk 그룹 ÷ 총자산' },
  기대수익률: { unit: 'pct', dir: 'up', desc: '가중 기대이익률' },
  누적순이익: { unit: 'man', dir: 'up', desc: '해당 연도 1월~분기말 누적 (수입−지출)' },
  누적수입: { unit: 'man', dir: 'up', desc: '해당 연도 1월~분기말 누적 수입' },
  누적지출: { unit: 'man', dir: 'down', desc: '해당 연도 1월~분기말 누적 지출' },
  저축률: { unit: 'pct', dir: 'up', desc: '누적 순이익 ÷ 누적 수입' },
  순자산증가액: { unit: 'krw', dir: 'up', desc: '분기말 순자산 − 전년 말 순자산' },
  순자산증가율: { unit: 'pct', dir: 'up', desc: '(분기말 순자산 − 전년 말 순자산) ÷ 전년 말 순자산' },
  수동입력: { unit: 'num', dir: 'up', desc: '직접 입력' },
};
export const metricKey = (m) => (String(m || '').startsWith('비중:') ? '비중' : m);
export const metricInfo = (m) => (String(m || '').startsWith('비중:') ? { unit: 'pct', dir: 'up', desc: `${m.slice(3)} ÷ 총자산` } : KPI_METRICS[m] || KPI_METRICS.수동입력);

export const TEMPLATE_KPIS = (year) => [
  { year, name: '순자산', metric: '순자산', target: 0, dir: 'up', q: [null, null, null, null], note: '' },
  { year, name: '부채비율', metric: '부채비율', target: 0.15, dir: 'down', q: [null, null, null, null], note: '' },
  { year, name: '유동성', metric: '유동비율', target: 0.3, dir: 'up', q: [null, null, null, null], note: '' },
  { year, name: '안전자산 비중', metric: '안전자산비율', target: 0.4, dir: 'up', q: [null, null, null, null], note: '' },
  { year, name: '연간 저축', metric: '누적순이익', target: 0, dir: 'up', q: [null, null, null, null], note: '' },
  { year, name: '저축률', metric: '저축률', target: 0.5, dir: 'up', q: [null, null, null, null], note: '' },
];

export const quarterEnd = (year, q) => `${year}-${String(q * 3).padStart(2, '0')}-${q === 1 || q === 4 ? '31' : '30'}`;
export const quarterOf = (date) => Math.ceil((Number(String(date).slice(5, 7)) || 1) / 3);

// ---------- 계산 ----------
export const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s원%]/g, '')) || 0);

export const toKRW = (a, fx) => num(a.value) * (num(fx[a.currency]) || (a.currency ? 0 : 1));

export function majorOrder(settings) {
  const m = new Map();
  settings.taxonomy.forEach((t, i) => m.set(t.major, i));
  return m;
}

export function sortAssets(rows, settings) {
  const mo = majorOrder(settings);
  const midIdx = (r) => {
    const t = settings.taxonomy.find((x) => x.major === r.major);
    const i = t ? t.mids.indexOf(r.mid) : -1;
    return i < 0 ? 99 : i;
  };
  return [...rows].sort((a, b) =>
    (mo.get(a.major) ?? 99) - (mo.get(b.major) ?? 99) || midIdx(a) - midIdx(b) || num(a.order) - num(b.order));
}

export function bases(assets) {
  return [...new Set(assets.map((a) => a.basis).filter(Boolean))].sort();
}

export function summarize(assets, liabilities, settings) {
  const fx = settings.fx;
  let total = 0, profit = 0;
  const byMajor = {}, byMid = {}, byGroup = {};
  const groupOf = Object.fromEntries(settings.taxonomy.map((t) => [t.major, t.group]));
  for (const a of assets) {
    const k = toKRW(a, fx);
    total += k;
    profit += k * num(a.rate);
    byMajor[a.major] = (byMajor[a.major] || 0) + k;
    const mk = `${a.major}|${a.mid}`;
    byMid[mk] = (byMid[mk] || 0) + k;
    const g = groupOf[a.major] || 'Risk';
    byGroup[g] = (byGroup[g] || 0) + k;
  }
  const debt = liabilities.reduce((s, l) => s + num(l.amount), 0);
  const interest = liabilities.reduce((s, l) => s + num(l.amount) * num(l.rate), 0);
  return {
    total, profit, nrv: total + profit, debt, interest,
    net: total - debt,
    debtRatio: total ? debt / total : 0,
    liquidity: total ? (byGroup.Var || 0) / total : 0,
    expRate: total ? profit / total : 0,
    safeRatio: total ? ((byGroup.Var || 0) + (byGroup.Fixed || 0)) / total : 0,
    riskRatio: total ? (byGroup.Risk || 0) / total : 0,
    byMajor, byMid, byGroup,
  };
}

export function cashflowSummary(rows) {
  const inc = Array(12).fill(0), out = Array(12).fill(0);
  for (const r of rows) {
    const arr = r.type === '수입' ? inc : out;
    for (let i = 0; i < 12; i++) arr[i] += num(r.m?.[i]);
  }
  const net = inc.map((v, i) => v - out[i]);
  let acc = 0;
  const cum = net.map((v) => (acc += v));
  return { inc, out, net, cum };
}

// KPI 지표 자동 계산. ctx: { assets, liabilities, cashflow, settings }
// 분기말(quarterEnd) 이전의 가장 최근 기준일 자산을 사용. 없으면 null
export function computeMetric(metric, year, q, ctx) {
  const qe = quarterEnd(year, q);
  const bs = bases(ctx.assets).filter((b) => b <= qe);
  const basis = bs[bs.length - 1];
  const sumAt = (b) => (b ? summarize(ctx.assets.filter((a) => a.basis === b), ctx.liabilities, ctx.settings) : null);
  const s = sumAt(basis);
  const cfRows = ctx.cashflow.filter((r) => num(r.year) === year);
  const cf = cashflowSummary(cfRows);
  const upto = q * 3;
  const sumTo = (arr) => arr.slice(0, upto).reduce((a, b) => a + b, 0);
  const prevYearEnd = () => {
    const pb = bases(ctx.assets).filter((b) => b <= `${year - 1}-12-31`);
    return sumAt(pb[pb.length - 1]);
  };
  if (metric.startsWith('비중:')) return s && s.total ? (s.byMajor[metric.slice(3)] || 0) / s.total : null;
  switch (metric) {
    case '순자산': return s ? s.net : null;
    case '총자산': return s ? s.total : null;
    case '부채비율': return s ? s.debtRatio : null;
    case '유동비율': return s ? s.liquidity : null;
    case '안전자산비율': return s ? s.safeRatio : null;
    case '위험자산비율': return s ? s.riskRatio : null;
    case '기대수익률': return s ? s.expRate : null;
    case '누적순이익': return cfRows.length ? sumTo(cf.net) : null;
    case '누적수입': return cfRows.length ? sumTo(cf.inc) : null;
    case '누적지출': return cfRows.length ? sumTo(cf.out) : null;
    case '저축률': { if (!cfRows.length) return null; const i = sumTo(cf.inc); return i ? sumTo(cf.net) / i : null; }
    case '순자산증가액': { const p = prevYearEnd(); return s && p ? s.net - p.net : null; }
    case '순자산증가율': { const p = prevYearEnd(); return s && p && p.net ? (s.net - p.net) / p.net : null; }
    default: return null;
  }
}

export function kpiValue(k, q, ctx) {
  const manual = k.q?.[q - 1];
  if (manual !== null && manual !== undefined && manual !== '') return { value: num(manual), manual: true };
  if (k.metric === '수동입력') return { value: null, manual: true };
  return { value: computeMetric(k.metric, num(k.year), q, ctx), manual: false };
}

// 달성률: dir=up 이면 value/target, down 이면 target/value (상한 없음, 표시 시 clamp)
export function achievement(k, value) {
  const t = num(k.target), dir = k.dir || metricInfo(k.metric).dir;
  if (value == null) return null;
  if (dir === 'down') return value <= t ? 1 : t > 0 ? t / value : 0;
  return t ? value / t : null;
}

// ---------- 시뮬레이션 ----------
// 순자산 전망: 월 복리, 월 저축액은 매년 saveGrowth 만큼 증가. 결과 [{ year, nominal, real }]
export function projectNetWorth({ net, monthlySave, annualRate, years, inflation = 0, saveGrowth = 0 }) {
  const out = [{ year: 0, nominal: net, real: net }];
  let v = net, save = monthlySave;
  const mr = Math.pow(1 + annualRate, 1 / 12) - 1;
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) v = v * (1 + mr) + save;
    save *= 1 + saveGrowth;
    out.push({ year: y, nominal: v, real: v / Math.pow(1 + inflation, y) });
  }
  return out;
}
export function yearsToReach(series, target) {
  if (!target) return null;
  const hit = series.find((p) => p.nominal >= target);
  return hit ? hit.year : null;
}
// 리밸런싱: 현재 대분류별 금액 + 목표 비중(%) → 매수/매도 금액
export function rebalance(byMajor, targets, total) {
  const majors = [...new Set([...Object.keys(byMajor), ...Object.keys(targets)])];
  return majors.map((m) => {
    const cur = byMajor[m] || 0;
    const tgt = (num(targets[m]) / 100) * total;
    return { major: m, current: cur, curPct: total ? cur / total : 0, targetPct: num(targets[m]) / 100, target: tgt, delta: tgt - cur };
  });
}
// 부채 상환: 월 상환액으로 원리금균등 상환 시 개월 수·총이자. 이자만도 못 갚으면 null
export function debtPayoff(amount, annualRate, monthly, maxMonths = 600) {
  let bal = amount, months = 0, interest = 0;
  const mr = annualRate / 12;
  if (amount <= 0) return { months: 0, interest: 0, schedule: [] };
  if (monthly <= bal * mr) return null;
  const schedule = [];
  while (bal > 0 && months < maxMonths) {
    const i = bal * mr;
    interest += i;
    bal = bal + i - monthly;
    months++;
    if (months % 12 === 0 || bal <= 0) schedule.push({ month: months, balance: Math.max(0, bal), interest });
  }
  return { months, interest, schedule };
}

export const TEMPLATE_SCENARIOS = [];

// ---------- 벤치마크 기능: 건강 점수 · 알림 · FIRE · 수수료 · 글라이드패스 · 예산 ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 0~1 선형 점수: bad 에서 0, good 에서 100
const lin = (v, bad, good) => clamp(((v - bad) / (good - bad)) * 100, 0, 100);

// 연령 기준 위험자산 목표 비중 (110 − 나이 규칙, 20~90% 로 제한)
export const glideTarget = (age) => (age ? clamp(110 - age, 20, 90) / 100 : 0.6);

// 월 생활비(원): 해당 연도 현금흐름 지출 평균 (데이터 있는 달만)
export function monthlyExpense(cashflowRows) {
  const cf = cashflowSummary(cashflowRows);
  const months = cf.out.map((v, i) => (cf.inc[i] || cf.out[i] ? v : null)).filter((v) => v !== null);
  return months.length ? (months.reduce((a, b) => a + b, 0) / months.length) * 10000 : 0;
}

// 최근 나이: 연도별 추이의 마지막 기록 나이 + 경과 연수
export function currentAge(history) {
  const hs = [...history].filter((r) => num(r.age)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = hs[hs.length - 1];
  if (!last) return null;
  return num(last.age) + (new Date().getFullYear() - Number(String(last.date).slice(0, 4)));
}

// 재무 건강 점수 (뱅크샐러드 금융건강점수 / Empower Retirement Readiness 벤치마크)
// ctx: { sum, cashflowRows, history, kpis(올해), kpiCtx, q }
export function healthScore(ctx) {
  const { sum } = ctx;
  const parts = [];
  if (!sum || !sum.total) return { score: null, grade: '—', parts };
  const expense = monthlyExpense(ctx.cashflowRows || []);
  const cash = sum.byGroup?.Var || 0;
  const months = expense ? cash / expense : null;
  parts.push({ key: 'emergency', label: '비상자금', weight: 20, score: months == null ? null : lin(months, 0, 6), value: months == null ? '지출 데이터 없음' : `${months.toFixed(1)}개월분`, hint: '현금성 자산 ÷ 월 지출 — 6개월 이상이면 만점' });
  parts.push({ key: 'debt', label: '부채 건전성', weight: 15, score: lin(sum.debtRatio, 0.5, 0.1), value: fmtPct(sum.debtRatio), hint: '부채비율 10% 이하 만점, 50% 이상 0점' });
  const cf = cashflowSummary(ctx.cashflowRows || []);
  const inc = cf.inc.reduce((a, b) => a + b, 0), net = cf.net.reduce((a, b) => a + b, 0);
  const saveRate = inc ? net / inc : null;
  parts.push({ key: 'save', label: '저축률', weight: 20, score: saveRate == null ? null : lin(saveRate, 0, 0.4), value: saveRate == null ? '수입 데이터 없음' : fmtPct(saveRate), hint: '순이익 ÷ 수입 — 40% 이상 만점' });
  const top = Math.max(0, ...Object.values(sum.byMid || {})) / sum.total;
  parts.push({ key: 'div', label: '분산', weight: 15, score: lin(top, 0.6, 0.15), value: `최대 단일 항목 ${fmtPct(top)}`, hint: '가장 큰 중분류 비중 15% 이하 만점, 60% 이상 0점' });
  const age = currentAge(ctx.history || []);
  const tgt = glideTarget(age);
  const gap = Math.abs(sum.riskRatio - tgt);
  parts.push({ key: 'risk', label: '위험자산 적정성', weight: 15, score: lin(gap, 0.4, 0.05), value: `${fmtPct(sum.riskRatio)} (기준 ${fmtPct(tgt, 0)})`, hint: age ? `만 ${age}세 기준 110−나이 규칙과의 차이` : '나이 정보가 없어 60% 기준' });
  const achs = (ctx.kpis || []).map((k) => { const v = kpiValue(k, ctx.q, ctx.kpiCtx).value; return achievement(k, v); }).filter((a) => a != null);
  const avg = achs.length ? achs.reduce((a, b) => a + Math.min(1, b), 0) / achs.length : null;
  parts.push({ key: 'kpi', label: 'KPI 달성', weight: 15, score: avg == null ? null : avg * 100, value: avg == null ? 'KPI 없음' : fmtPct(avg, 0), hint: '올해 KPI 평균 달성률 (상한 100%)' });
  const valid = parts.filter((p) => p.score != null);
  const w = valid.reduce((s, p) => s + p.weight, 0);
  const score = w ? Math.round(valid.reduce((s, p) => s + p.score * p.weight, 0) / w) : null;
  const grade = score == null ? '—' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'E';
  return { score, grade, parts, age, expense, months };
}

// 알림 센터 — 주의가 필요한 항목 목록 [{ level: bad|warn|info, title, text, page }]
export function buildAlerts(ctx) {
  const out = [];
  const now = new Date();
  const { sum, liabilities = [], assets = [], settings, cashflowRows = [], kpis = [], history = [], bases: bs = [] } = ctx;
  const add = (level, title, text, page) => out.push({ level, title, text, page });
  // 부채
  for (const l of liabilities) {
    if (!l.maturity || !num(l.amount)) continue;
    const days = (new Date(l.maturity) - now) / 86400e3;
    if (days < 0) add('bad', `만기 경과: ${l.creditor}`, `${l.maturity} 만기 · ${fmtEok(l.amount)}원 — 연장 또는 상환 여부를 확인하세요`, 'liabilities');
    else if (days <= 90) add('warn', `${Math.ceil(days)}일 내 만기: ${l.creditor}`, `${l.maturity} · ${fmtEok(l.amount)}원`, 'liabilities');
  }
  const hi = liabilities.filter((l) => num(l.amount) > 0 && num(l.rate) >= 0.06);
  if (hi.length) add('warn', '고금리 부채', `${hi.map((l) => `${l.creditor} ${fmtPct(l.rate, 1)}`).join(', ')} — 기대수익률보다 높다면 상환이 우선입니다`, 'simulate');
  if (sum) {
    // 비상자금
    const expense = monthlyExpense(cashflowRows);
    if (expense) {
      const months = (sum.byGroup?.Var || 0) / expense;
      if (months < 3) add(months < 1 ? 'bad' : 'warn', '비상자금 부족', `현금성 자산이 월 지출의 ${months.toFixed(1)}개월분입니다 (권장 3~6개월)`, 'assets');
    }
    // 집중
    const [topKey, topVal] = Object.entries(sum.byMid || {}).sort((a, b) => b[1] - a[1])[0] || [];
    if (topKey && sum.total && topVal / sum.total > 0.4) add('warn', '단일 자산 집중', `${topKey.replace('|', ' › ')} 비중 ${fmtPct(topVal / sum.total)} — 40% 를 넘습니다`, 'assets');
    // 연령 대비 위험
    const age = currentAge(history);
    const tgt = glideTarget(age);
    if (sum.riskRatio > tgt + 0.15) add('warn', '위험자산 비중 높음', `${fmtPct(sum.riskRatio)} (연령 기준 ${fmtPct(tgt, 0)}) — 리밸런싱을 검토하세요`, 'simulate');
    else if (sum.total && sum.riskRatio < tgt - 0.25) add('info', '위험자산 비중 낮음', `${fmtPct(sum.riskRatio)} (연령 기준 ${fmtPct(tgt, 0)}) — 장기 성장성이 낮을 수 있습니다`, 'simulate');
    // 수수료
    const fee = feeDrag(assets, settings.fx);
    if (fee.annual > 0 && sum.total && fee.annual / sum.total > 0.005) add('info', '보수·수수료 부담', `연 ${fmtEok(fee.annual)}원 (총자산의 ${fmtPct(fee.annual / sum.total, 2)}) — 10년 누적 영향 약 ${fmtEok(fee.drag10)}원`, 'assets');
    // 부채비율
    if (sum.debtRatio > 0.4) add('warn', '부채비율 높음', `${fmtPct(sum.debtRatio)} — 40% 를 넘습니다`, 'liabilities');
  }
  // 환율
  if (settings?.fxUpdatedAt && (now - new Date(settings.fxUpdatedAt)) / 36e5 > 48) add('info', '환율 정보 오래됨', `마지막 갱신 ${String(settings.fxUpdatedAt).slice(0, 10)}`, 'settings');
  // 분기 스냅샷
  const curY = now.getFullYear(), curQ = quarterOf(today());
  if (bs.length && !bs.some((b) => b.startsWith(String(curY)) && quarterOf(b) === curQ)) add('info', `${curY}년 ${curQ}분기 기준일 없음`, '자산 페이지에서 “새 기준일로 복사” 하면 분기 KPI 가 계산됩니다', 'assets');
  // KPI 뒤처짐
  for (const k of kpis) {
    const v = kpiValue(k, ctx.q, ctx.kpiCtx).value;
    const a = achievement(k, v);
    if (a != null && a < 0.8) add('warn', `KPI 미달: ${k.name}`, `달성률 ${fmtPct(a, 0)} — 목표 ${fmtUnit(k.target, metricInfo(k.metric).unit)}`, 'kpi');
  }
  // 예산 초과 (이번 달)
  const over = budgetStatus(cashflowRows, now.getMonth()).filter((b) => b.ratio > 1);
  if (over.length) add('warn', '이번 달 예산 초과', over.map((b) => `${b.name} ${fmtNum(b.actual)}/${fmtNum(b.budget)}만원`).join(', '), 'cashflow');
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// 보수·수수료: 자산별 연보수율(fee) 로 연간 비용과 10/20년 복리 손실 추정
export function feeDrag(assets, fx, rate = 0.05) {
  let annual = 0, base = 0, w = 0;
  for (const a of assets) {
    const f = num(a.fee);
    if (!f) continue;
    const k = toKRW(a, fx);
    annual += k * f; base += k; w += k * f;
  }
  const avgFee = base ? w / base : 0;
  const lose = (n) => base * (Math.pow(1 + rate, n) - Math.pow(1 + rate - avgFee, n));
  return { annual, base, avgFee, drag10: lose(10), drag20: lose(20) };
}

// 예산 대비 실적 (지출 행의 budget = 월 예산, 만원). month: 0-based
export function budgetStatus(cashflowRows, month) {
  return cashflowRows.filter((r) => r.type === '지출' && num(r.budget) > 0).map((r) => {
    const actual = num(r.m?.[month]);
    return { name: r.name, group: r.group, budget: num(r.budget), actual, ratio: actual / num(r.budget) };
  });
}

// FIRE: 연 생활비 ÷ 인출률 = 목표 자산. 물가 반영 목표 대비 도달 연도
export function fireSim({ net, monthlySave, annualRate, annualExpense, swr = 0.04, inflation = 0.025, saveGrowth = 0, years = 40 }) {
  const fireNumber = swr ? annualExpense / swr : 0;
  const series = projectNetWorth({ net, monthlySave, annualRate, years, inflation, saveGrowth });
  let reach = null;
  for (const p of series) { if (fireNumber && p.nominal >= fireNumber * Math.pow(1 + inflation, p.year)) { reach = p.year; break; } }
  const coverage = fireNumber ? net / fireNumber : 0;
  // 코스트 FIRE: 더 저축하지 않아도 N년 후 목표에 도달하는지
  const coastYears = (() => { if (!fireNumber || net <= 0) return null; for (let y = 0; y <= years; y++) if (net * Math.pow(1 + annualRate, y) >= fireNumber * Math.pow(1 + inflation, y)) return y; return null; })();
  return { fireNumber, series, reach, coverage, coastYears };
}

// ---------- 소비내역 (거래 단위) ----------
export const TX_CATEGORIES = ['식비', '카페/간식', '교통', '주거/공과금', '통신', '쇼핑', '문화/여가', '의료/건강', '교육', '보험', '경조사', '구독', '여행', '생활용품', '투자', '이체', '급여', '기타'];
export const TX_RULES = [
  [/스타벅스|starbucks|투썸|이디야|메가커피|컴포즈|빽다방|커피|카페|cafe|배스킨|던킨|베이커리|파리바게|뚜레쥬르|디저트/i, '카페/간식'],
  [/배달의민족|배민|요기요|쿠팡이츠|맥도날드|버거킹|롯데리아|kfc|맘스터치|서브웨이|식당|치킨|피자|김밥|국밥|분식|음식|푸드|food|한식|중식|일식|고기|횟집|곱창|족발|보쌈|마라|교촌|bbq|bhc|스시|초밥|밥/i, '식비'],
  [/지하철|버스|교통|택시|카카오t|kakao t|타다|코레일|ktx|srt|주유|gs칼텍스|sk에너지|s-oil|현대오일|주차|하이패스|톨게이트|따릉이|킥보드/i, '교통'],
  [/관리비|월세|전기|한전|가스|수도|도시가스|아파트|임대료/, '주거/공과금'],
  [/skt|kt\b|lg u\+|lgu|유플러스|통신|휴대폰|알뜰폰|인터넷/i, '통신'],
  [/넷플릭스|netflix|유튜브|youtube|스포티파이|spotify|멜론|웨이브|wavve|티빙|tving|디즈니|disney|쿠팡와우|chatgpt|openai|claude|notion|adobe|icloud|구글 원|google one|구독|멤버십/i, '구독'],
  [/쿠팡|coupang|네이버페이|naver|11번가|g마켓|gmarket|옥션|무신사|지그재그|에이블리|올리브영|다이소|이마트|홈플러스|롯데마트|코스트코|costco|마켓컬리|컬리|ssg|백화점|유니클로|자라|zara|h&m|나이키|아디다스/i, '쇼핑'],
  [/cgv|메가박스|롯데시네마|영화|공연|콘서트|전시|티켓|인터파크|예스24|yes24|교보문고|알라딘|스팀|steam|닌텐도|플레이스테이션|게임|노래방|볼링|pc방|골프|헬스|피트니스|요가|필라테스|수영/i, '문화/여가'],
  [/병원|의원|약국|치과|한의원|안과|피부과|정형외과|내과|건강검진|의료/, '의료/건강'],
  [/학원|교육|강의|인프런|클래스101|유데미|udemy|coursera|수강|교재|도서/i, '교육'],
  [/보험|생명|화재|손해보험|삼성화재|현대해상|db손보|kb손보|메리츠/i, '보험'],
  [/경조사|축의|부의|조의|결혼|돌잔치|장례/, '경조사'],
  [/항공|대한항공|아시아나|제주항공|진에어|티웨이|에어부산|호텔|hotel|airbnb|에어비앤비|야놀자|여기어때|아고다|agoda|부킹|booking|트립|여행|면세/i, '여행'],
  [/증권|주식|etf|펀드|코인|업비트|빗썸|적금|예금|연금|irp|isa|투자/i, '투자'],
  [/급여|월급|상여|성과급|salary/i, '급여'],
  [/이체|송금|카드대금|카드 대금|결제대금|자동이체|출금/, '이체'],
];
export function classifyTx(desc) {
  const s = String(desc || '');
  if (!s.trim()) return null;
  for (const [re, c] of TX_RULES) if (re.test(s)) return c;
  return null;
}
// 월별·카테고리별 지출 합계 (원). rows: 해당 연도 거래
export function txSummary(rows, year) {
  const byMonth = Array(12).fill(0), byCat = {}, byMonthCat = Array.from({ length: 12 }, () => ({}));
  let income = 0;
  for (const r of rows) {
    if (String(r.date).slice(0, 4) !== String(year)) continue;
    const m = Number(String(r.date).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    const v = Math.abs(num(r.amount));
    if (r.type === '수입') { income += v; continue; }
    byMonth[m] += v;
    const c = r.category || '기타';
    byCat[c] = (byCat[c] || 0) + v;
    byMonthCat[m][c] = (byMonthCat[m][c] || 0) + v;
  }
  return { byMonth, byCat, byMonthCat, income };
}
// 중복 판정 키 (날짜+내용+금액)
export const txKey = (r) => `${r.date}|${String(r.desc || '').trim()}|${Math.round(num(r.amount))}`;

// ---------- 자산 증식 전략 추천 엔진 ----------
// 대분류별 연 변동성 가정 (몬테카를로·최적화용). 분류체계에 없는 대분류는 그룹 기본값
export const VOL_BY_MAJOR = { 현금: 0.005, 채권형자산: 0.05, '연금/보험': 0.08, 부동산: 0.12, 투자: 0.18, 가상자산: 0.7, 대체투자: 0.25, 기타: 0.1 };
export const VOL_BY_GROUP = { Var: 0.005, Fixed: 0.07, Risk: 0.2 };
export const RET_BY_MAJOR = { 현금: 0.025, 채권형자산: 0.045, '연금/보험': 0.05, 부동산: 0.04, 투자: 0.08, 가상자산: 0.15, 대체투자: 0.08, 기타: 0.02 };

export function portfolioStats(weights, rets, vols, rho = 0.35, rf = 0.03) {
  const ks = Object.keys(weights);
  let mu = 0, v = 0;
  for (const i of ks) {
    mu += weights[i] * (rets[i] ?? 0);
    for (const j of ks) v += weights[i] * weights[j] * (vols[i] ?? 0) * (vols[j] ?? 0) * (i === j ? 1 : rho);
  }
  const sigma = Math.sqrt(Math.max(0, v));
  return { mu, sigma, sharpe: sigma ? (mu - rf) / sigma : 0 };
}

// 포트폴리오 최적화: 무작위 탐색(Dirichlet) 으로 최대 샤프 + 리스크 패리티 근사. opts.maxW 상한, opts.minCash 현금 하한
export function optimizePortfolio(majors, rets, vols, { n = 4000, maxW = 0.6, minCash = 0, rho = 0.35, rf = 0.03, seed = 1 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const sample = () => {
    const g = majors.map(() => -Math.log(rnd() + 1e-12));
    const t = g.reduce((a, b) => a + b, 0);
    const w = Object.fromEntries(majors.map((m, i) => [m, g[i] / t]));
    if (w.현금 != null && w.현금 < minCash) { const d = minCash - w.현금; w.현금 = minCash; const others = majors.filter((m) => m !== '현금'); const ot = others.reduce((a, m) => a + w[m], 0) || 1; for (const m of others) w[m] -= d * (w[m] / ot); }
    return w;
  };
  let best = null;
  for (let i = 0; i < n; i++) {
    const w = sample();
    if (majors.some((m) => w[m] > maxW || w[m] < 0)) continue;
    const st = portfolioStats(w, rets, vols, rho, rf);
    if (!best || st.sharpe > best.stats.sharpe) best = { weights: w, stats: st };
  }
  // 리스크 패리티: 1/σ 비례
  const inv = majors.map((m) => 1 / Math.max(0.003, vols[m] ?? 0.1));
  const ti = inv.reduce((a, b) => a + b, 0);
  const rp = Object.fromEntries(majors.map((m, i) => [m, inv[i] / ti]));
  return { maxSharpe: best, riskParity: { weights: rp, stats: portfolioStats(rp, rets, vols, rho, rf) } };
}

// 몬테카를로: 기하 브라운 운동(월 단위), n 경로. 결과 연도별 p10/p50/p90 + 목표 도달 확률
export function monteCarlo({ net, monthlySave, mu, sigma, years, n = 1000, inflation = 0, saveGrowth = 0, target = 0, seed = 7 }) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const gauss = () => { const u = rnd() || 1e-12, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mm = Math.log(1 + mu) / 12 - (sigma * sigma) / 24, ms = sigma / Math.sqrt(12);
  const paths = Array.from({ length: years + 1 }, () => []);
  let hit = 0;
  for (let p = 0; p < n; p++) {
    let v = net, save = monthlySave, reached = false;
    paths[0].push(v);
    for (let y = 1; y <= years; y++) {
      for (let m = 0; m < 12; m++) v = v * Math.exp(mm + ms * gauss()) + save;
      save *= 1 + saveGrowth;
      paths[y].push(v);
      if (target && v >= target * Math.pow(1 + inflation, y)) reached = true;
    }
    if (reached) hit++;
  }
  const pct = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
  return { years: paths.map((arr, y) => ({ year: y, p10: pct(arr, 0.1), p25: pct(arr, 0.25), p50: pct(arr, 0.5), p75: pct(arr, 0.75), p90: pct(arr, 0.9) })), probTarget: target ? hit / n : null };
}

// 규칙 기반 전략 추천. 반환 [{ id, title, why, action, impact(연간 원, 추정), tags, level }]
export function recommendStrategies(ctx) {
  const { sum, assets = [], liabilities = [], cashflowRows = [], history = [], settings } = ctx;
  const out = [];
  if (!sum || !sum.total) return out;
  const fx = settings.fx;
  const expense = monthlyExpense(cashflowRows);
  const cf = cashflowSummary(cashflowRows);
  const income = cf.inc.reduce((a, b) => a + b, 0) * 10000;
  const saveRate = income ? (cf.net.reduce((a, b) => a + b, 0) * 10000) / income : null;
  const age = currentAge(history);
  const cash = sum.byGroup?.Var || 0;
  const midAmt = (re) => assets.filter((a) => re.test(`${a.major}|${a.mid}|${a.name}`)).reduce((s, a) => s + toKRW(a, fx), 0);
  const add = (o) => out.push({ level: 'medium', tags: [], ...o });
  // 1. 비상자금
  if (expense) {
    const months = cash / expense;
    if (months < 3) add({ id: 'emergency', level: 'high', title: '비상자금부터 3개월분 확보', why: `현금성 자산이 월 지출의 ${months.toFixed(1)}개월분입니다.`, action: `파킹통장/CMA 에 월 ${fmtEok(Math.min(expense, (3 - months) * expense / 6))}원씩 자동이체해 ${fmtEok(3 * expense)}원을 먼저 채우세요. 그 전까지 위험자산 추가 매수는 보류.`, impact: 0, tags: ['안전망'] });
    // 4. 유휴 현금
    const excess = cash - 6 * expense;
    if (excess > 5e6) add({ id: 'idle-cash', level: 'high', title: '유휴 현금을 투자로 전환 (6개월분 초과분)', why: `현금성 자산 ${fmtEok(cash)}원 중 비상자금 6개월분(${fmtEok(6 * expense)}원)을 넘는 ${fmtEok(excess)}원이 대기 중입니다.`, action: `초과분을 3~6개월에 나눠 적립식(DCA)으로 글로벌 분산 ETF 등에 투자하세요. 한 번에 넣지 말고 분할 매수로 타이밍 위험을 줄입니다.`, impact: excess * 0.04, tags: ['DCA', '기회비용'] });
  }
  // 5. 파킹 금리 최적화
  const idle = assets.filter((a) => a.major === '현금' && /입출금|예금/.test(a.mid) && num(a.rate) < 0.02).reduce((s, a) => s + toKRW(a, fx), 0);
  if (idle > 3e6) add({ id: 'parking', title: '입출금·저금리 예금을 파킹통장/CMA 로', why: `금리 2% 미만 현금 ${fmtEok(idle)}원이 있습니다.`, action: '생활비 1개월분만 입출금에 두고 나머지는 연 3% 내외의 파킹통장·CMA·MMF 로 옮기세요 (즉시 출금 가능).', impact: idle * 0.025, tags: ['무위험 수익'] });
  // 1-2. 고금리 부채
  for (const l of liabilities) {
    const amt = num(l.amount), r = num(l.rate);
    if (amt > 0 && r >= 0.05) add({ id: `debt-${l.id || l.creditor}`, level: r >= 0.07 ? 'high' : 'medium', title: `고금리 부채 우선 상환: ${l.creditor} (${fmtPct(r, 1)})`, why: `연이자 ${fmtEok(amt * r)}원. 확실한 ${fmtPct(r, 1)} 수익과 같습니다${sum.expRate < r ? ` (포트폴리오 기대수익률 ${fmtPct(sum.expRate)} 보다 높음)` : ''}.`, action: `여유 현금과 월 저축의 일부를 이 부채 조기상환에 배정하거나, 더 낮은 금리로 대환(갈아타기)을 알아보세요.`, impact: amt * r, tags: ['부채', '확정수익'] });
  }
  // 2. 연금계좌 세액공제
  const pension = midAmt(/연금저축|IRP/i);
  const canSave = cash > (expense ? 3 * expense : 0) + 9e6 || (saveRate != null && saveRate > 0.2);
  if (canSave) add({ id: 'pension-tax', level: 'high', title: '연금저축 + IRP 로 연 900만원 세액공제', why: `연금저축·IRP 납입액 연 900만원(연금저축 600만원 한도)까지 13.2~16.5% 세액공제 → 최대 ${fmtEok(9e6 * 0.165)}원 환급.${pension ? ` 현재 연금계좌 ${fmtEok(pension)}원 보유.` : ' 연금계좌가 없거나 적습니다.'}`, action: '월 75만원 자동이체로 한도를 채우고, 계좌 안에서는 저보수 글로벌 ETF/TDF 로 운용하세요. 퇴직연금(DC) 도 디폴트옵션 대신 직접 포트폴리오 지정.', impact: 9e6 * 0.132, tags: ['절세', '장기'] });
  // 3. ISA
  const isa = midAmt(/ISA/i);
  if (!isa) add({ id: 'isa', title: 'ISA 계좌로 비과세·분리과세 혜택', why: 'ISA 는 순이익 200만원(서민형 400만원)까지 비과세, 초과분 9.9% 분리과세. 만기 후 연금계좌 이전 시 추가 세액공제(최대 300만원).', action: '국내 상장 해외 ETF·배당주·예금을 ISA 안에서 운용하세요 (연 2천만원, 총 1억 납입 한도).', impact: 2e6 * 0.154 + 1e6 * 0.054, tags: ['절세'] });
  // 6. 수수료
  const fee = feeDrag(assets, fx);
  const hiFee = assets.filter((a) => num(a.fee) >= 0.005);
  if (hiFee.length) add({ id: 'fee', title: '고보수 상품을 저보수 ETF 로 교체', why: `연보수 0.5% 이상 상품 ${hiFee.length}개, 연 ${fmtEok(hiFee.reduce((s, a) => s + toKRW(a, fx) * num(a.fee), 0))}원 비용. 20년 누적 영향 ${fmtEok(fee.drag20)}원.`, action: '같은 지수를 추종하는 보수 0.1% 내외 ETF 로 갈아타세요. 펀드→ETF 전환 시 환매 수수료·세금 확인.', impact: hiFee.reduce((s, a) => s + toKRW(a, fx) * (num(a.fee) - 0.001), 0), tags: ['비용'] });
  // 7. 글라이드패스 / 8. 분산
  const tgt = glideTarget(age);
  if (sum.riskRatio < tgt - 0.15 && (!expense || cash / expense >= 3)) add({ id: 'glide-up', title: '위험자산 비중을 연령 기준까지 단계적으로 확대', why: `위험자산 ${fmtPct(sum.riskRatio)} vs 연령 기준 ${fmtPct(tgt, 0)}${age ? ` (만 ${age}세)` : ''}. 장기 기대수익을 놓치고 있습니다.`, action: `차이 ${fmtEok((tgt - sum.riskRatio) * sum.total)}원을 12개월에 걸쳐 매월 분할 매수(DCA). 글로벌 주식 ETF 중심.`, impact: (tgt - sum.riskRatio) * sum.total * 0.04, tags: ['자산배분', 'DCA'] });
  if (sum.riskRatio > tgt + 0.15) add({ id: 'glide-down', level: 'high', title: '위험자산 비중 축소 (연령 기준 초과)', why: `위험자산 ${fmtPct(sum.riskRatio)} 로 연령 기준 ${fmtPct(tgt, 0)} 을 크게 넘습니다. 하락장에서 회복에 오래 걸릴 수 있습니다.`, action: `초과분 ${fmtEok((sum.riskRatio - tgt) * sum.total)}원을 채권·현금성으로 옮기고, 이후 5%p 밴드 리밸런싱 규칙을 적용하세요.`, impact: 0, tags: ['위험관리'] });
  const [topKey, topVal] = Object.entries(sum.byMid || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (topKey && topVal / sum.total > 0.4) add({ id: 'concentration', level: 'high', title: `단일 자산 집중 완화: ${topKey.replace('|', ' › ')}`, why: `총자산의 ${fmtPct(topVal / sum.total)} 가 한 항목에 몰려 있습니다.`, action: '목표 비중(≤25%)을 정하고 초과분을 분기마다 나눠 매도·분산하세요. 세금(양도세·배당세)과 거래비용을 고려해 분할.', impact: 0, tags: ['분산'] });
  const crypto = (sum.byMajor['가상자산'] || 0) / sum.total;
  if (crypto > 0.2) add({ id: 'crypto', level: 'high', title: '가상자산 비중 20% 이하로 관리', why: `가상자산 ${fmtPct(crypto)} — 변동성 연 70% 수준으로 포트폴리오 변동의 대부분을 차지합니다.`, action: '목표 비중을 5~15% 로 정하고 상승 시 초과분을 자동 매도(리밸런싱)해 이익을 실현하세요. 스테이킹 수익은 세금 신고 대상.', impact: 0, tags: ['위험관리'] });
  // 9. DCA
  const monthlySave = Math.round((cf.net.reduce((a, b) => a + b, 0) / 12) * 10000);
  if (monthlySave > 3e5) add({ id: 'dca', title: `월 ${fmtEok(monthlySave)}원 자동 적립투자 (DCA) 설정`, why: `월평균 순저축 ${fmtEok(monthlySave)}원이 발생합니다. 자동화하면 타이밍 고민 없이 저축률이 유지됩니다.`, action: '급여일 다음 날 연금계좌·ISA·일반계좌 순으로 자동이체 + ETF 자동매수(증권사 적립식 기능)를 설정하세요.', impact: monthlySave * 12 * 0.06 * 0.5, tags: ['자동화', 'DCA'] });
  // 10. 인플레이션 헤지 / 11. 통화 분산
  const gold = midAmt(/원자재|금\/실물|골드|gold/i) / sum.total;
  if (gold < 0.03) add({ id: 'hedge', level: 'low', title: '금·원자재 5% 로 인플레이션 헤지', why: `금/원자재 비중 ${fmtPct(gold)}. 주식·채권과 상관관계가 낮아 포트폴리오 변동성을 줄입니다.`, action: 'KRX 금현물(수수료·세금 유리) 또는 금 ETF 로 총자산의 3~5%.', impact: 0, tags: ['분산', '헤지'] });
  const usd = assets.filter((a) => a.currency === 'USD' || /해외|미국|달러|S&P|나스닥/i.test(`${a.mid} ${a.name}`)).reduce((s, a) => s + toKRW(a, fx), 0) / sum.total;
  if (usd < 0.15) add({ id: 'currency', level: 'low', title: '달러 자산 비중 확대 (환 분산)', why: `달러·해외 자산 비중 ${fmtPct(usd)}. 원화 편중은 환율 급등기에 구매력이 떨어집니다.`, action: '해외 주식 ETF(환노출형)·달러 예금 등으로 총자산의 20~40% 를 달러 자산으로.', impact: 0, tags: ['분산'] });
  else if (usd > 0.6) add({ id: 'currency-high', level: 'low', title: '달러 자산 편중 완화', why: `달러·해외 자산 비중 ${fmtPct(usd)}.`, action: '환헤지형 ETF 일부 편입 또는 원화 자산 보강.', impact: 0, tags: ['분산'] });
  // 12. 저축률
  if (saveRate != null && saveRate < 0.3 && income) add({ id: 'save-rate', level: 'high', title: '저축률 30% 까지 끌어올리기', why: `현재 저축률 ${fmtPct(saveRate)}. 소비내역·예산 기능으로 고정비(구독·통신·보험)를 먼저 점검하세요.`, action: `월 ${fmtEok(((0.3 - saveRate) * income) / 12)}원을 추가로 저축하면 30% 에 도달합니다. 급여 인상분은 전액 저축으로.`, impact: (0.3 - saveRate) * income, tags: ['현금흐름'] });
  // 13. 리밸런싱 밴드 규칙
  add({ id: 'band', level: 'low', title: '5%p 밴드 리밸런싱 규칙 운영', why: '목표 비중에서 ±5%p 이상 벗어날 때만 거래하면 거래비용을 줄이면서 고점 매도·저점 매수가 자동으로 일어납니다.', action: '분기마다(기준일 생성 시) 리밸런싱 탭에서 편차를 확인하고 초과분만 조정. 신규 저축으로 부족 자산을 채우면 매도 없이 가능.', impact: sum.total * 0.003, tags: ['규칙', '자산배분'] });
  // 14. 퇴직연금 운용
  const dc = assets.filter((a) => /퇴직연금|IRP|DC/i.test(`${a.mid} ${a.name}`) && num(a.rate) < 0.03);
  if (dc.length) add({ id: 'dc', title: '퇴직연금/IRP 를 원리금보장에서 TDF·ETF 로', why: `기대수익률 3% 미만으로 설정된 연금 자산 ${fmtEok(dc.reduce((s, a) => s + toKRW(a, fx), 0))}원.`, action: '은퇴 예정 연도의 TDF 또는 글로벌 주식 ETF 70% + 채권 30% 로 변경 (위험자산 한도 70%).', impact: dc.reduce((s, a) => s + toKRW(a, fx), 0) * 0.03, tags: ['연금', '장기'] });
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.impact - a.impact);
}

// AI 어드바이저에 보낼 요약 (개인 식별 정보 없음)
export function aiContext({ basis, assets, liabilities, cashflowRows, cfYear, kpis, kpiCtx, q, history, settings, health, alerts, strategies, transactions }) {
  const sum = summarize(assets, liabilities, settings);
  const eok = (v) => Math.round(num(v) / 1e4) / 1e4; // 억원 단위 소수
  const cf = cashflowSummary(cashflowRows);
  const top = [...assets].map((a) => ({ a, k: toKRW(a, settings.fx) })).sort((x, y) => y.k - x.k).slice(0, 15);
  return {
    기준일: basis,
    요약_억원: { 총자산: eok(sum.total), 총부채: eok(sum.debt), 순자산: eok(sum.net), 부채비율: +sum.debtRatio.toFixed(3), 유동비율: +sum.liquidity.toFixed(3), 위험자산비율: +sum.riskRatio.toFixed(3), 안전자산비율: +sum.safeRatio.toFixed(3), 가중기대수익률: +sum.expRate.toFixed(3) },
    대분류별_억원: Object.fromEntries(Object.entries(sum.byMajor).map(([k, v]) => [k, eok(v)])),
    상위자산: top.map(({ a, k }) => ({ 분류: `${a.major}>${a.mid}`, 이름: a.name, 억원: eok(k), 통화: a.currency, 기대수익률: num(a.rate), 보수율: num(a.fee) || undefined })),
    부채: liabilities.filter((l) => num(l.amount)).map((l) => ({ 채권자: l.creditor, 억원: eok(l.amount), 금리: num(l.rate), 만기: l.maturity || null })),
    현금흐름_만원: cfYear ? { 연도: cfYear, 월별수입: cf.inc, 월별지출: cf.out, 연간순이익: cf.net.reduce((a, b) => a + b, 0), 지출항목: cashflowRows.filter((r) => r.type === '지출').map((r) => ({ 항목: r.name, 그룹: r.group, 연합계: (r.m || []).reduce((s, v) => s + num(v), 0), 월예산: num(r.budget) || undefined })) } : null,
    KPI: kpis.map((k) => { const v = kpiValue(k, q, kpiCtx).value; return { 이름: k.name, 지표: k.metric, 목표: k.target, 현재: v == null ? null : +Number(v).toFixed(3), 달성률: achievement(k, v) }; }),
    연도별추이: [...history].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-5).map((r) => ({ 날짜: r.date, 순자산_억원: eok(r.netWorth), 목표_억원: eok(r.target), 나이: num(r.age) || undefined })),
    건강점수: health ? { 점수: health.score, 등급: health.grade, 항목: health.parts.map((p) => ({ 항목: p.label, 점수: p.score == null ? null : Math.round(p.score), 값: p.value })) } : null,
    알림: (alerts || []).map((a) => `${a.level}: ${a.title} — ${a.text}`),
    자동추천전략: (strategies || []).map((s) => `[${s.level}] ${s.title} (연 효과 ${fmtEok(s.impact)}원)`),
    최근소비_카테고리별_만원: transactions ? Object.fromEntries(Object.entries(txSummary(transactions, new Date().getFullYear()).byCat).map(([k, v]) => [k, Math.round(v / 1e4)])) : undefined,
  };
}

export const fmtKRW = (v) => Math.round(num(v)).toLocaleString('ko-KR');
export const fmtNum = (v, d = 2) => {
  const n = num(v);
  return Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toLocaleString('ko-KR', { maximumFractionDigits: d });
};
export const fmtPct = (v, d = 1) => `${(num(v) * 100).toFixed(d)}%`;
export const fmtEok = (v) => {
  const n = num(v);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ko-KR')}만`;
  return `${sign}${fmtKRW(a)}`;
};
export function fmtUnit(v, unit) {
  if (v == null || v === '') return '—';
  if (unit === 'pct') return fmtPct(v);
  if (unit === 'krw') return `${fmtEok(v)}원`;
  if (unit === 'man') return `${fmtNum(v, 1)}만원`;
  return fmtNum(v);
}
