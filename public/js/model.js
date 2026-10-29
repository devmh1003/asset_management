// 기본 설정, 엑셀 구조 기반 템플릿, 계산 로직

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const today = () => new Date().toISOString().slice(0, 10);

export const DEFAULT_SETTINGS = {
  // 원화 환산 환율 (1 단위당 원). JPY 는 1엔 기준
  fx: { KRW: 1, USD: 1450, EUR: 1690, JPY: 9.5, SGD: 1120, TWD: 46 },
  // 분류체계 (Main 시트의 Var / Risk / Fixed 구분)
  taxonomy: [
    { major: '현금', group: 'Var', mids: ['예금', '적금', '비상금'] },
    { major: '투자', group: 'Risk', mids: ['주식', '펀드'] },
    { major: '가상자산', group: 'Risk', mids: ['가상자산'] },
    { major: '채권형자산', group: 'Fixed', mids: ['P2P', 'PF'] },
    { major: '기타', group: 'Fixed', mids: ['연금', '외화'] },
  ],
};

export const CF_GROUPS = {
  수입: ['급여', '성과급', '기타소득', '잡소득'],
  지출: ['고정비', '변동비', '기타비용', '잡비용'],
};

// 엑셀(B.S 시트)의 항목 구조 — 금액은 0
const A = (major, mid, name, currency, rate, manager = '', note = '') => ({ major, mid, name, currency, value: 0, rate, manager, note });
export const TEMPLATE_ASSETS = [
  A('현금', '예금', '생활비', 'KRW', 0, '토스', '생활비'),
  A('현금', '예금', '투자대기자금', 'KRW', 0, '토스'),
  A('현금', '적금', '적금종합', 'KRW', 0.03, '신한은행'),
  A('현금', '적금', '청약통장', 'KRW', 0.035, '신한은행'),
  A('현금', '적금', '보증금', 'KRW', 0, '오피스텔담보'),
  A('현금', '비상금', 'Buffer 자금', 'KRW', 0, '토스', '비상자금'),
  A('투자', '주식', '삼성증권 굴링', 'KRW', 0.15, '삼성증권', 'AI활용투자'),
  A('투자', '주식', '기타증권종합', 'KRW', 0.15),
  A('투자', '주식', '신한금투(소액)', 'KRW', 0.15, '신한금투'),
  A('투자', '주식', '삼성증권 종합', 'KRW', 0.15, '삼성증권'),
  A('투자', '주식', '토스증권', 'KRW', 0.3, '토스증권'),
  A('투자', '펀드', '우리미국바이오', 'KRW', 0.15, '신한은행'),
  A('투자', '펀드', '카카오 증권', 'KRW', 0.15, '카카오페이'),
  A('투자', '펀드', '한투 베트남', 'KRW', 0.15, '신한은행'),
  A('투자', '펀드', '삼성증권 인도', 'KRW', 0.15, '신한은행'),
  A('투자', '펀드', '한미성장펀드', 'KRW', 0.15, '국민은행'),
  A('가상자산', '가상자산', 'Coinone', 'KRW', 0.4, 'Coinone', '현물'),
  A('가상자산', '가상자산', 'Bithumb', 'KRW', 0.4, 'Bithumb', '현물'),
  A('가상자산', '가상자산', 'Binance', 'USD', 0.4, 'Binance', '단기 Staking'),
  A('가상자산', '가상자산', 'NEXO', 'USD', 0.4, 'NEXO', '단기 Staking'),
  A('가상자산', '가상자산', 'Phantom', 'USD', 0.4, 'Phantom', '단기 Staking'),
  A('가상자산', '가상자산', 'Upbit', 'KRW', 0.4, 'Upbit', '단기 Staking'),
  A('가상자산', '가상자산', 'MetaMask', 'USD', 0.4, 'MetaMask', 'WBTC'),
  A('채권형자산', 'P2P', '어니스트펀드', 'KRW', 0.02, '어니스트펀드'),
  A('채권형자산', 'P2P', '피플펀드', 'KRW', 0.02, '피플펀드'),
  A('채권형자산', 'PF', '모햇(태양광)', 'KRW', 0.12, '모햇'),
  A('기타', '연금', '연금저축', 'KRW', 0.1, '삼성증권'),
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

// 25년결산 시트의 "중점 관리사항" 구조. metric 키는 자동 계산 지표와 연결
export const TEMPLATE_GOALS = [
  { item: '부채비율', target: '15% (±5%)', metric: '부채비율', status: '', strategy: '대출 상환 및 신규차입 관리', progress: '진행중' },
  { item: '유동성', target: '30% (±5%)', metric: '유동비율', status: '', strategy: '', progress: '진행중' },
  { item: '전략투자', target: '-', metric: '기대수익률', status: '', strategy: '', progress: '진행중' },
  { item: '자산 Hedge', target: '총자산 比 40%', metric: '안전자산비율', status: '', strategy: '채권비중 확대', progress: '진행중' },
];

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
    const g = groupOf[a.major] || '기타';
    byGroup[g] = (byGroup[g] || 0) + k;
  }
  const debt = liabilities.reduce((s, l) => s + num(l.amount), 0);
  const interest = liabilities.reduce((s, l) => s + num(l.amount) * num(l.rate), 0);
  const cash = byMajor['현금'] || 0;
  return {
    total, profit, nrv: total + profit, debt, interest,
    net: total - debt,
    debtRatio: total ? debt / total : 0,
    liquidity: total ? cash / total : 0,
    expRate: total ? profit / total : 0,
    safeRatio: total ? ((byGroup.Var || 0) + (byGroup.Fixed || 0)) / total : 0,
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

export const fmtKRW = (v) => Math.round(num(v)).toLocaleString('ko-KR');
export const fmtNum = (v, d = 2) => {
  const n = num(v);
  return Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toLocaleString('ko-KR', { maximumFractionDigits: d });
};
export const fmtPct = (v, d = 1) => `${(num(v) * 100).toFixed(d)}%`;
export const fmtEok = (v) => {
  const n = num(v);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}억`;
  if (Math.abs(n) >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  return fmtKRW(n);
};
