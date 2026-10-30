// 데이터 저장소: Firebase(Firestore + Auth) 또는 로컬(localStorage) 백엔드
import { firebaseConfig } from './firebase-config.js';

export const COLLECTIONS = ['assets', 'liabilities', 'cashflow', 'history', 'portfolio', 'goals', 'kpis', 'scenarios', 'reports', 'transactions', 'realestate'];
// ?local=1 을 붙이면 Firebase 설정이 있어도 로컬 모드로 동작 (개발·테스트용)
export const isFirebaseConfigured = !!(firebaseConfig && firebaseConfig.apiKey) && !new URLSearchParams(location.search).has('local');

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

// Firestore 는 undefined 값을 허용하지 않으므로 id 와 undefined 를 제거
function clean(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'id' || v === undefined) continue;
    out[k] = typeof v === 'number' && !Number.isFinite(v) ? 0 : v;
  }
  return out;
}

class LocalBackend {
  constructor() {
    this.kind = 'local';
    this.key = 'asset-manager-local-v1';
    try { this.db = JSON.parse(localStorage.getItem(this.key)) || {}; } catch { this.db = {}; }
  }
  _save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.db)); } catch (e) { console.warn('localStorage 저장 실패', e); }
  }
  async loadAll() {
    const out = {};
    for (const c of COLLECTIONS) out[c] = Object.entries(this.db[c] || {}).map(([id, d]) => ({ ...d, id }));
    out.settings = this.db.settings || null;
    return out;
  }
  async put(col, id, data) { (this.db[col] ||= {})[id] = clean(data); this._save(); }
  async remove(col, id) { delete (this.db[col] || {})[id]; this._save(); }
  async removeMany(col, ids) { for (const id of ids) delete (this.db[col] || {})[id]; this._save(); }
  async putMany(col, rows) { const t = (this.db[col] ||= {}); for (const r of rows) t[r.id] = clean(r); this._save(); }
  async replace(col, rows) { this.db[col] = {}; await this.putMany(col, rows); }
  async saveSettings(s) { this.db.settings = s; this._save(); }
  async getTaxonomyTemplate() { return this.db.taxonomyTemplate || null; }
  async setTaxonomyTemplate(taxonomy) { this.db.taxonomyTemplate = taxonomy; this._save(); }
  // 변경 이력 (로컬: 최근 1000건)
  async log(entry) {
    const logs = (this.db.logs ||= []);
    logs.unshift({ id: logId(), uid: 'local', email: '로컬 사용자', ...entry, at: new Date().toISOString() });
    if (logs.length > 1000) logs.length = 1000;
    this._save();
  }
  async listLogs({ uid, max = 300 } = {}) { return (this.db.logs || []).filter((l) => !uid || l.uid === uid).slice(0, max); }
  async deleteLogsBefore(iso) { const n = (this.db.logs || []).length; this.db.logs = (this.db.logs || []).filter((l) => l.at >= iso); this._save(); return n - this.db.logs.length; }
  async getAppConfig() { return this.db.appConfig || {}; }
  async setAppConfig(patch) { this.db.appConfig = { ...(this.db.appConfig || {}), ...patch }; this._save(); }
}

// 최신 기록이 먼저 오도록 시간 역순 ID (where 절만으로도 최신순 조회 가능)
function logId() {
  return String(9e12 - Date.now()).padStart(13, '0') + Math.random().toString(36).slice(2, 6);
}

class FirebaseBackend {
  constructor() { this.kind = 'firebase'; this.uid = null; this.viewUid = null; }
  async init() {
    const [appMod, authMod, fs] = await Promise.all([
      import(`${FB}/firebase-app.js`),
      import(`${FB}/firebase-auth.js`),
      import(`${FB}/firebase-firestore.js`),
    ]);
    this.a = authMod;
    this.fs = fs;
    const app = appMod.initializeApp(firebaseConfig);
    this.auth = authMod.getAuth(app);
    this.db = fs.getFirestore(app);
  }
  onAuth(cb) {
    return this.a.onAuthStateChanged(this.auth, (user) => { this.uid = user ? user.uid : null; cb(user); });
  }
  signInGoogle() { return this.a.signInWithPopup(this.auth, new this.a.GoogleAuthProvider()); }
  signInEmail(email, pw) { return this.a.signInWithEmailAndPassword(this.auth, email, pw); }
  signUpEmail(email, pw) { return this.a.createUserWithEmailAndPassword(this.auth, email, pw); }
  signOut() { return this.a.signOut(this.auth); }

  _col(c) { return this.fs.collection(this.db, 'users', this.activeUid, c); }
  _doc(c, id) { return this.fs.doc(this.db, 'users', this.activeUid, c, id); }

  // ---- 프로필 / 관리자 ----
  // 로그인한 본인 프로필을 생성/갱신. 가입 승인제가 켜져 있으면 신규 계정은 pending 으로 생성
  async touchProfile(user, { admin = false } = {}) {
    const ref = this.fs.doc(this.db, 'profiles', user.uid);
    const snap = await this.fs.getDoc(ref);
    const now = new Date().toISOString();
    const common = { email: user.email || '', photo: user.photoURL || '', lastLogin: now, provider: user.providerData?.[0]?.providerId || '' };
    if (!snap.exists()) {
      const cfg = await this.getAppConfig();
      const data = { ...common, name: user.displayName || '', createdAt: now, consentAt: now, loginCount: 1 };
      if (cfg.approvalRequired && !admin) data.pending = true;
      await this.fs.setDoc(ref, data);
      return { ...data, isNew: true };
    }
    const base = snap.data();
    const patch = { ...common, name: base.name || user.displayName || '', loginCount: (Number(base.loginCount) || 0) + 1 };
    await this.fs.setDoc(ref, patch, { merge: true });
    return { ...base, ...patch };
  }
  async getProfile(uid = this.uid) {
    const s = await this.fs.getDoc(this.fs.doc(this.db, 'profiles', uid));
    return s.exists() ? s.data() : null;
  }
  async isAdmin(email) {
    if (!email) return false;
    try { const s = await this.fs.getDoc(this.fs.doc(this.db, 'admins', email)); return s.exists(); } catch { return false; }
  }
  async listAdmins() {
    const snap = await this.fs.getDocs(this.fs.collection(this.db, 'admins'));
    return snap.docs.map((d) => ({ email: d.id, ...d.data() }));
  }
  addAdmin(email, by) { return this.fs.setDoc(this.fs.doc(this.db, 'admins', email), { addedAt: new Date().toISOString(), by }); }
  removeAdmin(email) { return this.fs.deleteDoc(this.fs.doc(this.db, 'admins', email)); }
  async listProfiles() {
    const snap = await this.fs.getDocs(this.fs.collection(this.db, 'profiles'));
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  }
  updateProfile(uid, patch) { return this.fs.setDoc(this.fs.doc(this.db, 'profiles', uid), patch, { merge: true }); }
  async userStats(uid) {
    const out = {};
    await Promise.all(COLLECTIONS.map(async (c) => { const s = await this.fs.getDocs(this.fs.collection(this.db, 'users', uid, c)); out[c] = s.size; }));
    return out;
  }
  async deleteUserData(uid) {
    for (const c of COLLECTIONS.concat('meta')) {
      const s = await this.fs.getDocs(this.fs.collection(this.db, 'users', uid, c));
      await this._batch(s.docs.map((d) => (b) => b.delete(d.ref)));
    }
  }
  async getTaxonomyTemplate() {
    try { const s = await this.fs.getDoc(this.fs.doc(this.db, 'meta', 'taxonomyTemplate')); return s.exists() ? s.data().taxonomy : null; } catch { return null; }
  }
  setTaxonomyTemplate(taxonomy, by) { return this.fs.setDoc(this.fs.doc(this.db, 'meta', 'taxonomyTemplate'), { taxonomy, updatedAt: new Date().toISOString(), by }); }
  // ---- 운영 설정 (공지·가입 승인제) ----
  async getAppConfig() {
    try { const s = await this.fs.getDoc(this.fs.doc(this.db, 'meta', 'appConfig')); return s.exists() ? s.data() : {}; } catch { return {}; }
  }
  setAppConfig(patch) { return this.fs.setDoc(this.fs.doc(this.db, 'meta', 'appConfig'), patch, { merge: true }); }

  // ---- 변경 이력 (auditLogs) ----
  // at 은 서버 시각(규칙에서 request.time 과 일치 검사) — 기록 위조 방지
  async log(entry) {
    const u = this.auth.currentUser;
    if (!u) return;
    const data = { uid: u.uid, email: u.email || '', action: String(entry.action || ''), target: String(entry.target || '').slice(0, 300), detail: String(entry.detail || '').slice(0, 1900), at: this.fs.serverTimestamp() };
    if (entry.subject) data.subject = String(entry.subject);
    await this.fs.setDoc(this.fs.doc(this.db, 'auditLogs', logId()), data);
  }
  async listLogs({ uid, max = 300 } = {}) {
    const { collection, query, where, orderBy, limit, getDocs } = this.fs;
    const c = collection(this.db, 'auditLogs');
    const q = uid ? query(c, where('uid', '==', uid), limit(max)) : query(c, orderBy('at', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map((d) => { const x = d.data(); return { ...x, id: d.id, at: x.at?.toDate ? x.at.toDate().toISOString() : String(x.at || '') }; })
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  async deleteLogsBefore(iso) {
    const { collection, query, where, limit, getDocs, Timestamp } = this.fs;
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const snap = await getDocs(query(collection(this.db, 'auditLogs'), where('at', '<', Timestamp.fromDate(new Date(iso))), limit(400)));
      if (snap.empty) break;
      await this._batch(snap.docs.map((d) => (b) => b.delete(d.ref)));
      total += snap.size;
    }
    return total;
  }

  // ---- 계정 (본인) ----
  resetPassword(email) { return this.a.sendPasswordResetEmail(this.auth, email); }
  sendVerify() { return this.a.sendEmailVerification(this.auth.currentUser); }
  async setDisplayName(name) {
    await this.a.updateProfile(this.auth.currentUser, { displayName: name });
    await this.updateProfile(this.uid, { name });
  }
  // 본인 확인: 이메일 계정은 비밀번호, 그 외는 Google 팝업
  reauth(password) {
    const u = this.auth.currentUser;
    if (password != null && u.providerData.some((p) => p.providerId === 'password')) return this.a.reauthenticateWithCredential(u, this.a.EmailAuthProvider.credential(u.email, password));
    return this.a.reauthenticateWithPopup(u, new this.a.GoogleAuthProvider());
  }
  // 본인 데이터 + 프로필 삭제 후 인증 계정 삭제 (reauth 직후 호출)
  async deleteAccount() {
    const u = this.auth.currentUser;
    await this.deleteUserData(u.uid);
    await this.fs.deleteDoc(this.fs.doc(this.db, 'profiles', u.uid));
    await this.a.deleteUser(u);
  }
  // 관리자: 특정 사용자 데이터 전체 읽기 (백업용)
  async loadAllFor(uid) {
    const prev = this.viewUid;
    this.viewUid = uid;
    try { return await this.loadAll(); } finally { this.viewUid = prev; }
  }

  // 관리자가 다른 사용자의 데이터를 읽기 전용으로 열람
  viewAs(uid) { this.viewUid = uid; }
  get activeUid() { return this.viewUid || this.uid; }

  async loadAll() {
    const out = {};
    await Promise.all(COLLECTIONS.map(async (c) => {
      const snap = await this.fs.getDocs(this._col(c));
      out[c] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    }));
    const s = await this.fs.getDoc(this._doc('meta', 'settings'));
    out.settings = s.exists() ? s.data() : null;
    return out;
  }
  async put(col, id, data) { await this.fs.setDoc(this._doc(col, id), clean(data)); }
  async remove(col, id) { await this.fs.deleteDoc(this._doc(col, id)); }
  // 배치는 최대 500건이므로 나눠서 커밋
  async _batch(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = this.fs.writeBatch(this.db);
      for (const op of ops.slice(i, i + 400)) op(b);
      await b.commit();
    }
  }
  async removeMany(col, ids) { await this._batch(ids.map((id) => (b) => b.delete(this._doc(col, id)))); }
  async putMany(col, rows) { await this._batch(rows.map((r) => (b) => b.set(this._doc(col, r.id), clean(r)))); }
  async replace(col, rows) {
    const snap = await this.fs.getDocs(this._col(col));
    const keep = new Set(rows.map((r) => r.id));
    const ops = snap.docs.filter((d) => !keep.has(d.id)).map((d) => (b) => b.delete(d.ref));
    ops.push(...rows.map((r) => (b) => b.set(this._doc(col, r.id), clean(r))));
    await this._batch(ops);
  }
  async saveSettings(s) { await this.fs.setDoc(this._doc('meta', 'settings'), clean(s)); }
}

export async function createBackend() {
  if (!isFirebaseConfigured) return new LocalBackend();
  const fb = new FirebaseBackend();
  await fb.init();
  return fb;
}
