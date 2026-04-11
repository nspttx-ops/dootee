/* ══════════════════════════════════════════
   CONFIG
══════════════════════════════════════════ */
const FB_CFG = {
  apiKey: "AIzaSyBFaJDjOn2FD99BzbLXPaFnnGtR7JwJNsE",
  authDomain: "dootee.firebaseapp.com",
  projectId: "dootee",
  storageBucket: "dootee.firebasestorage.app",
  messagingSenderId: "1046787113656",
  appId: "1:1046787113656:web:e42e64be44f70fd5e2ea4d"
};
const SHEET_CSV  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTgaibi2KqJK1BFLASNmdhw1Qqw1ZHIu5PotNXaDgosvAzl7qiC3rMCNzeaK0SrZgXCu6WvgihYhPMf/pub?output=csv";
const SHEET_EDIT = "https://docs.google.com/spreadsheets/d/16oH-bmk5egnRakx9bm8vhS85TPeyF9jPq0M3bai-Ef4/edit?usp=sharing";

/* ══════════════════════════════════════════
   LOCAL ADMIN CREDENTIALS (Admin1-10)
══════════════════════════════════════════ */
const LOCAL_ADMINS = {
  'admin1': 'X7yB9p',  'admin2': 'm2Kq4N',
  'admin3': 'R5wJ8c',  'admin4': 't9Vz1L',
  'admin5': 'H3fM6d',  'admin6': 'p8Nc2Q',
  'admin7': 'W4jX7k',  'admin8': 'b6Gv9T',
  'admin9': 'F1hP5m',  'admin10': 'y3Ds8R'
};

/* ══════════════════════════════════════════
   FIREBASE INIT
══════════════════════════════════════════ */
firebase.initializeApp(FB_CFG);
const db   = firebase.firestore();
const auth = firebase.auth();

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let isAdmin = false;
let movies  = [];
let ads     = [];
let filterPlatform = 'all';
let searchQ  = '';
let sortKey  = 'default';
let sortDir  = {};
let isBrowse = false;
let acIdx    = -1;

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 2800);
}

/* ══════════════════════════════════════════
   AUTH
══════════════════════════════════════════ */
auth.onAuthStateChanged(user => {
  if (user) setAdmin(true);
  else if (!sessionStorage.getItem('localAdmin')) setAdmin(false);
});

function setAdmin(val) {
  isAdmin = val;
  const btn = document.getElementById('authBtn');
  btn.textContent = val ? '🚪 ออกจากระบบ' : 'Admin Login';
  btn.classList.toggle('logged-in', val);
  const panel = document.getElementById('adminPanel');
  if (panel) panel.classList.toggle('open', val);
  renderAds();
  render();
}

document.getElementById('authBtn').addEventListener('click', () => {
  if (isAdmin) {
    if (confirm('ออกจากระบบ Admin?')) {
      auth.signOut();
      sessionStorage.removeItem('localAdmin');
      setAdmin(false);
      toast('ออกจากระบบแล้ว');
    }
  } else {
    openLoginModal();
  }
});

function openLoginModal()  { document.getElementById('loginModal').classList.add('open'); }
function closeLoginModal() {
  document.getElementById('loginModal').classList.remove('open');
  document.getElementById('login_email').value = '';
  document.getElementById('login_pass').value  = '';
}

function processLogin() {
  const raw  = document.getElementById('login_email').value.trim();
  const pass = document.getElementById('login_pass').value;
  if (!raw || !pass) { toast('กรุณากรอกข้อมูลให้ครบ', 'err'); return; }

  const isEmail = raw.includes('@');

  if (isEmail) {
    auth.signInWithEmailAndPassword(raw, pass)
      .then(() => { closeLoginModal(); toast('เข้าสู่ระบบสำเร็จ ✓', 'ok'); })
      .catch(() => toast('Email หรือรหัสผ่านผิด', 'err'));
  } else {
    const key = raw.toLowerCase();
    if (LOCAL_ADMINS[key] && LOCAL_ADMINS[key] === pass) {
      sessionStorage.setItem('localAdmin', key);
      closeLoginModal();
      setAdmin(true);
      toast(`ยินดีต้อนรับ ${raw} ✓`, 'ok');
    } else {
      toast('Username หรือรหัสผ่านผิด', 'err');
    }
  }
}

document.getElementById('login_pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') processLogin();
});
document.getElementById('loginModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeLoginModal();
});

/* ══════════════════════════════════════════
   VISITOR COUNT
══════════════════════════════════════════ */
async function trackVisitor() {
  try {
    const ref = db.collection('stats').doc('visitors');
    await ref.set({ count: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    const snap = await ref.get();
    document.getElementById('visitorNum').textContent = (snap.data()?.count || 0).toLocaleString();
  } catch { document.getElementById('visitorNum').textContent = '—'; }
}

/* ══════════════════════════════════════════
   LOAD DATA
══════════════════════════════════════════ */
async function loadData() {
  try {
    const snap = await db.collection('ads').get();
    ads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAds();
  } catch {}

  try {
    const snap = await db.collection('movies').orderBy('createdAt', 'desc').get();
    if (snap.docs.length) {
      movies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch {}

  reloadSheets();
  trackVisitor();
}

function reloadSheets() {
  setLoadStatus('กำลังโหลดจาก Google Sheets...');
  showSkeletons();
  Papa.parse(SHEET_CSV, {
    download: true, header: true, skipEmptyLines: true,
    complete: r => {
      if (!r.data.length) { setLoadStatus('⚠️ ไม่พบข้อมูล'); showEmpty('ไม่พบข้อมูลใน Google Sheets'); return; }
      const fromSheets = r.data.map((row, i) => ({
        id: 'sheet_' + i,
        title:    (row.Title    || row.title    || row['ชื่อเรื่อง'] || '').trim(),
        title_th: (row.Title_TH || row.title_th || row['ชื่อไทย']   || '').trim(),
        poster:   (row.Poster   || row.poster   || '').trim(),
        year:     parseInt(row.Year || row.year || row['ปี'] || '') || null,
        platforms:(row.Platforms|| row.platforms|| row['แพลตฟอร์ม'] || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
        dubs:     (row.Audio    || row.audio    || row['เสียง']      || '').split(',').map(s=>s.trim()).filter(Boolean),
        genre:    (row.Genre    || row.genre    || row['ประเภท']     || '').trim(),
        country:  (row.Country  || row.country  || row['ประเทศ']     || '').trim(),
      })).filter(m => m.title);
      movies = [...movies.filter(m => !m.id.startsWith('sheet_')), ...fromSheets];
      setLoadStatus(`โหลดสำเร็จ ${fromSheets.length} เรื่อง`);
      toast(`โหลดจาก Sheets: ${fromSheets.length} เรื่อง ✓`, 'ok');
      render();
    },
    error: () => { setLoadStatus('❌ โหลดไม่สำเร็จ'); showEmpty('ไม่สามารถโหลดข้อมูลได้'); }
  });
}

function setLoadStatus(t) { document.getElementById('loadStatus').textContent = t; }
function showSkeletons()  { document.getElementById('movieGrid').innerHTML = Array(8).fill('<div class="skel"></div>').join(''); }
function showEmpty(msg)   { document.getElementById('movieGrid').innerHTML = `<div class="empty"><p>⚠️ ${msg}</p></div>`; }
function openGoogleSheet(){ window.open(SHEET_EDIT, '_blank'); }

/* ══════════════════════════════════════════
   ADD / EDIT / DELETE MOVIE
══════════════════════════════════════════ */
async function addMovie() {
  if (!isAdmin) { toast('กรุณา Login ก่อน', 'err'); return; }
  const title = document.getElementById('f_title').value.trim();
  if (!title) { toast('กรุณาใส่ชื่อเรื่อง', 'err'); return; }
  const platforms = [...document.querySelectorAll('#platCBs input:checked')].map(c => c.value);
  if (!platforms.length) { toast('เลือกอย่างน้อย 1 platform', 'err'); return; }

  const data = {
    title,
    title_th: document.getElementById('f_title_th').value.trim(),
    poster:   document.getElementById('f_poster').value.trim(),
    year:     parseInt(document.getElementById('f_year').value) || null,
    genre:    document.getElementById('f_genre').value,
    country:  document.getElementById('f_country').value.trim(),
    platforms,
    dubs: [...document.querySelectorAll('#dubCBs input:checked')].map(c => c.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    const ref = await db.collection('movies').add(data);
    movies.unshift({ id: ref.id, ...data });
    resetForm(['f_title','f_title_th','f_poster','f_year','f_country']);
    document.getElementById('f_genre').value = '';
    resetCBs(['platCBs','dubCBs']);
    document.getElementById('addDetails').removeAttribute('open');
    render();
    toast('เพิ่มหนังสำเร็จ ✓', 'ok');
  } catch(e) { toast('เพิ่มไม่สำเร็จ: ' + e.message, 'err'); }
}

function resetForm(ids) { ids.forEach(id => { const el = document.getElementById(id); if(el) el.value=''; }); }
function resetCBs(ids)  { ids.forEach(id => { document.querySelectorAll(`#${id} input`).forEach(cb => { cb.checked=false; cb.closest('.plat-cb').classList.remove('checked'); }); }); }

function openEditModal(id) {
  if (!isAdmin) return;
  const m = movies.find(x => x.id === id);
  if (!m) return;
  document.getElementById('e_id').value      = id;
  document.getElementById('e_title').value   = m.title;
  document.getElementById('e_title_th').value= m.title_th  || '';
  document.getElementById('e_poster').value  = m.poster    || '';
  document.getElementById('e_year').value    = m.year      || '';
  document.getElementById('e_genre').value   = m.genre     || '';
  document.getElementById('e_country').value = m.country   || '';
  document.querySelectorAll('#editPlatCBs input').forEach(cb => {
    cb.checked = (m.platforms||[]).includes(cb.value);
    cb.closest('.plat-cb').classList.toggle('checked', cb.checked);
  });
  document.querySelectorAll('#editDubCBs input').forEach(cb => {
    cb.checked = (m.dubs||[]).includes(cb.value);
    cb.closest('.plat-cb').classList.toggle('checked', cb.checked);
  });
  document.getElementById('editOverlay').classList.add('open');
}
function closeEditModal() { document.getElementById('editOverlay').classList.remove('open'); }
document.getElementById('editOverlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeEditModal(); });

async function saveEdit() {
  if (!isAdmin) return;
  const id    = document.getElementById('e_id').value;
  const title = document.getElementById('e_title').value.trim();
  if (!title) { toast('ใส่ชื่อเรื่อง', 'err'); return; }
  const data = {
    title, title_th: document.getElementById('e_title_th').value.trim(),
    poster:  document.getElementById('e_poster').value.trim(),
    year:    parseInt(document.getElementById('e_year').value) || null,
    genre:   document.getElementById('e_genre').value,
    country: document.getElementById('e_country').value.trim(),
    platforms: [...document.querySelectorAll('#editPlatCBs input:checked')].map(c=>c.value),
    dubs:      [...document.querySelectorAll('#editDubCBs  input:checked')].map(c=>c.value),
  };
  try {
    if (!id.startsWith('sheet_')) await db.collection('movies').doc(id).update(data);
    const i = movies.findIndex(m => m.id === id);
    if (i > -1) movies[i] = { ...movies[i], ...data };
    closeEditModal(); render();
    toast('บันทึกแล้ว ✓', 'ok');
  } catch(e) { toast('แก้ไขไม่สำเร็จ: ' + e.message, 'err'); }
}

async function deleteMovie(id) {
  if (!isAdmin || !confirm('ยืนยันลบหนังเรื่องนี้?')) return;
  try {
    if (!id.startsWith('sheet_')) await db.collection('movies').doc(id).delete();
    movies = movies.filter(m => m.id !== id);
    render();
    toast('ลบแล้ว', 'ok');
  } catch(e) { toast('ลบไม่สำเร็จ: ' + e.message, 'err'); }
}

/* ══════════════════════════════════════════
   ADS
══════════════════════════════════════════ */
async function addAd() {
  if (!isAdmin) return;
  const img  = document.getElementById('ad_img').value.trim();
  const link = document.getElementById('ad_link').value.trim();
  const side = document.getElementById('ad_side').value;
  if (!img || !img.startsWith('http')) { toast('URL รูปไม่ถูกต้อง', 'err'); return; }
  try {
    const data = { side, img, link: link||'', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const ref  = await db.collection('ads').add(data);
    ads.push({ id: ref.id, ...data });
    document.getElementById('ad_img').value  = '';
    document.getElementById('ad_link').value = '';
    document.getElementById('addAdDetails').removeAttribute('open');
    renderAds(); toast('เพิ่มโฆษณาสำเร็จ ✓', 'ok');
  } catch(e) { toast('ผิดพลาด: ' + e.message, 'err'); }
}

async function deleteAd(id) {
  if (!isAdmin || !confirm('ลบโฆษณานี้?')) return;
  try {
    await db.collection('ads').doc(id).delete();
    ads = ads.filter(a => a.id !== id);
    renderAds(); toast('ลบโฆษณาแล้ว', 'ok');
  } catch(e) { toast('ลบไม่ได้', 'err'); }
}

function renderAds() {
  const draw = side => {
    const list = ads.filter(a => a.side === side);
    if (!list.length) return isAdmin ? `<div class="ad-item">พื้นที่โฆษณา ${side}</div>` : '';
    return list.map(a => `
      <div class="ad-item">
        ${a.link ? `<a href="${a.link}" target="_blank" rel="noopener" style="display:block;width:100%;height:100%">` : ''}
        <img src="${a.img}" alt="ad" onerror="this.style.opacity='.2'">
        ${a.link ? '</a>' : ''}
        ${isAdmin ? `<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>` : ''}
      </div>`).join('');
  };
  
  document.getElementById('sidebarLeft').innerHTML  = draw('left');
  document.getElementById('sidebarRight').innerHTML = draw('right');

  const mobileAdsContainer = document.getElementById('mobileAds');
  if (mobileAdsContainer) {
    if (!ads.length) {
      mobileAdsContainer.innerHTML = isAdmin ? `<div class="ad-item">พื้นที่โฆษณา (มือถือ)</div>` : '';
    } else {
      mobileAdsContainer.innerHTML = ads.map(a => `
        <div class="ad-item">
          ${a.link ? `<a href="${a.link}" target="_blank" rel="noopener" style="display:block;width:100%;height:100%">` : ''}
          <img src="${a.img}" alt="ad" onerror="this.style.opacity='.2'">
          ${a.link ? '</a>' : ''}
          ${isAdmin ? `<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>` : ''}
        </div>`).join('');
    }
  }
}

/* ══════════════════════════════════════════
   RENDER MOVIES
══════════════════════════════════════════ */
const PLAT_LABEL = { netflix:'Netflix', disney:'Disney+', hbo:'HBO Max', prime:'Prime Video', apple:'Apple TV+', hulu:'Hulu', youtube:'YouTube', other:'อื่นๆ' };

function getFiltered() {
  const q = searchQ.toLowerCase().trim();
  return movies.filter(m => {
    const ms = !q || m.title.toLowerCase().includes(q) || (m.title_th||'').toLowerCase().includes(q) || (m.genre||'').toLowerCase().includes(q) || String(m.year||'').includes(q);
    const mp = filterPlatform === 'all' || (m.platforms||[]).includes(filterPlatform);
    return ms && mp;
  });
}

function getSorted(list) {
  if (sortKey === 'default') return list;
  const d = sortDir[sortKey] ?? 1;
  return [...list].sort((a,b) => {
    let va, vb;
    if (sortKey === 'title_en') { va=(a.title||'').toLowerCase(); vb=(b.title||'').toLowerCase(); }
    else if (sortKey === 'title_th') { va=(a.title_th||'').toLowerCase(); vb=(b.title_th||'').toLowerCase(); }
    else if (sortKey === 'year')    { va=a.year||0; vb=b.year||0; }
    else if (sortKey === 'audio')   { va=(a.dubs||[]).join(',').toLowerCase(); vb=(b.dubs||[]).join(',').toLowerCase(); }
    if (va < vb) return -d; if (va > vb) return d; return 0;
  });
}

function render() {
  const filtered = getSorted(getFiltered());
  document.getElementById('countNum').textContent = filtered.length;
  const grid = document.getElementById('movieGrid');

  if (!filtered.length && movies.length > 0) {
    grid.innerHTML = `<div class="empty"><p>🔍 ไม่พบเรื่องที่ค้นหา</p></div>`;
    return;
  }
  if (!filtered.length) return;

  grid.innerHTML = filtered.map((m, i) => {
    const dl  = Math.min(i * 0.03, 0.5);
    const pos = m.poster
      ? `<img src="${m.poster}" alt="${m.title}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'><span>🎬</span><small>${(m.title||'').charAt(0)}</small></div>'">`
      : `<div class="no-poster"><span>🎬</span><small>${(m.title||'').charAt(0)}</small></div>`;
    const plats = (m.platforms||[]).map(p =>
      `<span class="ptag ${p}"><span class="ptag-dot"></span>${PLAT_LABEL[p]||p}</span>`
    ).join('');
    const dubs = (m.dubs||[]).map(d => `<span class="dub-tag">${d}</span>`).join('');
    const meta = [m.year, m.genre, m.country].filter(Boolean).join(' · ');
    return `
    <div class="card" style="animation-delay:${dl}s">
      <div class="card-poster">${pos}</div>
      <div class="card-body">
        <div class="c-title">${m.title||''}</div>
        ${m.title_th ? `<div class="c-th">${m.title_th}</div>` : ''}
        ${meta ? `<div class="c-meta">${meta}</div>` : ''}
        ${dubs ? `<div class="c-dubs">${dubs}</div>` : ''}
        <div class="c-platforms">${plats}</div>
        ${isAdmin ? `<div class="card-actions"><button class="btn-edit" onclick="openEditModal('${m.id}')">✏️ แก้ไข</button><button class="btn-del" onclick="deleteMovie('${m.id}')">🗑️ ลบ</button></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════
   FILTER & SORT & AC & HERO SCROLL
══════════════════════════════════════════ */
document.getElementById('platformFilters').addEventListener('click', e => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  document.querySelectorAll('#platformFilters .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterPlatform = btn.dataset.platform;
  render();
});

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (key === 'default') { sortKey = 'default'; }
    else if (sortKey === key) { sortDir[key] = (sortDir[key] ?? 1) * -1; }
    else { sortKey = key; if (!sortDir[key]) sortDir[key] = 1; }
    document.querySelectorAll('.sort-btn').forEach(b => {
      b.classList.remove('active');
      const k = b.dataset.sort;
      const arrowEl = b.querySelector('span');
      if (k !== 'default' && arrowEl) arrowEl.textContent = (sortDir[k]??1) === 1 ? '↑' : '↓';
    });
    btn.classList.add('active');
    render();
  });
});

function buildAC(q, el) {
  if (!q) { el.style.display='none'; return; }
  const matches = movies.filter(m =>
    (m.title||'').toLowerCase().includes(q.toLowerCase()) ||
    (m.title_th||'').toLowerCase().includes(q.toLowerCase())
  ).slice(0,7);
  if (!matches.length) { el.style.display='none'; return; }
  const hl = s => {
    const i = (s||'').toLowerCase().indexOf(q.toLowerCase());
    if (i<0) return s;
    return s.slice(0,i) + `<mark>${s.slice(i,i+q.length)}</mark>` + s.slice(i+q.length);
  };
  el.innerHTML = matches.map((m,i) => `
    <div class="ac-item" data-title="${m.title}" data-idx="${i}">
      <svg width="13" height="13" fill="none" stroke="#94a3b8" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <span style="flex:1">${hl(m.title)}${m.title_th?` <span style="color:var(--muted);font-size:.75rem">${hl(m.title_th)}</span>`:''}</span>
      <span class="ac-sub">${m.year||''}</span>
    </div>`).join('');
  el.style.display = 'block'; acIdx = -1;
  el.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('click', () => {
      searchQ = item.dataset.title;
      document.getElementById('heroSearchInput').value   = searchQ;
      document.getElementById('headerSearchInput').value = searchQ;
      el.style.display = 'none';
      enterBrowse(); render();
    });
  });
}

function acKey(e, inp, acEl) {
  const items = acEl.querySelectorAll('.ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); acIdx = Math.min(acIdx+1,items.length-1); items.forEach((it,i)=>it.classList.toggle('sel',i===acIdx)); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); acIdx = Math.max(acIdx-1,0); items.forEach((it,i)=>it.classList.toggle('sel',i===acIdx)); }
  else if (e.key === 'Enter')  { if(acIdx>=0) items[acIdx].click(); else { searchQ=inp.value.trim(); document.getElementById('heroSearchInput').value=searchQ; document.getElementById('headerSearchInput').value=searchQ; acEl.style.display='none'; enterBrowse(); render(); } }
  else if (e.key === 'Escape') { acEl.style.display='none'; }
}

const heroIn   = document.getElementById('heroSearchInput');
const headerIn = document.getElementById('headerSearchInput');
const heroAC   = document.getElementById('heroAC');
const headAC   = document.getElementById('headerAC');

heroIn.addEventListener('input', e => {
  const v = e.target.value;
  headerIn.value = v; searchQ = v;
  buildAC(v, heroAC);
  if (v) { enterBrowse(); render(); }
});
heroIn.addEventListener('keydown', e => acKey(e, heroIn, heroAC));
heroIn.addEventListener('blur',    () => setTimeout(() => heroAC.style.display='none', 160));

headerIn.addEventListener('input', e => {
  const v = e.target.value;
  heroIn.value = v; searchQ = v;
  buildAC(v, headAC); render();
});
headerIn.addEventListener('keydown', e => acKey(e, headerIn, headAC));
headerIn.addEventListener('blur',    () => setTimeout(() => headAC.style.display='none', 160));

document.addEventListener('click', e => {
  if (!e.target.closest('.hero-search-wrap')) heroAC.style.display='none';
  if (!e.target.closest('#headerSearch'))     headAC.style.display='none';
});

document.querySelectorAll('.hint-chip').forEach(c => {
  c.addEventListener('click', () => {
    filterPlatform = c.dataset.platform;
    document.querySelectorAll('#platformFilters .pill').forEach(p => p.classList.toggle('active', p.dataset.platform===filterPlatform));
    enterBrowse(); render();
  });
});

function enterBrowse() {
  if (isBrowse) return;
  isBrowse = true;
  document.getElementById('heroSection').classList.add('collapsed');
  document.getElementById('mainHeader').classList.add('visible');
  document.getElementById('browseSection').classList.add('visible');
}

let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
  const currentScrollY = window.scrollY;
  if (currentScrollY > 80 && !isBrowse) { enterBrowse(); }
  if (isBrowse) {
    const header = document.getElementById('mainHeader');
    if (currentScrollY > lastScrollY && currentScrollY > 150) {
      header.classList.remove('visible');
    } else {
      header.classList.add('visible');
    }
  }
  lastScrollY = currentScrollY;
}, { passive: true });

function toggleMobFilter() {
  document.getElementById('platformFilters').classList.toggle('mob-hidden');
}

function initCBs(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelectorAll('.plat-cb').forEach(label => {
    const cb = label.querySelector('input');
    cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
  });
}
['platCBs','dubCBs','editPlatCBs','editDubCBs'].forEach(initCBs);

loadData();
