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

// AI 어드바이저에 보낼 요약 (개인 식별 정보 없음)
export function aiContext({ basis, assets, liabilities, cashflowRows, cfYear, kpis, kpiCtx, q, history, settings, health, alerts }) {
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
