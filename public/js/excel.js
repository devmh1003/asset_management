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
    ],
  },
  {
    name: '부채(D.L)', col: 'liabilities',
    cols: [
      col('ID', 'id', 'text', 14), col('채권자', 'creditor', 'text', 16), col('금액', 'amount', 'num', 15),
      col('만기일', 'maturity', 'date', 12), col('금리', 'rate', 'pct'),
      calc('연이자', (r) => num(r.amount) * num(r.rate), 'num', 13),
      col('상환방식', 'repay'), col('기타사항', 'note', 'text', 20),
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
  return { settings, basisTotal, planTotal, growth };
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
    const missing = spec.cols.filter((c, i) => !c.calc && c.h !== 'ID' && idx[i] < 0).map((c) => c.h);
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
      if (spec.col === 'assets' && !o.basis) o.basis = fallbackBasis;
      if (spec.col === 'assets' && !o.currency) o.currency = 'KRW';
      if (spec.col === 'cashflow') { o.year = num(o.year) || new Date().getFullYear(); o.m ||= Array(12).fill(0); }
      if (spec.col === 'kpis') { o.year = num(o.year) || new Date().getFullYear(); o.q ||= [null, null, null, null]; o.dir = o.dir === 'down' ? 'down' : 'up'; }
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
