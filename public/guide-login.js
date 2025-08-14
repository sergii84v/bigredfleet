import { supabase } from './supabase.js';
import { listGuides } from './api.js';

const sel = document.getElementById('guideName');
const pin = document.getElementById('guidePin');
pin.oninput = () => {
  pin.value = pin.value.replace(/\D/g, '');
};
const btn = document.getElementById('guideLoginBtn');
const msg = document.getElementById('loginMsg');

function emailFromSlug(slug) { return `${slug}@guides.local`; }

async function init() {
  // Проверяем, не залогинен ли уже пользователь
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.email?.endsWith('@guides.local')) {
    console.log('[Auth] Already logged in as guide, redirecting...');
    window.location.href = './guide.html';
    return;
  }
  
  try {
    const guides = await listGuides();
    if (!guides.length) {
      msg.textContent = 'No guides found. Ask admin to add guides.';
      btn.disabled = true;
      return;
    }
    // Clear the select and add placeholder
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select your name';
    placeholder.disabled = true;
    placeholder.selected = true;
    sel.appendChild(placeholder);
    
    // Add guide options
    guides.forEach(g => {
      const option = document.createElement('option');
      option.value = g.slug;
      option.textContent = g.name;
      sel.appendChild(option);
    });
  } catch {
    msg.textContent = 'Failed to load guides list';
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
    localStorage.setItem('role', 'guide');
    localStorage.setItem('userSlug', slug);
    localStorage.setItem('userName', userName);
    
    window.location.href = './guide.html';
  } catch {
    msg.textContent = 'Invalid PIN';
  }
}

init();
