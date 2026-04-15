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
  if(!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 2800);
}

/* ══════════════════════════════════════════
   AUTH (Secured with Firebase Only)
══════════════════════════════════════════ */
auth.onAuthStateChanged(user => {
  if (user) {
    setAdmin(true);
  } else {
    setAdmin(false);
  }
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
  
  if (!email || !pass) { 
    toast('กรุณากรอก Email และรหัสผ่านให้ครบ', 'err'); 
    return; 
  }

  // ใช้ Firebase Auth ในการตรวจสอบเท่านั้น
  auth.signInWithEmailAndPassword(email, pass)
    .then(() => { 
        closeLoginModal(); 
        toast('เข้าสู่ระบบสำเร็จ ✓', 'ok'); 
    })
    .catch((error) => {
        console.error("Login failed:", error);
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
    const
