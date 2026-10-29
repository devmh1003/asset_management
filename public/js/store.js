// 데이터 저장소: Firebase(Firestore + Auth) 또는 로컬(localStorage) 백엔드
import { firebaseConfig } from './firebase-config.js';

export const COLLECTIONS = ['assets', 'liabilities', 'cashflow', 'history', 'portfolio', 'goals', 'kpis', 'scenarios', 'reports'];
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
  // 로그인한 본인 프로필을 갱신 (관리자 계정 목록에 사용)
  async touchProfile(user) {
    const ref = this.fs.doc(this.db, 'profiles', user.uid);
    const snap = await this.fs.getDoc(ref);
    const base = snap.exists() ? snap.data() : { createdAt: new Date().toISOString() };
    const data = { ...base, email: user.email || '', name: user.displayName || base.name || '', photo: user.photoURL || '', lastLogin: new Date().toISOString(), provider: user.providerData?.[0]?.providerId || '' };
    await this.fs.setDoc(ref, data);
    return data;
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
