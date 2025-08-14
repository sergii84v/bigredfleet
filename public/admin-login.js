import { supabase } from './supabase.js';

const form = document.getElementById('adminLoginForm');
const selectEl = document.getElementById('adminSelect');
const pinEl = document.getElementById('adminPin');
const toastWrap = document.getElementById('toastWrap');

function showToast(msg, type = 'info') {
  if (!toastWrap) return alert(msg);
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function guardRedirectIfSignedIn() {
  try {
    const { data } = await supabase.auth.getUser();
    const email = data?.user?.email || '';
    if (email && email.endsWith('@admin.local')) {
      window.location.href = './admin.html';
    }
  } catch (_) {}
}

async function loadAdmins() {
  const { data, error } = await supabase
    .from('admins')
    .select('name, slug')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) { showToast(error.message, 'error'); return; }
  const options = ['<option value="">Select admin</option>']
    .concat((data || []).map(a => `<option value="${a.slug}">${a.name}</option>`));
  selectEl.innerHTML = options.join('');
}

// sanitize PIN as numeric only (max 6)
pinEl?.addEventListener('input', () => {
  pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, 6);
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const slug = selectEl?.value || '';
  const pin = (pinEl?.value || '').trim();

  if (!slug) { showToast('Select admin', 'info'); return; }
  if (!pin)  { showToast('Enter PIN', 'info'); return; }

  const email = `${slug}@admin.local`;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
    if (error) throw error;
    window.location.href = './admin.html';
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Login failed', 'error');
  }
});

// bootstrap
await guardRedirectIfSignedIn();
await loadAdmins();



