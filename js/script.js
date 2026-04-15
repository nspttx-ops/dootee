/* ══════════════════════════════════════════
   CONFIG (ตั้งค่า Firebase)
══════════════════════════════════════════ */
const FB_CFG = {
  apiKey: "AIzaSyBFaJDjOn2FD99BzbLXPaFnnGtR7JwJNsE",
  authDomain: "dootee.firebaseapp.com",
  projectId: "dootee",
  storageBucket: "dootee.firebasestorage.app",
  messagingSenderId: "1046787113656",
  appId: "1:1046787113656:web:e42e64be44f70fd5e2ea4d"
};

// 📍 ชี้ไปที่ไฟล์ CSV ในโฟลเดอร์ data ของคุณ
const SHEET_CSV = "data/movies.csv"; 

/* ══════════════════════════════════════════
   FIREBASE INIT
══════════════════════════════════════════ */
firebase.initializeApp(FB_CFG);
const db   = firebase.firestore();
const auth = firebase.auth();

/* ══════════════════════════════════════════
   STATE (ตัวแปรสถานะระบบ)
══════════════════════════════════════════ */
let isAdmin = false;
let movies  = [];
let ads     = [];
let filterPlatform = 'all';
let searchQ  = '';
let sortKey  = 'default';
let sortDir  = {};
let isBrowse = false;

// ตัวแปรสำหรับ Pagination (Infinite Scroll)
let currentPage = 1;
const itemsPerPage = 24; // แสดงผลทีละ 24 เรื่อง
let currentFiltered = []; // เก็บข้อมูลที่ผ่านการกรองแล้ว

/* ══════════════════════════════════════════
   TOAST (แจ้งเตือน)
══════════════════════════════════════════ */
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 2800);
}

/* ══════════════════════════════════════════
   AUTH (Secured with Firebase)
══════════════════════════════════════════ */
auth.onAuthStateChanged(user => {
  if (user) setAdmin(true);
  else setAdmin(false);
});

function setAdmin(val) {
  isAdmin = val;
  const btn = document.getElementById('authBtn');
  if(btn) {
      btn.textContent = val ? '🚪 ออกจากระบบ' : 'Admin Login';
      btn.classList.toggle('logged-in', val);
  }
  const panel = document.getElementById('adminPanel');
  if (panel) panel.classList.toggle('open', val);
  renderAds();
  render(); // โหลดใหม่เมื่อสถานะแอดมินเปลี่ยน (เพื่อให้ปุ่มแก้ไข/ลบโผล่)
}

document.getElementById('authBtn')?.addEventListener('click', () => {
  if (isAdmin) {
    if (confirm('ออกจากระบบ Admin?')) {
      auth.signOut().then(() => {
        setAdmin(false);
        toast('ออกจากระบบแล้ว', 'ok');
      }).catch(err => toast('เกิดข้อผิดพลาดในการออกจากระบบ', 'err'));
    }
  } else {
    openLoginModal();
  }
});

function openLoginModal()  { document.getElementById('loginModal')?.classList.add('open'); }
function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if(modal) modal.classList.remove('open');
  const emailInput = document.getElementById('login_email');
  const passInput = document.getElementById('login_pass');
  if(emailInput) emailInput.value = '';
  if(passInput) passInput.value  = '';
}

function processLogin() {
  const email  = document.getElementById('login_email').value.trim();
  const pass = document.getElementById('login_pass').value;
  
  if (!email || !pass) { 
    toast('กรุณากรอก Email และรหัสผ่านให้ครบ', 'err'); 
    return; 
  }

  auth.signInWithEmailAndPassword(email, pass)
    .then(() => { 
        closeLoginModal(); 
        toast('เข้าสู่ระบบสำเร็จ ✓', 'ok'); 
    })
    .catch((error) => {
        toast('Email หรือรหัสผ่านผิด', 'err');
    });
}

document.getElementById('login_pass')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') processLogin();
});
document.getElementById('loginModal')?.addEventListener('click', e => {
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
    const visitorEl = document.getElementById('visitorNum');
    if(visitorEl) visitorEl.textContent = (snap.data()?.count || 0).toLocaleString();
  } catch (err) { 
      const visitorEl = document.getElementById('visitorNum');
      if(visitorEl) visitorEl.textContent = '—'; 
  }
}

/* ══════════════════════════════════════════
   LOAD DATA
══════════════════════════════════════════ */
async function loadData() {
  try {
    const snap = await db.collection('ads').get();
    ads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAds();
  } catch (err) {}

  try {
    const snap = await db.collection('movies').orderBy('createdAt', 'desc').get();
    if (snap.docs.length) {
      movies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {}

  reloadSheets();
  trackVisitor();
}

function reloadSheets() {
  setLoadStatus('กำลังโหลดข้อมูล...');
  showSkeletons();
  Papa.parse(SHEET_CSV, {
    download: true, header: true, skipEmptyLines: true,
    complete: r => {
      if (!r.data.length) { setLoadStatus('⚠️ ไม่พบข้อมูล (หรือเซิร์ฟเวอร์ปฏิเสธการอ่านไฟล์)'); return; }
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
      setLoadStatus(`โหลดสำเร็จ ${movies.length} เรื่อง`);
      render(); // วาดหน้าเว็บครั้งแรกเมื่อโหลดเสร็จ
    },
    error: () => { setLoadStatus('❌ โหลดไม่สำเร็จ (ต้องเปิดผ่าน Live Server)'); showEmpty('ไม่สามารถอ่านไฟล์ data/movies.csv ได้ ลองเปิดด้วย Live Server'); }
  });
}

function setLoadStatus(t) { const el = document.getElementById('loadStatus'); if(el) el.textContent = t; }
function showSkeletons()  { const grid = document.getElementById('movieGrid'); if(grid) grid.innerHTML = Array(8).fill('<div class="skel"></div>').join(''); }
function showEmpty(msg)   { const grid = document.getElementById('movieGrid'); if(grid) grid.innerHTML = `<div class="empty"><p>⚠️ ${msg}</p></div>`; }

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
    title, title_th: document.getElementById('f_title_th').value.trim(),
    poster: document.getElementById('f_poster').value.trim(),
    year: parseInt(document.getElementById('f_year').value) || null,
    genre: document.getElementById('f_genre').value,
    country: document.getElementById('f_country').value.trim(),
    platforms, dubs: [...document.querySelectorAll('#dubCBs input:checked')].map(c => c.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    const ref = await db.collection('movies').add(data);
    movies.unshift({ id: ref.id, ...data });
    ['f_title','f_title_th','f_poster','f_year','f_country'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    document.getElementById('f_genre').value = '';
    ['platCBs','dubCBs'].forEach(id => document.querySelectorAll(`#${id} input`).forEach(cb => { cb.checked=false; cb.closest('.plat-cb').classList.remove('checked'); }));
    document.getElementById('addDetails').removeAttribute('open');
    render(); toast('เพิ่มหนังสำเร็จ ✓', 'ok');
  } catch(e) { toast('เพิ่มไม่สำเร็จ', 'err'); }
}

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
function closeEditModal() { document.getElementById('editOverlay')?.classList.remove('open'); }

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
    closeEditModal(); render(); toast('บันทึกแล้ว ✓', 'ok');
  } catch(e) { toast('แก้ไขไม่สำเร็จ', 'err'); }
}

async function deleteMovie(id) {
  if (!isAdmin || !confirm('ยืนยันลบหนังเรื่องนี้?')) return;
  try {
    if (!id.startsWith('sheet_')) await db.collection('movies').doc(id).delete();
    movies = movies.filter(m => m.id !== id);
    render(); toast('ลบแล้ว', 'ok');
  } catch(e) { toast('ลบไม่สำเร็จ', 'err'); }
}

/* ══════════════════════════════════════════
   ADS
══════════════════════════════════════════ */
async function addAd() {
  if (!isAdmin) return;
  const img  = document.getElementById('ad_img').value.trim();
  const link = document.getElementById('ad_link').value.trim();
  const side = document.getElementById('ad_side').value;
  if (!img) { toast('ใส่ URL รูปภาพ', 'err'); return; }
  try {
    const data = { side, img, link: link||'', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const ref  = await db.collection('ads').add(data);
    ads.push({ id: ref.id, ...data });
    document.getElementById('ad_img').value  = '';
    document.getElementById('ad_link').value = '';
    renderAds(); toast('เพิ่มโฆษณาสำเร็จ', 'ok');
  } catch(e) { toast('ผิดพลาด', 'err'); }
}

async function deleteAd(id) {
  if (!isAdmin || !confirm('ลบโฆษณานี้?')) return;
  try {
    await db.collection('ads').doc(id).delete();
    ads = ads.filter(a => a.id !== id);
    renderAds(); toast('ลบแล้ว', 'ok');
  } catch(e) {}
}

function renderAds() {
  const draw = side => {
    const list = ads.filter(a => a.side === side);
    if (!list.length) return isAdmin ? `<div class="ad-item">พื้นที่โฆษณา ${side}</div>` : '';
    return list.map(a => `
      <div class="ad-item">
        ${a.link ? `<a href="${a.link}" target="_blank">` : ''}
        <img src="${a.img}" onerror="this.style.opacity='.2'">
        ${a.link ? '</a>' : ''}
        ${isAdmin ? `<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>` : ''}
      </div>`).join('');
  };
  const l = document.getElementById('sidebarLeft'); if(l) l.innerHTML = draw('left');
  const r = document.getElementById('sidebarRight'); if(r) r.innerHTML = draw('right');
  const m = document.getElementById('mobileAds');
  if(m) m.innerHTML = ads.length ? ads.map(a=>`<div class="ad-item">${a.link?`<a href="${a.link}" target="_blank">`:''}<img src="${a.img}">${a.link?'</a>':''}${isAdmin?`<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>`:''}</div>`).join('') : '';
}

/* ══════════════════════════════════════════
   RENDER MOVIES (พร้อมระบบ Infinite Scroll)
══════════════════════════════════════════ */
const PLAT_LABEL = { netflix:'Netflix', disney:'Disney+', hbo:'HBO Max', prime:'Prime Video', apple:'Apple TV+', hulu:'Hulu', youtube:'YouTube', other:'อื่นๆ' };

// แยกฟังก์ชันดึงข้อมูลที่กรองและเรียงลำดับแล้วออกมา
function getFilteredAndSorted() {
  const q = searchQ.toLowerCase().trim();
  let filtered = movies.filter(m => {
    const ms = !q || m.title.toLowerCase().includes(q) || (m.title_th||'').toLowerCase().includes(q);
    const mp = filterPlatform === 'all' || (m.platforms||[]).includes(filterPlatform);
    return ms && mp;
  });

  const d = sortDir[sortKey] ?? 1;
  if(sortKey !== 'default') {
      filtered.sort((a,b) => {
        let va = sortKey==='year'?a.year||0:(a.title||'').toLowerCase();
        let vb = sortKey==='year'?b.year||0:(b.title||'').toLowerCase();
        return va < vb ? -d : va > vb ? d : 0;
      });
  }
  return filtered;
}

// ฟังก์ชัน Render (รับค่า isAppend เพื่อบอกว่าเป็นการเลื่อนโหลดต่อหรือไม่)
function render(isAppend = false) {
  // ถ้าเป็นการค้นหาใหม่ หรือเปลี่ยนฟิลเตอร์ ให้รีเซ็ตหน้าเป็นหน้าแรก
  if (!isAppend) {
    currentPage = 1;
    currentFiltered = getFilteredAndSorted();
    
    // อัปเดตจำนวนทั้งหมดที่ค้นเจอ
    const countEl = document.getElementById('countNum');
    if(countEl) countEl.textContent = currentFiltered.length;
  }

  const grid = document.getElementById('movieGrid');
  if(!grid) return;

  // กรณีไม่พบข้อมูลเลย
  if (!currentFiltered.length) { 
    grid.innerHTML = `<div class="empty"><p>🔍 ไม่พบเรื่องที่ค้นหา</p></div>`; 
    return; 
  }

  // คำนวณขอบเขตข้อมูลที่จะนำมาแสดง
  const endIndex = currentPage * itemsPerPage;
  const itemsToRender = currentFiltered.slice(0, endIndex);

  // วาด HTML ของการ์ดหนัง
  const htmlString = itemsToRender.map((m, i) => {
    const dl  = Math.min((i % itemsPerPage) * 0.03, 0.5); // รีเซ็ต delay การโหลดของแต่ละหน้า
    const pos = m.poster
      ? `<img src="${m.poster}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>🎬</div>'">`
      : `<div class="no-poster">🎬</div>`;
    const plats = (m.platforms||[]).map(p => `<span class="ptag ${p}"><span class="ptag-dot"></span>${PLAT_LABEL[p]||p}</span>`).join('');
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

  grid.innerHTML = htmlString;
}

/* ══════════════════════════════════════════
   FILTER & SEARCH CONTROLS
══════════════════════════════════════════ */
document.getElementById('platformFilters')?.addEventListener('click', e => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  document.querySelectorAll('#platformFilters .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); filterPlatform = btn.dataset.platform; 
  render(); // ค้นหาใหม่ -> วาดหน้า 1
});

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (key === 'default') sortKey = 'default';
    else if (sortKey === key) sortDir[key] = (sortDir[key] ?? 1) * -1;
    else { sortKey = key; if (!sortDir[key]) sortDir[key] = 1; }
    document.querySelectorAll('.sort-btn').forEach(b => { b.classList.remove('active'); const ar = b.querySelector('span'); if(ar) ar.textContent = b.dataset.sort!=='default' ? ((sortDir[b.dataset.sort]??1)===1 ? '↑' : '↓') : ''; });
    btn.classList.add('active'); 
    render(); // เรียงใหม่ -> วาดหน้า 1
  });
});

function buildAC(q, el) {
  if (!q) { el.style.display='none'; return; }
  const matches = movies.filter(m => (m.title||'').toLowerCase().includes(q.toLowerCase()) || (m.title_th||'').toLowerCase().includes(q.toLowerCase())).slice(0,5);
  if (!matches.length) { el.style.display='none'; return; }
  el.innerHTML = matches.map((m,i) => `<div class="ac-item" data-title="${m.title}">${m.title}</div>`).join('');
  el.style.display = 'block';
  el.querySelectorAll('.ac-item').forEach(item => item.addEventListener('click', () => {
    searchQ = item.dataset.title;
    if(document.getElementById('heroSearchInput')) document.getElementById('heroSearchInput').value = searchQ;
    if(document.getElementById('headerSearchInput')) document.getElementById('headerSearchInput').value = searchQ;
    el.style.display = 'none'; enterBrowse(); 
    render(); // ค้นหา -> วาดหน้า 1
  }));
}

['hero', 'header'].forEach(prefix => {
  const inp = document.getElementById(`${prefix}SearchInput`);
  const ac = document.getElementById(`${prefix}AC`);
  if(inp && ac) {
    inp.addEventListener('input', e => { searchQ = e.target.value; buildAC(e.target.value, ac); if(searchQ) { enterBrowse(); render(); }});
    inp.addEventListener('blur', () => setTimeout(() => ac.style.display='none', 200));
  }
});

function enterBrowse() {
  if (isBrowse) return; isBrowse = true;
  document.getElementById('heroSection')?.classList.add('collapsed');
  document.getElementById('mainHeader')?.classList.add('visible');
  document.getElementById('browseSection')?.classList.add('visible');
}

let lastScrollY = window.scrollY;

// ระบบจัดการ Scroll (ทั้งส่วนของ Header และ Infinite Scroll)
window.addEventListener('scroll', () => {
  const currentScrollY = window.scrollY;

  // 1. ระบบ Infinite Scroll
  const isNearBottom = (window.innerHeight + currentScrollY) >= document.body.offsetHeight - 500;
  // ถ้าเลื่อนลงมาใกล้ขอบล่าง และจำนวนข้อมูลที่โหลดมายังน้อยกว่าข้อมูลทั้งหมดที่มี
  if (isNearBottom && (currentPage * itemsPerPage < currentFiltered.length)) {
    currentPage++; // เพิ่มหน้า
    render(true); // true = ให้โหลดต่อ (Append)
  }

  // 2. ระบบซ่อน/แสดง Header
  if (currentScrollY > 80 && !isBrowse) enterBrowse();
  if (isBrowse) {
    const header = document.getElementById('mainHeader');
    if(header) {
      if (currentScrollY > lastScrollY && currentScrollY > 150) {
        header.classList.remove('visible'); // เลื่อนลง -> ซ่อน Header
      } else {
        header.classList.add('visible'); // เลื่อนขึ้น -> แสดง Header
      }
    }
  }
  
  lastScrollY = currentScrollY;
}, { passive: true });

function toggleMobFilter() { document.getElementById('platformFilters')?.classList.toggle('mob-hidden'); }
['platCBs','dubCBs','editPlatCBs','editDubCBs'].forEach(id => { const el=document.getElementById(id); if(el) el.querySelectorAll('.plat-cb').forEach(l=>{const c=l.querySelector('input'); c.addEventListener('change',()=>l.classList.toggle('checked',c.checked))})});

// สั่งโหลดข้อมูลครั้งแรกตอนเปิดเว็บ
loadData();
