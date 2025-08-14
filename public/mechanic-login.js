import { supabase } from './supabase.js';
import { listMechanics } from './api.js';

const sel = document.getElementById('mechName');
const pin = document.getElementById('mechPin');
pin.oninput = () => {
  pin.value = pin.value.replace(/\D/g, '');
};
const btn = document.getElementById('mechLoginBtn');
const msg = document.getElementById('loginMsg');

function emailFromSlug(slug) { return `${slug}@mechanics.local`; }

async function init() {
  // Проверяем, не залогинен ли уже пользователь
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.email?.endsWith('@mechanics.local')) {
    console.log('[Auth] Already logged in as mechanic, redirecting...');
    window.location.href = './mechanic.html';
    return;
  }
  
  try {
    const mechs = await listMechanics();
    if (!mechs.length) {
      msg.textContent = 'No mechanics found. Ask admin to add mechanics.';
      btn.disabled = true;
      return;
    }
    sel.innerHTML = [
      `<option value="" disabled selected hidden>Choose your name</option>`,
      ...mechs.map(m => `<option value="${m.slug}">${m.name}</option>`)
    ].join('');
  } catch {
    msg.textContent = 'Failed to load mechanics list';
  }

  btn.onclick = doLogin;
  pin.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  msg.textContent = '';
  const slug = sel.value;
  const password = (pin.value || '').trim();
  if (!slug) { msg.textContent = 'Please choose your name'; return; }
  if (!password) { msg.textContent = 'Enter your PIN'; return; }

  const email = emailFromSlug(slug);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    // Сохраняем данные пользователя в localStorage
    const userName = sel.options[sel.selectedIndex]?.text || '';
    localStorage.setItem('role', 'mechanic');
    localStorage.setItem('userSlug', slug);
    localStorage.setItem('userName', userName);
    
    window.location.href = './mechanic.html';
  } catch {
    msg.textContent = 'Invalid PIN';
  }
}

init();
