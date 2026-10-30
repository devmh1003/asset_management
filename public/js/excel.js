// 엑셀 다운로드 / 업로드 (SheetJS 전역 XLSX 사용)
import { num, toKRW, uid, today } from './model.js';

const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

// 퍼센트 열: 1.5 를 넘는 숫자는 '15' 처럼 %로 입력한 것으로 보고 100으로 나눔
function pct(v) {
  if (typeof v === 'string' && v.includes('%')) return num(v) / 100;
  const n = num(v);
  return Math.abs(n) > 1.5 ? n / 100 : n;
}

function pad(n) { return String(n).padStart(2, '0'); }
export function normDate(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  const s = String(v).trim().replace(/^'/, '');
  const m = s.match(/^(\d{2,4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
  if (m) {
    const y = m[1].length === 2 ? `20${m[1]}` : m[1];
    return `${y}-${pad(m[2])}-${pad(m[3])}`;
  }
  return s;
}

const str = (v) => (v == null ? '' : String(v).trim());

// 열 정의: h=헤더, k=필드, t=형식(num|pct|date|text), calc=계산열(업로드 시 무시)
const col = (h, k, t = 'text', w) => ({ h, k, t, w });
const calc = (h, fn, t = 'num', w) => ({ h, calc: fn, t, w });

export const SHEETS = [
  {
    name: '자산(B.S)', col: 'assets',
    cols: [
      col('ID', 'id', 'text', 14), col('기준일', 'basis', 'date', 12), col('대분류', 'major'), col('중분류', 'mid'),
      col('소분류', 'name', 'text', 18), col('통화', 'currency', 'text', 7), col('공정가치', 'value', 'num', 15),
      calc('원화환산', (r, c) => toKRW(r, c.settings.fx), 'num', 15),
      calc('비중', (r, c) => { const t = c.basisTotal[r.basis] || 0; return t ? toKRW(r, c.settings.fx) / t : 0; }, 'pct'),
      col('기대이익률', 'rate', 'pct'),
      calc('기대이익', (r, c) => toKRW(r, c.settings.fx) * num(r.rate), 'num', 14),
      calc('NRV', (r, c) => toKRW(r, c.settings.fx) * (1 + num(r.rate)), 'num', 15),
      col('연보수율', 'fee', 'pct'),
      col('운용위임사', 'manager', 'text', 14), col('기타사항', 'note', 'text', 20),
      col('부동산ID', 'reId', 'text', 14),
    ],
  },
  {
    name: '부채(D.L)', col: 'liabilities',
    cols: [
      col('ID', 'id', 'text', 14), col('채권자', 'creditor', 'text', 16), col('금액', 'amount', 'num', 15),
      col('만기일', 'maturity', 'date', 12), col('금리', 'rate', 'pct'),
      calc('연이자', (r) => num(r.amount) * num(r.rate), 'num', 13),
      col('상환방식', 'repay'), col('기타사항', 'note', 'text', 20),
      col('부동산ID', 'reId', 'text', 14),
    ],
  },
  {
    name: '부동산', col: 'realestate',
    cols: [
      col('ID', 'id', 'text', 14), col('명칭', 'name', 'text', 18), col('유형', 'type', 'text', 10), col('용도', 'use', 'text', 10),
      col('주소', 'address', 'text', 24), col('전용면적(㎡)', 'area', 'num', 10), col('지분율', 'share', 'pct'),
      col('취득일', 'acqDate', 'date', 12), col('취득가', 'acqPrice', 'num', 15), col('취득부대비용', 'acqCost', 'num', 13),
      col('현재시세', 'value', 'num', 15), col('시세기준일', 'valuedAt', 'date', 12),
      col('연결대출ID', 'loanId', 'text', 14),
      calc('연결대출', (r, c) => c.loanName[r.loanId] || '', 'text', 14),
      col('임대보증금', 'deposit', 'num', 14), col('월세', 'rent', 'num', 11), col('연보유비용', 'holdCost', 'num', 12),
      col('기대상승률', 'rate', 'pct'),
      { h: '시세이력', t: 'text', w: 30, get: (r) => (r.valuations || []).map((v) => `${v.date}=${num(v.value)}`).join('; '),
        set: (o, v) => { o.valuations = str(v).split(/[;\n]/).map((x) => x.split('=')).filter(([d, n]) => /^\d{4}-\d{2}-\d{2}$/.test(str(d)) && n != null).map(([d, n]) => ({ date: str(d), value: num(n) })); } },
      col('메모', 'note', 'text', 20),
    ],
  },
  {
    name: '현금흐름(C.F)', col: 'cashflow',
    cols: [
      col('ID', 'id', 'text', 14), col('연도', 'year', 'num', 7), col('구분', 'type', 'text', 7),
      col('그룹', 'group'), col('항목', 'name', 'text', 14), col('월예산(만원)', 'budget', 'num', 11),
      ...MONTHS.map((h, i) => ({ h, t: 'num', w: 8, get: (r) => num(r.m?.[i]), set: (o, v) => { (o.m ||= Array(12).fill(0))[i] = num(v); } })),
      calc('합계(만원)', (r) => (r.m || []).reduce((s, v) => s + num(v), 0), 'num', 11),
    ],
  },
  {
    name: '연도별추이', col: 'history',
    cols: [
      col('ID', 'id', 'text', 14), col('기준일', 'date', 'date', 12), col('평가', 'rating', 'text', 8),
      col('순자산평가금액', 'netWorth', 'num', 16), col('부채비율', 'debtRatio', 'pct'),
      calc('총자산증가율', (r, c) => c.growth[r.id] ?? '', 'pct', 12),
      col('목표치', 'target', 'num', 16), col('나이(만)', 'age', 'num', 8), col('메모', 'note', 'text', 20),
    ],
  },
  {
    name: '포트폴리오', col: 'portfolio',
    cols: [
      col('ID', 'id', 'text', 14), col('안 이름', 'plan', 'text', 16), col('구분', 'group'), col('대분류', 'major'),
      col('중분류', 'mid'), col('형태', 'form', 'text', 8), col('금액', 'amount', 'num', 15),
      calc('비중', (r, c) => { const t = c.planTotal[r.plan] || 0; return t ? num(r.amount) / t : 0; }, 'pct'),
      col('최대수익률', 'maxRate', 'pct'), col('최소수익률', 'minRate', 'pct'), col('평균수익률', 'avgRate', 'pct'),
      calc('순자산 증감', (r) => num(r.amount) * num(r.avgRate), 'num', 14),
      calc('FV', (r) => num(r.amount) * (1 + num(r.avgRate)), 'num', 15),
      col('메모', 'note', 'text', 20),
    ],
  },
  {
    name: 'KPI', col: 'kpis',
    cols: [
      col('ID', 'id', 'text', 14), col('연도', 'year', 'num', 7), col('KPI명', 'name', 'text', 16),
      col('지표', 'metric', 'text', 14), col('방향(up/down)', 'dir', 'text', 12), col('목표', 'target', 'num', 14),
      ...[1, 2, 3, 4].map((q) => ({ h: `${q}Q 실적(수동)`, t: 'num', w: 13, get: (r) => (r.q?.[q - 1] ?? ''), set: (o, v) => { (o.q ||= [null, null, null, null])[q - 1] = v === '' || v == null ? null : num(v); } })),
      col('메모', 'note', 'text', 20),
    ],
  },
  {
    name: '시나리오', col: 'scenarios',
    cols: [
      col('ID', 'id', 'text', 14), col('이름', 'name', 'text', 18), col('종류', 'kind', 'text', 10),
      col('시작 순자산', 'net', 'num', 15), col('월 저축액', 'monthlySave', 'num', 12), col('연 수익률', 'annualRate', 'pct'),
      col('기간(년)', 'years', 'num', 8), col('물가상승률', 'inflation', 'pct'), col('저축 증가율', 'saveGrowth', 'pct'),
      col('목표 금액', 'target', 'num', 15), col('메모', 'note', 'text', 20),
    ],
  },
  {
    name: 'AI리포트', col: 'reports',
    cols: [
      col('ID', 'id', 'text', 14), col('날짜', 'date', 'date', 12), col('제목', 'title', 'text', 24),
      col('모델', 'model', 'text', 12), col('내용', 'content', 'text', 80),
    ],
  },
  {
    name: '소비내역', col: 'transactions',
    cols: [
      col('ID', 'id', 'text', 14), col('날짜', 'date', 'date', 12), col('구분', 'type', 'text', 7), col('내용', 'desc', 'text', 24),
      col('카테고리', 'category', 'text', 12), col('금액', 'amount', 'num', 13), col('결제수단', 'method', 'text', 12), col('메모', 'note', 'text', 20),
    ],
  },
  {
    name: '관리목표', col: 'goals',
    cols: [
      col('ID', 'id', 'text', 14), col('항목', 'item', 'text', 14), col('목표', 'target', 'text', 16),
      col('지표', 'metric', 'text', 12), col('현 상황', 'status', 'text', 16), col('전략', 'strategy', 'text', 28),
      col('진행', 'progress', 'text', 10),
    ],
  },
];

function context(data, settings) {
  const basisTotal = {}, planTotal = {}, growth = {};
  for (const a of data.assets) basisTotal[a.basis] = (basisTotal[a.basis] || 0) + toKRW(a, settings.fx);
  for (const p of data.portfolio) planTotal[p.plan] = (planTotal[p.plan] || 0) + num(p.amount);
  const hs = [...data.history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  hs.forEach((h, i) => { if (i > 0 && num(hs[i - 1].netWorth)) growth[h.id] = (num(h.netWorth) - num(hs[i - 1].netWorth)) / num(hs[i - 1].netWorth); });
  const loanName = Object.fromEntries((data.liabilities || []).map((l) => [l.id, l.creditor]));
  return { settings, basisTotal, planTotal, growth, loanName };
}

function cellValue(c, r, ctx) {
  if (c.calc) return c.calc(r, ctx);
  if (c.get) return c.get(r);
  const v = r[c.k];
  if (c.t === 'num' || c.t === 'pct') return v === '' || v == null ? '' : num(v);
  return v ?? '';
}

function sheetFrom(spec, rows, ctx) {
  const aoa = [spec.cols.map((c) => c.h + (c.calc ? ' *' : ''))];
  for (const r of rows) aoa.push(spec.cols.map((c) => cellValue(c, r, ctx)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = spec.cols.map((c) => ({ wch: c.w || 11 }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 0), c: spec.cols.length - 1 } }) };
  for (let R = 1; R < aoa.length; R++) {
    spec.cols.forEach((c, C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell || cell.t !== 'n') return;
      if (c.t === 'pct') cell.z = '0.00%';
      else if (c.t === 'num') cell.z = '#,##0.##';
    });
  }
  return ws;
}

const SORTERS = {
  assets: (a, b) => String(a.basis).localeCompare(String(b.basis)) || num(a.order) - num(b.order),
  cashflow: (a, b) => num(a.year) - num(b.year) || (a.type === b.type ? 0 : a.type === '수입' ? -1 : 1) || num(a.order) - num(b.order),
  kpis: (a, b) => num(a.year) - num(b.year) || num(a.order) - num(b.order),
  history: (a, b) => String(a.date).localeCompare(String(b.date)),
  reports: (a, b) => String(b.date).localeCompare(String(a.date)),
  transactions: (a, b) => String(a.date).localeCompare(String(b.date)) || num(a.order) - num(b.order),
  portfolio: (a, b) => String(a.plan).localeCompare(String(b.plan)) || num(a.order) - num(b.order),
};

export function exportWorkbook(data, settings, filename) {
  const wb = XLSX.utils.book_new();
  const ctx = context(data, settings);
  for (const spec of SHEETS) {
    const rows = [...(data[spec.col] || [])];
    rows.sort(SORTERS[spec.col] || ((a, b) => num(a.order) - num(b.order)));
    XLSX.utils.book_append_sheet(wb, sheetFrom(spec, rows, ctx), spec.name);
  }
  const fx = XLSX.utils.aoa_to_sheet([['통화', '원화환율'], ...Object.entries(settings.fx)]);
  fx['!cols'] = [{ wch: 8 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, fx, '환율');
  const tx = XLSX.utils.aoa_to_sheet([['대분류', '그룹(Var/Risk/Fixed)', '중분류(쉼표로 구분)'], ...settings.taxonomy.map((t) => [t.major, t.group, t.mids.join(', ')])]);
  tx['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, tx, '분류체계');
  const guide = XLSX.utils.aoa_to_sheet([
    ['자산관리 플랫폼 엑셀 양식 안내'],
    [''],
    ['• 헤더에 * 표시가 있는 열은 자동 계산 열이며, 업로드 시 무시됩니다.'],
    ['• ID 열은 플랫폼이 행을 구분하는 값입니다. 새 행을 추가할 때는 비워두면 자동으로 생성됩니다.'],
    ['• 퍼센트 열은 0.15 또는 15% 형식으로 입력하세요.'],
    ['• 날짜는 2026-01-01 형식을 권장합니다 (2026.01.01 / 26.1.1 도 인식).'],
    ['• 현금흐름(C.F) 금액 단위는 만원, 나머지는 원(통화별 금액은 해당 통화) 입니다.'],
    ['• KPI 시트의 분기 실적은 비워두면 앱이 자동 계산하고, 값을 넣으면 그 값이 우선합니다.'],
    ['• 업로드 시 "교체" 를 선택하면 이 파일에 있는 시트의 데이터로 전부 바뀌고, "병합" 은 ID 기준으로 추가/수정만 합니다.'],
    [`• 다운로드 일시: ${new Date().toLocaleString('ko-KR')}`],
  ]);
  guide['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guide, '안내');
  XLSX.writeFile(wb, filename);
}

// 카드사·은행 이용내역(엑셀/CSV) 을 열 이름 추정으로 소비내역 행으로 변환
// 반환 { rows:[{date, desc, amount, type, method}], mapping, sheet, skipped }
const DATE_H = /날짜|일자|거래일|이용일|승인일|일시|date/i;
const DESC_H = /내용|적요|가맹점|이용처|거래처|이용내역|거래내용|상호|메모|description|merchant|memo/i;
const AMT_H = /금액|이용금액|승인금액|출금|지출|amount|withdraw|debit/i;
const IN_H = /입금|수입|deposit|credit/i;
const METHOD_H = /카드|결제수단|계좌|method|card/i;
const CAT_H = /카테고리|분류|category/i;
export function parseStatement(buffer, name = '') {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, codepage: 949 });
  let best = null;
  for (const sn of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
    // 헤더 행: 날짜 + 금액 열이 함께 있는 첫 행
    for (let hi = 0; hi < Math.min(aoa.length, 30); hi++) {
      const hdr = aoa[hi].map((v) => str(v));
      const di = hdr.findIndex((h) => DATE_H.test(h)), ai = hdr.findIndex((h) => AMT_H.test(h) && !IN_H.test(h));
      if (di < 0 || ai < 0) continue;
      const mapping = { date: di, amount: ai, desc: hdr.findIndex((h) => DESC_H.test(h)), income: hdr.findIndex((h) => IN_H.test(h)), method: hdr.findIndex((h) => METHOD_H.test(h)), category: hdr.findIndex((h) => CAT_H.test(h)) };
      if (mapping.desc < 0) mapping.desc = hdr.findIndex((h, i) => i !== di && i !== ai && h && !/번호|no\.?|순번|잔액|승인번호|할부/i.test(h));
      const rows = [];
      let skipped = 0;
      for (const r of aoa.slice(hi + 1)) {
        const date = normDate(r[di]);
        if (!/^\d{4}-\d{2}-\d{2}/.test(date)) { skipped++; continue; }
        const out = Math.abs(num(r[ai])), inc = mapping.income >= 0 ? Math.abs(num(r[mapping.income])) : 0;
        if (!out && !inc) { skipped++; continue; }
        const desc = mapping.desc >= 0 ? str(r[mapping.desc]) : '';
        rows.push({ date: date.slice(0, 10), desc, amount: out || inc, type: out ? '지출' : '수입', method: mapping.method >= 0 ? str(r[mapping.method]) : (name.replace(/\.[^.]+$/, '') || ''), category: mapping.category >= 0 ? str(r[mapping.category]) : '' });
      }
      if (rows.length && (!best || rows.length > best.rows.length)) best = { rows, mapping: Object.fromEntries(Object.entries(mapping).map(([k, i]) => [k, i >= 0 ? hdr[i] : null])), sheet: sn, skipped };
    }
  }
  return best;
}

// 소비내역만 단독 파일로
export function exportTransactions(rows, filename) {
  const spec = SHEETS.find((s) => s.col === 'transactions');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(spec, [...rows].sort(SORTERS.transactions), {}), spec.name);
  const guide = XLSX.utils.aoa_to_sheet([['소비내역 양식'], ['• 날짜(2026-01-31), 구분(수입/지출), 내용, 카테고리, 금액(원), 결제수단, 메모'], ['• ID 는 비워두면 자동 생성. 같은 파일을 다시 올리면 ID 기준으로 수정됩니다.'], ['• 카드사·은행에서 받은 이용내역 파일은 “명세 가져오기” 로 올리면 열을 자동으로 인식합니다.']]);
  guide['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, guide, '안내');
  XLSX.writeFile(wb, filename);
}

function parseValue(c, v) {
  if (c.t === 'num') return v === '' ? 0 : num(v);
  if (c.t === 'pct') return v === '' ? 0 : pct(v);
  if (c.t === 'date') return normDate(v);
  return str(v);
}

function readTable(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const hi = aoa.findIndex((row) => row.some((v) => str(v) !== ''));
  if (hi < 0) return { header: [], rows: [] };
  const header = aoa[hi].map((h) => str(h).replace(/\s*\*$/, ''));
  return { header, rows: aoa.slice(hi + 1) };
}

// 업로드 파일을 파싱해 { collections: {col: rows}, settings: partial, counts } 반환
export function parseWorkbook(buffer, fallbackBasis = today()) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const result = { collections: {}, settings: {}, counts: [], unknown: [] };
  const known = new Set([...SHEETS.map((s) => s.name), '환율', '분류체계', '안내']);
  result.unknown = wb.SheetNames.filter((n) => !known.has(n));

  for (const spec of SHEETS) {
    const ws = wb.Sheets[spec.name];
    if (!ws) continue;
    const { header, rows } = readTable(ws);
    const idx = spec.cols.map((c) => header.indexOf(c.h));
    const missing = spec.cols.filter((c, i) => !c.calc && c.h !== 'ID' && c.k !== 'reId' && idx[i] < 0).map((c) => c.h);
    const out = [];
    rows.forEach((row, ri) => {
      if (!row.some((v) => str(v) !== '')) return;
      const o = {};
      spec.cols.forEach((c, i) => {
        if (c.calc || idx[i] < 0) return;
        const v = row[idx[i]];
        if (c.set) c.set(o, v);
        else o[c.k] = c.k === 'id' ? str(v) : parseValue(c, v);
      });
      if (!o.id) o.id = uid() + ri;
      o.order = ri;
      if ('reId' in o && !o.reId) delete o.reId;
      if (spec.col === 'assets' && !o.basis) o.basis = fallbackBasis;
      if (spec.col === 'assets' && !o.currency) o.currency = 'KRW';
      if (spec.col === 'cashflow') { o.year = num(o.year) || new Date().getFullYear(); o.m ||= Array(12).fill(0); }
      if (spec.col === 'kpis') { o.year = num(o.year) || new Date().getFullYear(); o.q ||= [null, null, null, null]; o.dir = o.dir === 'down' ? 'down' : 'up'; }
      // 지분율 0(빈칸) 은 단독 소유(100%) 로 간주
      if (spec.col === 'realestate') {
        // 빈칸인 면적·기대상승률은 '미입력'(null) 로 유지
        for (const k of ['area', 'rate']) { const ci = spec.cols.findIndex((c) => c.k === k); if (idx[ci] < 0 || str(row[idx[ci]]) === '') o[k] = null; }
        if (!num(o.share)) o.share = 1;
        o.valuations ||= [];
      }
      if (spec.col === 'transactions') { o.type = o.type === '수입' ? '수입' : '지출'; o.amount = Math.abs(num(o.amount)); }
      out.push(o);
    });
    result.collections[spec.col] = out;
    result.counts.push({ sheet: spec.name, rows: out.length, missing });
  }

  if (wb.Sheets['환율']) {
    const { rows } = readTable(wb.Sheets['환율']);
    const fx = {};
    for (const r of rows) if (str(r[0])) fx[str(r[0]).toUpperCase()] = num(r[1]);
    if (Object.keys(fx).length) { fx.KRW = 1; result.settings.fx = fx; result.counts.push({ sheet: '환율', rows: Object.keys(fx).length, missing: [] }); }
  }
  if (wb.Sheets['분류체계']) {
    const { rows } = readTable(wb.Sheets['분류체계']);
    const taxonomy = rows.filter((r) => str(r[0])).map((r) => ({
      major: str(r[0]),
      group: ['Var', 'Risk', 'Fixed'].includes(str(r[1])) ? str(r[1]) : 'Risk',
      mids: str(r[2]).split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    }));
    if (taxonomy.length) { result.settings.taxonomy = taxonomy; result.counts.push({ sheet: '분류체계', rows: taxonomy.length, missing: [] }); }
  }
  return result;
}
