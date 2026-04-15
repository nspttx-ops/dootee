/* ══════════════════════════════════════════
   CONFIG — Firebase
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
   STATE
══════════════════════════════════════════ */
let isAdmin    = false;
let movies     = [];
let ads        = [];
let filterPlatform = 'all';
let searchQ    = '';
let sortKey    = 'default';
let sortDir    = {};
let isBrowse   = false;

// Infinite Scroll
const PAGE_SIZE    = 24;
let currentPage    = 1;
let currentFiltered = [];
let isRendering    = false; // ป้องกัน double-render

// Bulk Action
let selectedMovies = new Set();

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 3000);
}

/* ══════════════════════════════════════════
   AUTH — Firebase only (ไม่มีรหัสผ่านใน code)
══════════════════════════════════════════ */
auth.onAuthStateChanged(user => {
  setAdmin(!!user);
});

function setAdmin(val) {
  isAdmin = val;

  const btn   = document.getElementById('authBtn');
  const panel = document.getElementById('adminPanel');
  const migrateArea = document.getElementById('migrateArea');
  const btnSelectAll = document.getElementById('btnSelectAll');

  if (btn) {
    btn.textContent = val ? '🚪 ออกจากระบบ' : 'Admin Login';
    btn.classList.toggle('logged-in', val);
  }
  if (panel)      panel.classList.toggle('open', val);
  if (migrateArea) migrateArea.style.display = val ? 'block' : 'none';

  // ✅ FIX: ใช้ class แทน ~ CSS selector
  if (btnSelectAll) btnSelectAll.classList.toggle('visible', val);

  if (!val) clearSelection();
  renderAds();
  render();
}

document.getElementById('authBtn')?.addEventListener('click', () => {
  if (isAdmin) {
    if (confirm('ออกจากระบบ Admin?')) {
      auth.signOut()
        .then(() => { setAdmin(false); toast('ออกจากระบบแล้ว', 'ok'); })
        .catch(() => toast('เกิดข้อผิดพลาด', 'err'));
    }
  } else {
    openLoginModal();
  }
});

function openLoginModal()  { document.getElementById('loginModal')?.classList.add('open'); }
function closeLoginModal() {
  document.getElementById('loginModal')?.classList.remove('open');
  document.getElementById('login_email').value = '';
  document.getElementById('login_pass').value  = '';
}

function processLogin() {
  const email = document.getElementById('login_email').value.trim();
  const pass  = document.getElementById('login_pass').value;
  if (!email || !pass) { toast('กรุณากรอก Email และรหัสผ่าน', 'err'); return; }
  auth.signInWithEmailAndPassword(email, pass)
    .then(() => { closeLoginModal(); toast('เข้าสู่ระบบสำเร็จ ✓', 'ok'); })
    .catch(() => toast('Email หรือรหัสผ่านผิด', 'err'));
}

document.getElementById('login_pass')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') processLogin();
});
document.getElementById('loginModal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeLoginModal();
});

/* ══════════════════════════════════════════
   LOAD DATA (Firestore เท่านั้น)
══════════════════════════════════════════ */
async function loadData() {
  // โหลด Ads
  try {
    const snap = await db.collection('ads').get();
    ads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAds();
  } catch {}

  // โหลด Movies
  try {
    setLoadStatus('กำลังโหลดข้อมูล...');
    showSkeletons();
    const snap = await db.collection('movies').orderBy('createdAt', 'desc').get();
    movies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setLoadStatus(`ข้อมูลในระบบ ${movies.length} เรื่อง`);
    render();
  } catch (err) {
    console.error('Load error:', err);
    setLoadStatus('❌ โหลดไม่สำเร็จ');
    showEmpty('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
  }

  // Visitor Counter
  try {
    const ref = db.collection('stats').doc('visitors');
    await ref.set({ count: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    const snap = await ref.get();
    const visEl = document.getElementById('visitorNum');
    if (visEl) visEl.textContent = (snap.data()?.count || 0).toLocaleString();
  } catch {}
}

function setLoadStatus(t) {
  const el = document.getElementById('loadStatus');
  if (el) el.textContent = t;
}
function showSkeletons() {
  const grid = document.getElementById('movieGrid');
  if (grid) grid.innerHTML = Array(8).fill('<div class="skel"></div>').join('');
}
function showEmpty(msg) {
  const grid = document.getElementById('movieGrid');
  if (grid) grid.innerHTML = `<div class="empty"><p>⚠️ ${msg}</p></div>`;
}

/* ══════════════════════════════════════════
   BULK CSV UPLOAD (Smart Replace)
══════════════════════════════════════════ */
function handleCSVUpload() {
  const fileInput = document.getElementById('csvUploadInput');
  const file = fileInput?.files[0];
  if (!file) { toast('กรุณาเลือกไฟล์ CSV', 'err'); return; }
  if (!isAdmin)  { toast('ต้อง Login ก่อน', 'err'); return; }

  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: async function(results) {
      const data = results.data;
      if (!data?.length) { toast('ไม่พบข้อมูลในไฟล์', 'err'); return; }

      if (!confirm(`พบ ${data.length} เรื่อง\nระบบจะ "แทนที่" หากชื่อซ้ำกับที่มีอยู่\nดำเนินการต่อ?`)) return;

      toast(`กำลังอัปโหลด ${data.length} เรื่อง... อย่าปิดหน้าเว็บ`, 'ok');

      let added = 0; let replaced = 0;
      const existingMap = {};
      movies.forEach(m => {
        if (m.title) existingMap[m.title.trim().toLowerCase()] = m.id;
      });

      let batch = db.batch();
      let opCount = 0;

      try {
        for (const row of data) {
          const title = (row.Title || row.title || row['ชื่อเรื่อง'] || '').trim();
          if (!title) continue;

          const dubs = (row.Dubs || row.dubs || row.Audio || row.audio || row['เสียงพากย์'] || '')
            .split(',').map(s => s.trim()).filter(Boolean);

          const movieData = {
            title,
            title_th: (row.Title_TH || row.title_th || row['ชื่อไทย']  || '').trim(),
            poster:   (row.Poster   || row.poster   || '').trim(),
            year:     parseInt(row.Year || row.year || row['ปี'] || '') || null,
            genre:    (row.Genre    || row.genre    || row['ประเภท']    || '').trim(),
            country:  (row.Country  || row.country  || row['ประเทศ']   || '').trim(),
            platforms:(row.Platforms|| row.platforms|| row['แพลตฟอร์ม']|| '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
            dubs,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };

          const key = title.toLowerCase();

          if (existingMap[key]) {
            // ลบเก่าแล้วทับด้วยใหม่
            batch.delete(db.collection('movies').doc(existingMap[key]));
            batch.set(db.collection('movies').doc(), movieData);
            opCount += 2; replaced++;
          } else {
            batch.set(db.collection('movies').doc(), movieData);
            opCount++; added++;
          }

          // Firebase batch limit = 500 operations
          if (opCount >= 450) {
            await batch.commit();
            batch = db.batch();
            opCount = 0;
          }
        }
        if (opCount > 0) await batch.commit();

        toast(`✓ เพิ่ม ${added} เรื่อง / แทนที่ ${replaced} เรื่อง`, 'ok');
        fileInput.value = '';
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        console.error('CSV Upload Error:', err);
        toast('เกิดข้อผิดพลาดระหว่างอัปโหลด', 'err');
      }
    }
  });
}

/* ══════════════════════════════════════════
   BULK DELETE
══════════════════════════════════════════ */
function toggleSelect(id, isChecked) {
  if (isChecked) selectedMovies.add(id);
  else           selectedMovies.delete(id);
  updateBulkBar();
}

function selectAllVisible() {
  document.querySelectorAll('.card-checkbox').forEach(cb => {
    if (!cb.checked) { cb.checked = true; selectedMovies.add(cb.value); }
  });
  updateBulkBar();
}

function clearSelection() {
  selectedMovies.clear();
  updateBulkBar();
  document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
}

function updateBulkBar() {
  const bar   = document.getElementById('bulkActionBar');
  const count = document.getElementById('bulkCount');
  if (!bar || !count) return;
  count.textContent = selectedMovies.size;
  bar.classList.toggle('show', selectedMovies.size > 0);
}

async function bulkDeleteSelected() {
  if (selectedMovies.size === 0) return;
  if (!confirm(`ลบ ${selectedMovies.size} เรื่อง? (กู้คืนไม่ได้)`)) return;

  toast(`กำลังลบ ${selectedMovies.size} เรื่อง...`, 'ok');
  try {
    let batch = db.batch();
    let opCount = 0;
    for (const id of selectedMovies) {
      batch.delete(db.collection('movies').doc(id));
      opCount++;
      if (opCount >= 480) {
        await batch.commit();
        batch = db.batch(); opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();

    movies = movies.filter(m => !selectedMovies.has(m.id));
    selectedMovies.clear();
    updateBulkBar();
    render();
    toast('ลบสำเร็จ ✓', 'ok');
  } catch (err) {
    console.error('Bulk Delete Error:', err);
    toast('เกิดข้อผิดพลาดในการลบ', 'err');
  }
}

/* ══════════════════════════════════════════
   ADD / EDIT / DELETE MOVIE
══════════════════════════════════════════ */
async function addMovie() {
  if (!isAdmin) return;
  const title = document.getElementById('f_title')?.value.trim();
  if (!title) { toast('กรุณาใส่ชื่อเรื่อง', 'err'); return; }
  const platforms = [...document.querySelectorAll('#platCBs input:checked')].map(c => c.value);
  if (!platforms.length) { toast('เลือกอย่างน้อย 1 Platform', 'err'); return; }

  const data = {
    title,
    title_th: document.getElementById('f_title_th')?.value.trim() || '',
    poster:   document.getElementById('f_poster')?.value.trim()   || '',
    year:     parseInt(document.getElementById('f_year')?.value)  || null,
    genre:    document.getElementById('f_genre')?.value           || '',
    country:  document.getElementById('f_country')?.value.trim() || '',
    platforms,
    dubs: [...document.querySelectorAll('#dubCBs input:checked')].map(c => c.value),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    const ref = await db.collection('movies').add(data);
    movies.unshift({ id: ref.id, ...data });
    ['f_title','f_title_th','f_poster','f_year','f_country'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const fGenre = document.getElementById('f_genre');
    if (fGenre) fGenre.value = '';
    resetCBs(['platCBs','dubCBs']);
    document.getElementById('addDetails')?.removeAttribute('open');
    render();
    toast('เพิ่มหนังสำเร็จ ✓', 'ok');
  } catch (e) {
    toast('เพิ่มไม่สำเร็จ: ' + e.message, 'err');
  }
}

function openEditModal(id) {
  if (!isAdmin) return;
  const m = movies.find(x => x.id === id);
  if (!m) return;
  document.getElementById('e_id').value      = id;
  document.getElementById('e_title').value   = m.title    || '';
  document.getElementById('e_title_th').value= m.title_th || '';
  document.getElementById('e_poster').value  = m.poster   || '';
  document.getElementById('e_year').value    = m.year     || '';
  document.getElementById('e_genre').value   = m.genre    || '';
  document.getElementById('e_country').value = m.country  || '';
  document.querySelectorAll('#editPlatCBs input').forEach(cb => {
    cb.checked = (m.platforms||[]).includes(cb.value);
    cb.closest('.plat-cb')?.classList.toggle('checked', cb.checked);
  });
  document.querySelectorAll('#editDubCBs input').forEach(cb => {
    cb.checked = (m.dubs||[]).includes(cb.value);
    cb.closest('.plat-cb')?.classList.toggle('checked', cb.checked);
  });
  document.getElementById('editOverlay')?.classList.add('open');
}

function closeEditModal() {
  document.getElementById('editOverlay')?.classList.remove('open');
}

document.getElementById('editOverlay')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeEditModal();
});

async function saveEdit() {
  if (!isAdmin) return;
  const id    = document.getElementById('e_id').value;
  const title = document.getElementById('e_title').value.trim();
  if (!title) { toast('ใส่ชื่อเรื่อง', 'err'); return; }

  const data = {
    title,
    title_th: document.getElementById('e_title_th').value.trim(),
    poster:   document.getElementById('e_poster').value.trim(),
    year:     parseInt(document.getElementById('e_year').value) || null,
    genre:    document.getElementById('e_genre').value,
    country:  document.getElementById('e_country').value.trim(),
    platforms:[...document.querySelectorAll('#editPlatCBs input:checked')].map(c=>c.value),
    dubs:     [...document.querySelectorAll('#editDubCBs input:checked')].map(c=>c.value),
  };

  try {
    await db.collection('movies').doc(id).update(data);
    const i = movies.findIndex(m => m.id === id);
    if (i > -1) movies[i] = { ...movies[i], ...data };
    closeEditModal(); render();
    toast('บันทึกแล้ว ✓', 'ok');
  } catch (e) {
    toast('แก้ไขไม่สำเร็จ: ' + e.message, 'err');
  }
}

async function deleteMovie(id) {
  if (!isAdmin || !confirm('ยืนยันลบ?')) return;
  try {
    await db.collection('movies').doc(id).delete();
    movies = movies.filter(m => m.id !== id);
    render();
    toast('ลบแล้ว', 'ok');
  } catch (e) {
    toast('ลบไม่สำเร็จ', 'err');
  }
}

function resetCBs(ids) {
  ids.forEach(id => {
    document.querySelectorAll(`#${id} input`).forEach(cb => {
      cb.checked = false;
      cb.closest('.plat-cb')?.classList.remove('checked');
    });
  });
}

/* ══════════════════════════════════════════
   ADS SYSTEM
══════════════════════════════════════════ */
async function addAd() {
  if (!isAdmin) return;
  const img_sq     = document.getElementById('ad_img_sq')?.value.trim();
  const img_banner = document.getElementById('ad_img_banner')?.value.trim();
  const link       = document.getElementById('ad_link')?.value.trim();
  const side       = document.getElementById('ad_side')?.value;

  if (!img_sq && !img_banner) {
    toast('กรุณาใส่รูปอย่างน้อย 1 แบบ', 'err'); return;
  }
  // ตรวจ URL
  const urlOk = u => !u || u.startsWith('http');
  if (!urlOk(img_sq) || !urlOk(img_banner)) {
    toast('URL ไม่ถูกต้อง', 'err'); return;
  }

  const sideAds = ads.filter(a => a.side === side);
  if (sideAds.length >= 5) {
    toast(`โฆษณาด้าน${side==='left'?'ซ้าย':'ขวา'} เต็ม 5 รูปแล้ว`, 'err'); return;
  }

  try {
    const data = { side, img_sq: img_sq||'', img_banner: img_banner||'', link: link||'',
      createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const ref = await db.collection('ads').add(data);
    ads.push({ id: ref.id, ...data });
    document.getElementById('ad_img_sq').value     = '';
    document.getElementById('ad_img_banner').value = '';
    document.getElementById('ad_link').value       = '';
    document.getElementById('addAdDetails')?.removeAttribute('open');
    renderAds();
    toast('เพิ่มโฆษณาสำเร็จ ✓', 'ok');
  } catch (e) {
    toast('ผิดพลาด: ' + e.message, 'err');
  }
}

async function deleteAd(id) {
  if (!isAdmin || !confirm('ลบโฆษณานี้?')) return;
  try {
    await db.collection('ads').doc(id).delete();
    ads = ads.filter(a => a.id !== id);
    renderAds();
    toast('ลบโฆษณาแล้ว', 'ok');
  } catch { toast('ลบไม่ได้', 'err'); }
}

function renderAds() {
  // PC Sidebar (จัตุรัส 1:1, จำกัด 5 รูป/ข้าง)
  const drawPC = side => {
    const list = ads.filter(a => a.side === side && a.img_sq).slice(0, 5);
    if (!list.length) {
      return isAdmin
        ? `<div class="ad-item ad-sq"><div class="ad-placeholder">พื้นที่โฆษณา ${side}<br>(PC 1:1)</div></div>`
        : '';
    }
    return list.map(a => `
      <div class="ad-item ad-sq">
        ${a.link ? `<a href="${a.link}" target="_blank" rel="noopener"></a>` : ''}
        <img src="${a.img_sq}" alt="ad" onerror="this.style.opacity='.15'">
        ${isAdmin ? `<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>` : ''}
      </div>`).join('');
  };

  const l = document.getElementById('sidebarLeft');
  const r = document.getElementById('sidebarRight');
  if (l) l.innerHTML = drawPC('left');
  if (r) r.innerHTML = drawPC('right');

  // Mobile Banner (แนวนอน)
  const m = document.getElementById('mobileAds');
  if (!m) return;
  const bannerList = ads.filter(a => a.img_banner || a.img_sq);
  if (!bannerList.length) {
    m.innerHTML = isAdmin
      ? `<div class="ad-item ad-banner"><div class="ad-placeholder">พื้นที่โฆษณา Mobile Banner</div></div>`
      : '';
    return;
  }
  m.innerHTML = bannerList.map(a => {
    const imgUrl = a.img_banner || a.img_sq;
    return `
      <div class="ad-item ad-banner">
        ${a.link ? `<a href="${a.link}" target="_blank" rel="noopener"></a>` : ''}
        <img src="${imgUrl}" alt="ad" onerror="this.style.opacity='.15'">
        ${isAdmin ? `<button class="del-ad-btn" onclick="deleteAd('${a.id}')">ลบ</button>` : ''}
      </div>`;
  }).join('');
}

/* ══════════════════════════════════════════
   RENDER MOVIES + INFINITE SCROLL
   ✅ FIX: append mode ไม่ใช้ innerHTML ทับ
══════════════════════════════════════════ */
const PLAT_LABEL = {
  netflix:'Netflix', disney:'Disney+', hbo:'HBO Max', prime:'Prime Video',
  apple:'Apple TV+', viu:'Viu', wetv:'WeTV', iqiyi:'iQIYI', bilibili:'Bilibili',
  hulu:'Hulu', youtube:'YouTube', other:'อื่นๆ'
};

function getFilteredAndSorted() {
  const q = searchQ.toLowerCase().trim();
  let list = movies.filter(m => {
    const ms = !q
      || (m.title  ||'').toLowerCase().includes(q)
      || (m.title_th||'').toLowerCase().includes(q)
      || (m.genre  ||'').toLowerCase().includes(q)
      || String(m.year||'').includes(q);
    const mp = filterPlatform === 'all' || (m.platforms||[]).includes(filterPlatform);
    return ms && mp;
  });

  if (sortKey !== 'default') {
    const d = sortDir[sortKey] ?? 1;
    list = [...list].sort((a, b) => {
      let va, vb;
      if (sortKey === 'year')     { va = a.year||0; vb = b.year||0; }
      else if (sortKey === 'title_th') { va=(a.title_th||'').toLowerCase(); vb=(b.title_th||'').toLowerCase(); }
      else { va=(a.title||'').toLowerCase(); vb=(b.title||'').toLowerCase(); }
      return va < vb ? -d : va > vb ? d : 0;
    });
  }
  return list;
}

function buildCardHTML(m, i, noAnim = false) {
  const animClass = noAnim ? 'no-anim' : '';
  const delay     = noAnim ? '' : `style="animation-delay:${Math.min((i % PAGE_SIZE) * 0.03, 0.4)}s"`;
  const pos = m.poster
    ? `<img src="${m.poster}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>🎬<small>${(m.title||'?').charAt(0)}</small></div>'">`
    : `<div class="no-poster">🎬<small>${(m.title||'?').charAt(0)}</small></div>`;
  const plats = (m.platforms||[]).map(p =>
    `<span class="ptag ${p}">${PLAT_LABEL[p]||p}</span>`
  ).join('');
  const dubs = (m.dubs||[]).map(d => `<span class="dub-tag">${d}</span>`).join('');
  const meta = [m.year, m.genre, m.country].filter(Boolean).join(' · ');
  const cbHtml = isAdmin
    ? `<input type="checkbox" class="card-checkbox" value="${m.id}" onchange="toggleSelect('${m.id}',this.checked)" ${selectedMovies.has(m.id)?'checked':''}>`
    : '';
  const actHtml = isAdmin
    ? `<div class="card-actions"><button class="btn-edit" onclick="openEditModal('${m.id}')">✏️ แก้ไข</button><button class="btn-del" onclick="deleteMovie('${m.id}')">🗑️ ลบ</button></div>`
    : '';

  return `
  <div class="card ${animClass}" ${delay}>
    ${cbHtml}
    <div class="card-poster">${pos}</div>
    <div class="card-body">
      <div class="c-title">${m.title||''}</div>
      ${m.title_th ? `<div class="c-th">${m.title_th}</div>` : ''}
      ${meta       ? `<div class="c-meta">${meta}</div>` : ''}
      ${dubs       ? `<div class="c-dubs">${dubs}</div>` : ''}
      <div class="c-platforms">${plats}</div>
      ${actHtml}
    </div>
  </div>`;
}

function render(isAppend = false) {
  const grid   = document.getElementById('movieGrid');
  const loader = document.getElementById('infiniteLoader');
  const countEl = document.getElementById('countNum');
  if (!grid) return;

  if (!isAppend) {
    // Full re-render: reset state
    currentPage     = 1;
    currentFiltered = getFilteredAndSorted();
    if (countEl) countEl.textContent = currentFiltered.length;

    if (!currentFiltered.length && movies.length > 0) {
      grid.innerHTML = `<div class="empty"><p>🔍 ไม่พบเรื่องที่ค้นหา</p></div>`;
      if (loader) loader.style.display = 'none';
      return;
    }
    if (!currentFiltered.length) {
      if (loader) loader.style.display = 'none';
      return;
    }

    const items = currentFiltered.slice(0, PAGE_SIZE);
    grid.innerHTML = items.map((m, i) => buildCardHTML(m, i, false)).join('');
  } else {
    // ✅ FIX: Append mode → สร้างการ์ดใหม่แล้ว append ต่อท้าย (ไม่ทับ)
    const start = (currentPage - 1) * PAGE_SIZE;
    const end   = currentPage * PAGE_SIZE;
    const items = currentFiltered.slice(start, end);
    if (!items.length) {
      if (loader) loader.style.display = 'none';
      return;
    }
    items.forEach((m, i) => {
      grid.insertAdjacentHTML('beforeend', buildCardHTML(m, start + i, true));
    });
  }

  // แสดง/ซ่อน loader ตาม total
  const totalShown = currentPage * PAGE_SIZE;
  if (loader) {
    loader.style.display = totalShown < currentFiltered.length ? 'flex' : 'none';
  }
}

/* ══════════════════════════════════════════
   FILTER & SORT
══════════════════════════════════════════ */
document.getElementById('platformFilters')?.addEventListener('click', e => {
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
      const ar = b.querySelector('span');
      if (ar && b.dataset.sort !== 'default') {
        ar.textContent = (sortDir[b.dataset.sort] ?? 1) === 1 ? '↑' : '↓';
      }
    });
    btn.classList.add('active');
    render();
  });
});

/* ══════════════════════════════════════════
   AUTOCOMPLETE
══════════════════════════════════════════ */
function buildAC(q, el) {
  if (!q) { el.style.display = 'none'; return; }
  const matches = movies.filter(m =>
    (m.title||'').toLowerCase().includes(q.toLowerCase()) ||
    (m.title_th||'').toLowerCase().includes(q.toLowerCase())
  ).slice(0, 6);
  if (!matches.length) { el.style.display = 'none'; return; }

  const hl = (s, q) => {
    const idx = (s||'').toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return s;
    return s.slice(0,idx) + `<mark>${s.slice(idx,idx+q.length)}</mark>` + s.slice(idx+q.length);
  };

  el.innerHTML = matches.map(m => `
    <div class="ac-item" data-title="${m.title}">
      <svg width="12" height="12" fill="none" stroke="#94a3b8" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <span>${hl(m.title, q)}${m.title_th?` <span style="color:var(--muted);font-size:.75rem">${hl(m.title_th, q)}</span>`:''}</span>
      <span class="ac-sub">${m.year||''}</span>
    </div>`).join('');
  el.style.display = 'block';

  el.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('click', () => {
      searchQ = item.dataset.title;
      ['heroSearchInput','headerSearchInput'].forEach(id => {
        const inp = document.getElementById(id);
        if (inp) inp.value = searchQ;
      });
      el.style.display = 'none';
      enterBrowse();
      render();
    });
  });
}

['hero','header'].forEach(prefix => {
  const inp = document.getElementById(`${prefix}SearchInput`);
  const ac  = document.getElementById(`${prefix}AC`);
  if (!inp || !ac) return;
  inp.addEventListener('input', e => {
    searchQ = e.target.value;
    // sync both inputs
    ['heroSearchInput','headerSearchInput'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el !== inp) el.value = searchQ;
    });
    buildAC(e.target.value, ac);
    if (searchQ) { enterBrowse(); render(); }
  });
  inp.addEventListener('blur', () => setTimeout(() => ac.style.display = 'none', 200));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      ac.style.display = 'none';
      enterBrowse(); render();
    } else if (e.key === 'Escape') {
      ac.style.display = 'none';
    }
  });
});

document.addEventListener('click', e => {
  if (!e.target.closest('.hero-search-wrap')) {
    document.getElementById('heroAC').style.display = 'none';
  }
  if (!e.target.closest('#headerSearch')) {
    document.getElementById('headerAC').style.display = 'none';
  }
});

/* Hero hint chips */
document.querySelectorAll('.hint-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    filterPlatform = chip.dataset.platform;
    document.querySelectorAll('#platformFilters .pill').forEach(p => {
      p.classList.toggle('active', p.dataset.platform === filterPlatform);
    });
    enterBrowse();
    render();
  });
});

/* ══════════════════════════════════════════
   SCROLL LOGIC
   ✅ FIX: header ค้างตลอด ไม่ซ่อนเมื่อ scroll ลง
   + Infinite Scroll
══════════════════════════════════════════ */
function enterBrowse() {
  if (isBrowse) return;
  isBrowse = true;
  document.getElementById('heroSection')?.classList.add('collapsed');
  document.getElementById('mainHeader')?.classList.add('visible');
  document.getElementById('browseSection')?.classList.add('visible');
}

window.addEventListener('scroll', () => {
  const scrollY      = window.scrollY;
  const nearBottom   = (window.innerHeight + scrollY) >= document.body.offsetHeight - 600;

  // Trigger browse mode
  if (scrollY > 80 && !isBrowse) enterBrowse();

  // ✅ FIX: ไม่ซ่อน header เมื่อ scroll ลง — header ค้างบนสุดตลอด
  // (ลบ logic hide-on-scroll ออก)

  // Infinite Scroll: append เพิ่มหน้าถัดไป
  if (nearBottom && !isRendering && currentPage * PAGE_SIZE < currentFiltered.length) {
    isRendering = true;
    currentPage++;
    render(true);
    setTimeout(() => isRendering = false, 300); // debounce
  }
}, { passive: true });

/* ══════════════════════════════════════════
   MISC
══════════════════════════════════════════ */
function toggleMobFilter() {
  document.getElementById('platformFilters')?.classList.toggle('mob-hidden');
}

// Init checkboxes
['platCBs','dubCBs','editPlatCBs','editDubCBs'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelectorAll('.plat-cb').forEach(label => {
    const cb = label.querySelector('input');
    cb?.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
  });
});

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
loadData();
