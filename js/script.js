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

// Pagination
let currentPage = 1;
const itemsPerPage = 24; 
let currentFiltered = []; 

// Bulk Action State
let selectedMovies = new Set();

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
  
  const migrateArea = document.getElementById('migrateArea');
  if (migrateArea) migrateArea.style.display = val ? 'block' : 'none';

  if (!val) clearSelection();

  renderAds();
  render(); 
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
  if (!email || !pass) { toast('กรุณากรอก Email และรหัสผ่าน', 'err'); return; }
  auth.signInWithEmailAndPassword(email, pass)
    .then(() => { closeLoginModal(); toast('เข้าสู่ระบบสำเร็จ ✓', 'ok'); })
    .catch(() => { toast('Email หรือรหัสผ่านผิด', 'err'); });
}

document.getElementById('login_pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') processLogin(); });
document.getElementById('loginModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeLoginModal(); });

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
    setLoadStatus('กำลังโหลดข้อมูลจากฐานข้อมูล...');
    showSkeletons();
    const snap = await db.collection('movies').orderBy('createdAt', 'desc').get();
    if (snap.docs.length) {
      movies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    setLoadStatus(`ข้อมูลในระบบ ${movies.length} เรื่อง`);
    render(); 
  } catch (err) {
    setLoadStatus('❌ โหลดข้อมูลไม่สำเร็จ');
    showEmpty('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
  }

  // Track Visitor
  try {
    const ref = db.collection('stats').doc('visitors');
    await ref.set({ count: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    const vSnap = await ref.get();
    const visitorEl = document.getElementById('visitorNum');
    if(visitorEl) visitorEl.textContent = (vSnap.data()?.count || 0).toLocaleString();
  } catch(e) {}
}

function setLoadStatus(t) { const el = document.getElementById('loadStatus'); if(el) el.textContent = t; }
function showSkeletons()  { const grid = document.getElementById('movieGrid'); if(grid) grid.innerHTML = Array(8).fill('<div class="skel"></div>').join(''); }
function showEmpty(msg)   { const grid = document.getElementById('movieGrid'); if(grid) grid.innerHTML = `<div class="empty"><p>⚠️ ${msg}</p></div>`; }

/* ══════════════════════════════════════════
   BULK UPLOAD (Delete Old & Replace)
══════════════════════════════════════════ */
function handleCSVUpload() {
  const fileInput = document.getElementById('csvUploadInput');
  const file = fileInput.files[0];

  if (!file) { toast('กรุณาเลือกไฟล์ CSV ก่อนครับ', 'err'); return; }

  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: async function(results) {
      const data = results.data;
      if (!data || data.length === 0) { toast('ไม่พบข้อมูลในไฟล์', 'err'); return; }

      if (!confirm(`พบข้อมูล ${data.length} เรื่อง\nระบบจะลบเรื่องเก่าทิ้งแล้วแทนที่ด้วยข้อมูลใหม่นี้\nต้องการดำเนินการต่อหรือไม่?`)) return;
      toast(`กำลังประมวลผล... โปรดอย่าปิดหน้าเว็บ`, 'ok');
      
      let addedCount = 0; let replacedCount = 0;
      const existingMoviesMap = {};
      movies.forEach(m => { if (m.title) existingMoviesMap[m.title.toLowerCase()] = m.id; });

      let batch = db.batch();
      let operationCount = 0;

      try {
        for (const row of data) {
          const title = (row.Title || row.title || row['ชื่อเรื่อง'] || '').trim();
          if (!title) continue;

          const parsedDubs = (row.Dubs || row.dubs || row.Audio || row.audio || row['เสียงพากย์'] || row['เสียง'] || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          const movieData = {
            title: title,
            title_th: (row.Title_TH || row.title_th || row['ชื่อไทย'] || '').trim(),
            poster: (row.Poster || row.poster || '').trim(),
            year: parseInt(row.Year || row.year || row['ปี'] || '') || null,
            genre: (row.Genre || row.genre || row['ประเภท'] || '').trim(),
            country: (row.Country || row.country || row['ประเทศ'] || '').trim(),
            platforms: (row.Platforms || row.platforms || row['แพลตฟอร์ม'] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
            dubs: parsedDubs
          };
          const searchTitle = title.toLowerCase();

          if (existingMoviesMap[searchTitle]) {
            const oldDocRef = db.collection('movies').doc(existingMoviesMap[searchTitle]);
            batch.delete(oldDocRef);
            operationCount++;

            const newDocRef = db.collection('movies').doc();
            movieData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            batch.set(newDocRef, movieData);
            operationCount++;
            replacedCount++;
          } else {
            const newDocRef = db.collection('movies').doc(); 
            movieData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            batch.set(newDocRef, movieData);
            operationCount++;
            addedCount++;
          }

          if (operationCount >= 450) { 
            await batch.commit();
            batch = db.batch();
            operationCount = 0;
          }
        }

        if (operationCount > 0) await batch.commit();

        alert(`🎉 ประมวลผลสำเร็จ!\n\nเพิ่มเรื่องใหม่: ${addedCount} เรื่อง\nแทนที่เรื่องเก่า: ${replacedCount} เรื่อง`);
        fileInput.value = ''; 
        window.location.reload(); 
        
      } catch (err) {
        console.error("Upload Error:", err);
        alert("เกิดข้อผิดพลาดระหว่างอัปโหลด");
      }
    }
  });
}

/* ══════════════════════════════════════════
   BULK DELETE FUNCTIONALITY
══════════════════════════════════════════ */
function toggleSelect(id, isChecked) {
  if (isChecked) selectedMovies.add(id);
  else selectedMovies.delete(id);
  updateBulkActionBar();
}

function selectAllVisible() {
  const checkboxes = document.querySelectorAll('.card-checkbox');
  checkboxes.forEach(cb => {
    if (!cb.checked) {
      cb.checked = true;
      selectedMovies.add(cb.value);
    }
  });
  updateBulkActionBar();
}

function clearSelection() {
  selectedMovies.clear();
  updateBulkActionBar();
  document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
}

function updateBulkActionBar() {
  const bar = document.getElementById('bulkActionBar');
  const countLabel = document.getElementById('bulkCount');
  if (!bar || !countLabel) return;
  
  if (selectedMovies.size > 0) {
    countLabel.textContent = selectedMovies.size;
    bar.classList.add('show');
  } else {
    bar.classList.remove('show');
  }
}

async function bulkDeleteSelected() {
  if (selectedMovies.size === 0) return;
  if (!confirm(`คุณต้องการลบหนังที่เลือกจำนวน ${selectedMovies.size} เรื่อง ใช่หรือไม่?\n(การกระทำนี้ไม่สามารถกู้คืนได้)`)) return;

  toast(`กำลังลบข้อมูล ${selectedMovies.size} เรื่อง...`, 'ok');
  
  try {
    let batch = db.batch();
    let opCount = 0;
    
    for (const id of selectedMovies) {
      batch.delete(db.collection('movies').doc(id));
      opCount++;
      
      if (opCount >= 480) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();
    
    movies = movies.filter(m => !selectedMovies.has(m.id));
    selectedMovies.clear();
    updateBulkActionBar();
    render();
    
    toast('ลบข้อมูลสำเร็จ ✓', 'ok');
    document.getElementById('countNum').textContent = getFilteredAndSorted().length;
  } catch(e) {
    console.error("Bulk Delete Error: ", e);
    toast('เกิดข้อผิดพลาดในการลบข้อมูล', 'err');
  }
}

/* ══════════════════════════════════════════
   ADD / EDIT / DELETE MOVIE
══════════════════════════════════════════ */
async function addMovie() {
  if (!isAdmin) return;
  const title = document.getElementById('f_title').value.trim();
  if (!title) { toast('กรุณาใส่ชื่อเรื่อง', 'err'); return; }
  const platforms = [...document.querySelectorAll('#platCBs input:checked')].map(c => c.value);
  
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
    ['f_title','f_title_th','f_poster','f_year','f_country','f_genre'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    ['platCBs','dubCBs'].forEach(id => document.querySelectorAll(`#${id} input`).forEach(cb => { cb.checked=false; cb.closest('.plat-cb').classList.remove('checked'); }));
    document.getElementById('addDetails').removeAttribute('open');
    render(); toast('เพิ่มหนังสำเร็จ ✓', 'ok');
  } catch(e) { toast('เพิ่มไม่สำเร็จ', 'err'); }
}

function openEditModal(id) {
  if (!isAdmin) return;
  const m = movies.find(x => x.id === id);
  if (!m) return;
  document.getElementById('e_id').value = id;
  document.getElementById('e_title').value = m.title;
  document.getElementById('e_title_th').value = m.title_th || '';
  document.getElementById('e_poster').value = m.poster || '';
  document.getElementById('e_year').value = m.year || '';
  document.getElementById('e_genre').value = m.genre || '';
  document.getElementById('e_country').value = m.country || '';
  document.querySelectorAll('#editPlatCBs input').forEach(cb => { cb.checked = (m.platforms||[]).includes(cb.value); cb.closest('.plat-cb').classList.toggle('checked', cb.checked); });
  document.querySelectorAll('#editDubCBs input').forEach(cb => { cb.checked = (m.dubs||[]).includes(cb.value); cb.closest('.plat-cb').classList.toggle('checked', cb.checked); });
  document.getElementById('editOverlay').classList.add('open');
}
function closeEditModal() { document.getElementById('editOverlay')?.classList.remove('open'); }

async function saveEdit() {
  if (!isAdmin) return;
  const id = document.getElementById('e_id').value;
  const title = document.getElementById('e_title').value.trim();
  if (!title) { toast('ใส่ชื่อเรื่อง', 'err'); return; }
  const data = {
    title, title_th: document.getElementById('e_title_th').value.trim(),
    poster: document.getElementById('e_poster').value.trim(),
    year: parseInt(document.getElementById('e_year').value) || null,
    genre: document.getElementById('e_genre').value,
    country: document.getElementById('e_country').value.trim(),
    platforms: [...document.querySelectorAll('#editPlatCBs input:checked')].map(c=>c.value),
    dubs: [...document.querySelectorAll('#editDubCBs input:checked')].map(c=>c.value),
  };
  try {
    await db.collection('movies').doc(id).update(data);
    const i = movies.findIndex(m => m.id === id);
    if (i > -1) movies[i] = { ...movies[i], ...data };
    closeEditModal(); render(); toast('บันทึกแล้ว ✓', 'ok');
  } catch(e) { toast('แก้ไขไม่สำเร็จ', 'err'); }
}

async function deleteMovie(id) {
  if (!isAdmin || !confirm('ยืนยันลบหนังเรื่องนี้?')) return;
  try {
    await db.collection('movies').doc(id).delete();
    movies = movies.filter(m => m.id !== id);
    render(); toast('ลบแล้ว', 'ok');
  } catch(e) {}
}

/* ══════════════════════════════════════════
   ADS SYSTEM
══════════════════════════════════════════ */
async function addAd() {
  if (!isAdmin) return;
  const img_sq  = document.getElementById('ad_img_sq').value.trim();
  const img_banner = document.getElementById('ad_img_banner').value.trim();
  const link = document.getElementById('ad_link').value.trim();
  const side = document.getElementById('ad_side').value;

  if (!img_sq && !img_banner) { toast('กรุณาใส่ลิงก์รูปภาพอย่างน้อย 1 แบบ', 'err'); return; }

  const currentSideAds = ads.filter(a => a.side === side);
  if (currentSideAds.length >= 5) {
    alert(`โฆษณาด้าน${side === 'left' ? 'ซ้าย' : 'ขวา'} เต็มจำนวน 5 รูปแล้ว กรุณาลบของเดิมออกก่อน`);
    return;
  }

  try {
    const data = { side, img_sq, img_banner, link: link||'', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const ref  = await db.collection('ads').add(data);
    ads.push({ id: ref.id, ...data });
    document.getElementById('ad_img_sq').value  = '';
    document.getElementById('ad_img_banner').value = '';
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
  const drawPC = side => {
    const list = ads.filter(a => a.side === side).slice(0, 5);
    if (!list.length) return isAdmin ? `<div class="ad-item ad-sq"><div style="color:var(--muted);font-size:0.8rem;padding:20px;text-align:center;">พื้นที่โฆษณา ${side}<br>(PC - จัตุรัส 1:1)</div></div>` : '';
    
    return list.map(a => {
      const imgUrl = a.img_sq || a.img; 
      if (!imgUrl) return '';
      return `
      <div class="ad-item ad-sq">
        ${a.link ? `<a href="${a.link}" target="_blank">` : ''}
        <img src="${imgUrl}" onerror="this.style.opacity='.2'">
        ${a.link ? '</a>' : ''}
        ${isAdmin ? `<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>` : ''}
      </div>`;
    }).join('');
  };

  const l = document.getElementById('sidebarLeft'); if(l) l.innerHTML = drawPC('left');
  const r = document.getElementById('sidebarRight'); if(r) r.innerHTML = drawPC('right');

  const m = document.getElementById('mobileAds');
  if(m) {
    const mobileList = ads.filter(a => a.img_banner || a.img); 
    if (!mobileList.length) {
        m.innerHTML = isAdmin ? `<div class="ad-item ad-banner"><div style="color:var(--muted);font-size:0.8rem;padding:20px;text-align:center;">พื้นที่โฆษณา (มือถือ - แบนเนอร์)</div></div>` : '';
    } else {
        m.innerHTML = mobileList.map(a => {
          const imgUrl = a.img_banner || a.img; 
          if (!imgUrl) return '';
          return `
          <div class="ad-item ad-banner">
            ${a.link ? `<a href="${a.link}" target="_blank">` : ''}
            <img src="${imgUrl}" onerror="this.style.opacity='.2'">
            ${a.link ? '</a>' : ''}
            ${isAdmin ? `<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>` : ''}
          </div>`;
        }).join('');
    }
  }
}

/* ══════════════════════════════════════════
   RENDER MOVIES
══════════════════════════════════════════ */
// 👇 เพิ่มชื่อ Platform ในระบบให้แสดงผลบนการ์ด 👇
const PLAT_LABEL = { 
  netflix:'Netflix', disney:'Disney+', hbo:'HBO Max', prime:'Prime Video', apple:'Apple TV+', hulu:'Hulu', youtube:'YouTube', 
  viu:'Viu', wetv:'WeTV', iqiyi:'iQIYI', bilibili:'Bilibili', other:'อื่นๆ' 
};

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

function render(isAppend = false) {
  if (!isAppend) {
    currentPage = 1;
    currentFiltered = getFilteredAndSorted();
    const countEl = document.getElementById('countNum');
    if(countEl) countEl.textContent = currentFiltered.length;
  }

  const grid = document.getElementById('movieGrid');
  if(!grid) return;

  if (!currentFiltered.length) { 
    grid.innerHTML = `<div class="empty"><p>🔍 ไม่พบเรื่องที่ค้นหา</p></div>`; 
    return; 
  }

  const endIndex = currentPage * itemsPerPage;
  const itemsToRender = currentFiltered.slice(0, endIndex);

  const htmlString = itemsToRender.map((m, i) => {
    const dl  = Math.min((i % itemsPerPage) * 0.03, 0.5); 
    const pos = m.poster
      ? `<img src="${m.poster}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>🎬</div>'">`
      : `<div class="no-poster">🎬</div>`;
    const plats = (m.platforms||[]).map(p => `<span class="ptag ${p}"><span class="ptag-dot"></span>${PLAT_LABEL[p]||p}</span>`).join('');
    const dubs = (m.dubs||[]).map(d => `<span class="dub-tag">${d}</span>`).join('');
    const meta = [m.year, m.genre, m.country].filter(Boolean).join(' · ');
    
    const adminCheckbox = isAdmin ? `<input type="checkbox" class="card-checkbox" value="${m.id}" onchange="toggleSelect('${m.id}', this.checked)" ${selectedMovies.has(m.id) ? 'checked' : ''}>` : '';

    return `
    <div class="card" style="animation-delay:${dl}s">
      ${adminCheckbox}
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
   FILTER, SORT & AC SCROLL LOGIC 
══════════════════════════════════════════ */
document.getElementById('platformFilters')?.addEventListener('click', e => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  document.querySelectorAll('#platformFilters .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); filterPlatform = btn.dataset.platform; 
  render(); 
});

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (key === 'default') sortKey = 'default';
    else if (sortKey === key) sortDir[key] = (sortDir[key] ?? 1) * -1;
    else { sortKey = key; if (!sortDir[key]) sortDir[key] = 1; }
    document.querySelectorAll('.sort-btn').forEach(b => { b.classList.remove('active'); const ar = b.querySelector('span'); if(ar) ar.textContent = b.dataset.sort!=='default' ? ((sortDir[b.dataset.sort]??1)===1 ? '↑' : '↓') : ''; });
    btn.classList.add('active'); 
    render(); 
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
    el.style.display = 'none'; enterBrowse(); render(); 
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
window.addEventListener('scroll', () => {
  const currentScrollY = window.scrollY;
  const isNearBottom = (window.innerHeight + currentScrollY) >= document.body.offsetHeight - 500;
  
  if (isNearBottom && (currentPage * itemsPerPage < currentFiltered.length)) {
    currentPage++; render(true); 
  }
  if (currentScrollY > 80 && !isBrowse) enterBrowse();
  if (isBrowse) {
    const header = document.getElementById('mainHeader');
    if(header) {
      if (currentScrollY > lastScrollY && currentScrollY > 150) header.classList.remove('visible'); 
      else header.classList.add('visible'); 
    }
  }
  lastScrollY = currentScrollY;
}, { passive: true });

function toggleMobFilter() { document.getElementById('platformFilters')?.classList.toggle('mob-hidden'); }
['platCBs','dubCBs','editPlatCBs','editDubCBs'].forEach(id => { const el=document.getElementById(id); if(el) el.querySelectorAll('.plat-cb').forEach(l=>{const c=l.querySelector('input'); c.addEventListener('change',()=>l.classList.toggle('checked',c.checked))})});

loadData();
