// Guide interface for BigRed Workshop v1.1
// Handles tour guide operations: logging hours, creating tickets, managing test drives

import { supabase } from './supabase.js';
import {
  listBuggies,
  listMyOpenTickets,
  addWorklog,
  createTicketSimple,
  logBuggyHoursSimple,
  listMyRecentHours,
  logout
} from './api.js';

// --- Tiny toast helper for guide page ---
function ensureToastHost() {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.style.cssText = `
      position: fixed; right: 16px; bottom: 16px;
      display: flex; flex-direction: column; gap: 8px;
      z-index: 9999; pointer-events: none;
    `;
    document.body.appendChild(host);
  }
  return host;
}

function notify(message, type = 'info') {
  const host = ensureToastHost();
  const el = document.createElement('div');

  const colors = {
    success: '#16a34a',  // green-600
    error:   '#dc2626',  // red-600
    warning: '#d97706',  // amber-600
    info:    '#334155',  // slate-700
  };
  el.style.cssText = `
    pointer-events: auto;
    color: #fff; background: ${colors[type] || colors.info};
    padding: 12px 14px; border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,.15);
    max-width: min(90vw, 480px);
    font: 500 14px/1.35 system-ui,-apple-system,Segoe UI,Roboto;
    display: flex; align-items: center; gap: 10px;
  `;
  el.innerHTML = `
    <span>${message}</span>
    <button style="
      margin-left:auto;background:rgba(255,255,255,.2);
      border:none;border-radius:999px;color:#fff;
      padding:6px 10px;cursor:pointer
    ">Close</button>
  `;

  host.appendChild(el);

  const close = () => {
    el.style.transition = 'transform .2s ease, opacity .2s ease';
    el.style.transform = 'translateY(6px)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('button').onclick = close;
  setTimeout(close, 3000);
}

function toast(msg, type='info') {
  console.log(msg);
}

// ---- status helper ----
const prettyStatus = (s) => ({
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
}[s] ?? (s || '').replace(/_/g, ' '));

// --- toast-утилита для совместимости ---
const guideToast = (msg, type='info') => notify(msg, type);

// ⚠️ Ничего не менять здесь, кроме URL при необходимости
async function sendMakeWebhook(payload) {
  const url = 'https://hook.eu2.make.com/yd5t7uksm2f28kub3dj0da0t9m2iigty';

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // keepalive — чтобы запрос не оборвался при быстром переходе по страницам
      keepalive: true,
    });
    // Если Make не включает CORS, r.ok может быть false — это не критично.
  } catch (e) {
    // Фоллбек: "огнеупорная" отправка без CORS-проверки
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } catch {}
  }
}

/**
 * Guide: завершить тикет после успешного тест-драйва
 * - tickets.status -> 'done', completed_at = now
 * - job_extra.test_drive -> 'done'
 */
async function guideCompleteTicket(ticketId) {
  const { error } = await supabase
    .from('tickets')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', ticketId);

  if (error) {
    console.error(error);
    notify('Failed to close ticket', 'error');
    return;
  }

  // обновим пометку тест-драйва у job_extra (если есть строка)
  await supabase.from('job_extra').update({ test_drive: 'done' }).eq('ticket_id', ticketId);

  // 🔔 вебхук: тест пройден
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    // получаем данные тикета для buggy_id
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('buggy_id, description, priority')
      .eq('id', ticketId)
      .single();

    // достанем номер багги
    let buggyNumber = null;
    if (ticketData?.buggy_id) {
      const { data: buggyData } = await supabase
        .from('buggies')
        .select('number')
        .eq('id', ticketData.buggy_id)
        .single();
      buggyNumber = buggyData?.number || null;
    }

    // попытаемся получить имя гида
    let guideName = user?.user_metadata?.name || user?.email || 'Unknown';
    try {
      const { data: g } = await supabase
        .from('guides')
        .select('name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (g?.name) guideName = g.name;
    } catch {}

    await sendMakeWebhook({
      event: 'test_passed',
      ticket_id: ticketId,
      buggy_id: ticketData?.buggy_id ?? null,
      buggy_number: buggyNumber,
      actor_role: 'guide',
      actor_id: user?.id ?? null,
      actor_name: guideName,
      created_at_iso: new Date().toISOString(),
      tz_offset_minutes: new Date().getTimezoneOffset() * -1,
      page: location.pathname,
    });
  } catch (e) {
    // вебхук не должен ломать основной функционал
    console.warn('[webhook] test_passed failed:', e);
  }

  notify('Ticket closed ✅', 'success');
  loadMyOpenTickets(); // перерисовать список
}

/**
 * Guide: отправить на доработку (требуется ещё ремонт)
 * - tickets.status -> 'open' (механики увидят как новый/повторный)
 * - job_extra.test_drive -> 'rework'
 */
async function guideSendBackForRework(ticketId) {
  const { error } = await supabase
    .from('tickets')
    .update({ status: 'open' })
    .eq('id', ticketId);

  if (error) {
    console.error(error);
    notify('Failed to send back for rework', 'error');
    return;
  }

  await supabase.from('job_extra').update({ test_drive: 'rework' }).eq('ticket_id', ticketId);

  // 🔔 вебхук: возвращено на доработку
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    // получаем данные тикета для buggy_id
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('buggy_id, description, priority')
      .eq('id', ticketId)
      .single();

    // достанем номер багги
    let buggyNumber = null;
    if (ticketData?.buggy_id) {
      const { data: buggyData } = await supabase
        .from('buggies')
        .select('number')
        .eq('id', ticketData.buggy_id)
        .single();
      buggyNumber = buggyData?.number || null;
    }

    // попытаемся получить имя гида
    let guideName = user?.user_metadata?.name || user?.email || 'Unknown';
    try {
      const { data: g } = await supabase
        .from('guides')
        .select('name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (g?.name) guideName = g.name;
    } catch {}

    await sendMakeWebhook({
      event: 'ticket_returned',
      ticket_id: ticketId,
      buggy_id: ticketData?.buggy_id ?? null,
      buggy_number: buggyNumber,
      actor_role: 'guide',
      actor_id: user?.id ?? null,
      actor_name: guideName,
      created_at_iso: new Date().toISOString(),
      tz_offset_minutes: new Date().getTimezoneOffset() * -1,
      page: location.pathname,
    });
  } catch (e) {
    // вебхук не должен ломать основной функционал
    console.warn('[webhook] ticket_returned failed:', e);
  }

  notify('Sent back for rework ↩', 'warning');
  loadMyOpenTickets();
}

function setTopbarRoleAndName(role) {
  const roleTitle = document.getElementById('roleTitle');
  const badge = document.getElementById('userNameBadge');
  if (roleTitle) roleTitle.textContent = role === 'guide' ? 'Guide' : 'Mechanic';

  const cached = localStorage.getItem('userName');
  if (badge) badge.textContent = cached || '';
}

async function initTopBarName() {
  const badge = document.getElementById('userNameBadge');
  if (!badge) return;

  let name = localStorage.getItem('userName');
  const slug = localStorage.getItem('userSlug');

  if (!name && slug) {
    // fallback — тянем имя из БД
    const { data, error } = await supabase
      .from('guides')
      .select('name')
      .eq('slug', slug)
      .single();
    if (!error && data?.name) {
      name = data.name;
      localStorage.setItem('userName', name);
    }
  }
  badge.textContent = name || '';
}

async function init() {
  // Импортируем функцию проверки аутентификации
  const { checkAuth, setupAuthListener } = await import('./auth-check.js');
  
  // Проверяем аутентификацию
  const { user, isAuthenticated } = await checkAuth('guide', './guide-login.html');
  
  if (!isAuthenticated) {
    return; // Редирект уже произошел в checkAuth
  }
  
  // Настраиваем слушатель изменений аутентификации
  setupAuthListener((event, session) => {
    if (event === 'SIGNED_OUT') {
      window.location.href = './guide-login.html';
    }
  });

  // Антикэш: ждем пользователя и загружаем свежие данные
  async function waitUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return user;
    return new Promise((resolve) => {
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        if (session?.user) { sub.subscription.unsubscribe(); resolve(session.user); }
      });
      setTimeout(() => { sub.subscription.unsubscribe(); resolve(null); }, 1500);
    });
  }

  await waitUser();
  
  // Устанавливаем роль и имя пользователя
  const role = localStorage.getItem('role') || 'guide';
  const roleTitle = document.getElementById('roleTitle');
  if (roleTitle) roleTitle.textContent = (role === 'guide' ? 'Guide' : 'Mechanic');

  const userNameElement = document.getElementById('userNameBadge');
  let name = localStorage.getItem('userName') || '';
  if (!name) {
    const slug = localStorage.getItem('userSlug');
    if (slug) {
      // fallback: тянем из БД
      const tbl = role === 'guide' ? 'guides' : 'mechanics';
      const { data } = await supabase.from(tbl).select('name').eq('slug', slug).single();
      if (data?.name) {
        name = data.name;
        localStorage.setItem('userName', name);
      }
    }
  }
  if (userNameElement) userNameElement.textContent = name || '—';
  
  document.getElementById('logoutBtn').onclick = doLogout;

  await loadBuggies();
  await loadMyOpenTickets();
  await renderRecentHours();
  initTimeDropdown();
  setDefaultDateToToday();

  document.getElementById('saveHours').onclick = saveHours;

  document.getElementById('createTicket').onclick = createTicket;

  // Инициализация Quick Job Card UI
  await initJobCardUI();
  
  // Делегированный обработчик для кнопок управления тикетами
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action][data-id]');
    if (!btn) return;

    const action = btn.dataset.action;       // 'test_passed' | 'send_back'
    const ticketId = btn.dataset.id;

    // визуальный фидбек
    btn.disabled = true;
    const prevText = btn.innerHTML;
    btn.innerHTML = 'Please wait…';

    try {
      if (action === 'test_passed') {
        await guideCompleteTicket(ticketId);
      } else if (action === 'send_back') {
        await guideSendBackForRework(ticketId);
      }
      await loadMyOpenTickets(); // обновляем список тикетов
    } catch (err) {
      console.error(err);
      alert('Failed to update ticket, please try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = prevText;
    }
  });
}

async function doLogout() {
  try {
    console.log("Starting logout process...");
    
    // Импортируем функцию безопасного выхода
    const { signOut } = await import('./auth-check.js');
    
    // Выполняем безопасный выход
    await signOut();
  } catch (error) {
    console.error("Logout error:", error);
    // В случае ошибки всё равно очищаем данные и редиректим
    localStorage.clear();
    window.location.replace('./index.html');
  }
}

function initTimeDropdown() {
  const sel = document.getElementById('hoursTime');
  const options = [];
  for (let h = 6; h <= 20; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      options.push(`${hh}:${mm}`);
    }
  }
  sel.innerHTML = options.map(t => `<option value="${t}">${t}</option>`).join('');
  // выбрать ближайшие 30 минут
  const now = new Date();
  const rounded = now.getMinutes() < 30 ? '00' : '30';
  const hh = String(now.getHours()).padStart(2, '0');
  const nearest = `${hh}:${rounded}`;
  if ([...sel.options].some(o => o.value === nearest)) sel.value = nearest;
}

function setDefaultDateToToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  document.getElementById('hoursDate').value = `${yyyy}-${mm}-${dd}`;
}

async function loadBuggies() {
  const buggies = await listBuggies();
  
  ['hoursBuggy','ctBuggy'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    // Полностью очищаем селект
    el.innerHTML = '';
    
    // Добавляем плейсхолдер
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Select buggy';
    ph.disabled = true;
    ph.selected = true;
    el.appendChild(ph);
    
    // Добавляем реальные багги
    buggies.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id ?? b.value ?? b.uuid ?? b.number;
      opt.textContent = b.number ?? b.label ?? b.name ?? `#${b.id}`;
      el.appendChild(opt);
    });
  });
}

async function loadMyOpenTickets() {
  const tickets = await listMyOpenTickets();
  
  // список внизу
  const list = document.getElementById('myTickets');
  
  list.innerHTML = tickets.length
    ? tickets.map(t => {
        return `
          <div class="border rounded-lg px-3 py-2 flex items-center justify-between">
            <div>
              <div class="font-bold text-lg text-slate-800 mb-1">Buggy #${t.buggy_number || t.buggy_id || '—'}</div>
              <div class="font-medium text-slate-700 mb-2">${t.description || '(no description)'}</div>
              <div class="text-slate-500 text-xs">${new Date(t.created_at).toLocaleString()}</div>
              <div class="ticket-testdrive" data-testdrive-text>Test drive: no need</div>
              
              ${t.test_drive === 'requested' ? `
                <div class="mt-3 flex gap-2">
                  <button
                    class="btn btn-success px-3 py-2 text-sm"
                    data-action="test_passed"
                    data-id="${t.id}"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
                      <path d="M20 6 9 17l-5-5"/>
                    </svg>
                    Test passed
                  </button>

                  <button
                    class="btn btn-warning px-3 py-2 text-sm"
                    data-action="send_back"
                    data-id="${t.id}"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
                      <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>
                    </svg>
                    Send back
                  </button>
                </div>
              ` : ``}
            </div>
            <div class="text-slate-600 text-xs uppercase">${prettyStatus(t.status)}</div>
          </div>
        `;
      }).join('')
    : `<div class="text-slate-400">No active tickets</div>`;
  
  // Обновляем текст тест-драйва для каждого тикета
  if (tickets.length > 0) {
    const cards = list.querySelectorAll('.border.rounded-lg');
    tickets.forEach((ticket, index) => {
      const card = cards[index];
      if (card) {
        const td = (ticket.test_drive || '').toLowerCase();
        let tdText = 'no need';
        if (td === 'requested') tdText = 'requested';
        else if (td === 'done') tdText = 'done';
        
        const tdElement = card.querySelector('[data-testdrive-text]');
        if (tdElement) {
          tdElement.textContent = `Test drive: ${tdText}`;
        }
      }
    });
  }
}

async function saveHours() {
  const buggySel = document.getElementById('hoursBuggy');
  const buggy_id = buggySel.value;
  const hoursVal = document.getElementById('hoursVal').value;
  const dateStr  = document.getElementById('hoursDate').value; // YYYY-MM-DD
  const timeStr  = document.getElementById('hoursTime').value; // HH:mm

  if (!buggy_id) {
    toast('Please select buggy');
    buggySel.focus();
    return;
  }
  if (!hoursVal) { toast('Enter hours'); return; }

  let reading_at = new Date().toISOString();
  if (dateStr && timeStr) {
    const dt = new Date(`${dateStr}T${timeStr}:00`);
    if (!isNaN(dt)) reading_at = dt.toISOString();
  }

  // Получаем текущего пользователя и его имя
  const { data: { user } } = await supabase.auth.getUser();
  
  const guideName =
    user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'Guide'; // запасной вариант

  // Вставляем с guide_name
  const { error } = await supabase
    .from('buggy_hours_logs')
    .insert([{
      buggy_id,
      reading_at,    // дата/время тура
      hours: Number(hoursVal),         // часы
      guide_name: guideName // <- NEW
    }]);

  if (error) throw error;

  document.getElementById('hoursVal').value = '';
  setDefaultDateToToday();
  initTimeDropdown();

  toast('Hours saved', 'success');
  await renderRecentHours();
}

async function renderRecentHours() {
  const recent = await listMyRecentHours(5);
  const el = document.getElementById('recentHours');
  if (!recent.length) { el.innerHTML = `<div class="text-slate-400">No recent hours</div>`; return; }
  
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
  
  el.innerHTML = `
    <div class="mt-2 text-slate-700">Recent:</div>
    <ul class="mt-1 space-y-1">
      ${recent.map(h => `
        <li class="text-slate-600 text-sm">
          ${formatDate(h.reading_at)} • #${h.buggy_number ?? '—'} • ${h.hours} h
        </li>
      `).join('')}
    </ul>
  `;
}



async function createTicket() {
  const buggy_id = document.getElementById('ctBuggy').value;
  const priority = document.getElementById('ctPriority').value;
  const description = document.getElementById('ctDesc').value.trim();
  if (!buggy_id || !description) { notify('Buggy and description required', 'error'); return; }
  
  const data = await createTicketSimple({ buggy_id, description, priority });
  
  // ===> ДОБАВЛЯЕМ вызов вебхука (не блокирует пользователя)
  try {
    // Получаем пользователя для вебхука
    const { data: { user } } = await supabase.auth.getUser();

    // достанем номер багги из селекта, чтобы не делать доп. запрос
    const buggySel = document.getElementById('ctBuggy'); // id твоего селекта
    const buggyNumber = buggySel?.options[buggySel.selectedIndex]?.text?.trim() ?? '';

    // попытаемся получить имя гида (если ведёшь таблицу guides)
    let guideName = user?.user_metadata?.name || user?.email || 'Unknown';
    try {
      const { data: g } = await supabase
        .from('guides')
        .select('name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (g?.name) guideName = g.name;
    } catch {}

    // локальное «человеческое» время (для глаз в Make)
    const localIso = new Date().toISOString();
    const localStr = new Date().toLocaleString();

    await sendMakeWebhook({
      event: 'ticket_created',
      ticket_id: data.id,
      buggy_id: buggy_id,
      buggy_number: buggyNumber,
      priority: priority,
      description: description,
      guide_id: user?.id ?? null,
      guide_name: guideName,
      guide_email: user?.email ?? null,
      created_at_iso: localIso,         // ISO (UTC)
      created_at_local: localStr,       // локально от браузера
      tz_offset_minutes: new Date().getTimezoneOffset() * -1,
      page: location.pathname,
    });
  } catch { /* webhook не влияет на UX */ }
  
  document.getElementById('ctDesc').value = '';
  notify('Ticket created','success');
  await loadMyOpenTickets();
}

// ---- Quick Job Card (UI only) ----
async function initJobCardUI() {
  // 2.1. Проставим сегодняшнюю дату
  const d = document.getElementById('jc-date');
  if (d) {
    const today = new Date();
    d.value = today.toISOString().slice(0,10);
  }

  // 2.2. Заполним time слоты с шагом 30 минут (06:00 - 20:00)
  const t = document.getElementById('jc-time');
  if (t) {
    t.innerHTML = '';
    const start = 6 * 60;   // 06:00
    const end   = 20 * 60;  // 20:00
    for (let m = start; m <= end; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2,'0');
      const mm = String(m % 60).padStart(2,'0');
      const opt = document.createElement('option');
      opt.value = `${hh}:${mm}`;
      opt.textContent = `${hh}:${mm}`;
      t.appendChild(opt);
    }
  }

  // 2.3. Подтянем список багги (используем ту же логику, что и в "Log hours")
  await populateJobCardBuggies();

  // 2.4. Лёгкая валидация и включение кнопки
  const fields = ['jc-buggy','jc-date','jc-time','jc-location','jc-hours','jc-km']
    .map(id => document.getElementById(id));

  const saveBtn = document.getElementById('jc-save');
  const hint = document.getElementById('jc-hint');
  const validate = () => {
    const ok = fields.every(el => el && String(el.value).trim() !== '');
    if (saveBtn) saveBtn.disabled = !ok;
  };
  fields.forEach(el => el && el.addEventListener('input', validate));
  validate();

// ---------- Job card: safe save handler (guarded) ----------
// Берём кнопку и защищаемся, чтобы скрипт не падал
      const jcSaveBtn = document.getElementById('jc-save');
      if (jcSaveBtn) {
        jcSaveBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            const issueVal = document.getElementById('jc-issue')?.value?.trim() || '';
            const buggy_id = document.getElementById('jc-buggy')?.value || '';
            const date     = document.getElementById('jc-date')?.value || '';
            const time     = document.getElementById('jc-time')?.value || '';
            const location = document.getElementById('jc-location')?.value || '';
            const hours    = Number(document.getElementById('jc-hours')?.value || 0);
            const km       = Number(document.getElementById('jc-km')?.value || 0);

      if (!buggy_id || !date || !time || !location || !Number.isFinite(hours) || !Number.isFinite(km)) {
        jcToast('Please fill all fields correctly', 'warn');
        return;
      }

      // date+time -> ISO (UTC)
      const dtLocal = new Date(`${date}T${time}:00`);
      const reported_at = new Date(dtLocal.getTime() - dtLocal.getTimezoneOffset() * 60000).toISOString();

      // текущий пользователь
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        jcToast('Auth required', 'error'); 
        return;
      }
      const user = userData.user;

      // имя гида (если нет в guides — берём префикс email)
      let guide_name = (user.email || '').split('@')[0];
      try {
        const { data: g1, error: gerr } = await supabase
          .from('guides')
          .select('name')
          .eq('user_id', user.id)
          .single(); // совместимо везде
        if (!gerr && g1?.name) guide_name = g1.name;
      } catch (_) {}

      const row = {
        buggy_id,
        reported_at,
        hours: Math.max(0, Math.floor(hours)),
        km:    Math.max(0, Math.floor(km)),
        location,
        created_by: user.id,
        guide_name
      };
      if (issueVal) row.issue = issueVal.slice(0, 200); // ограничим длину на всякий случай

      jcSaveBtn.disabled = true;
      const { data, error } = await supabase
        .from('job_cards')
        .insert(row)
        .select()
        .single();
      if (error) throw error;

      console.log('[jobcard] saved:', data);
      jcToast('Job card saved', 'ok');

      // очистим числовые поля
      const hEl = document.getElementById('jc-hours'); if (hEl) hEl.value = '';
      const kEl = document.getElementById('jc-km');    if (kEl) kEl.value = '';
      const iEl = document.getElementById('jc-issue'); if (iEl) iEl.value = '';
    } catch (err) {
      console.error('[jobcard] insert error:', err);
      jcToast(err?.message || 'Failed to save', 'error');
    } finally {
      jcSaveBtn.disabled = false;
      const hint = document.getElementById('jc-hint');
      if (hint) hint.classList.add('hidden');
    }
  });
}

// Мини-тост с уникальным именем (чтобы не конфликтовать с существующим)
function jcToast(msg, type='info') {
  const el = document.createElement('div');
  el.textContent = msg;
  const base = 'fixed z-[9999] left-1/2 -translate-x-1/2 top-4 px-4 py-2 rounded-xl shadow text-white';
  const color = type === 'ok' ? 'bg-emerald-500' :
                type === 'warn' ? 'bg-amber-500' :
                type === 'error' ? 'bg-red-500' : 'bg-neutral-700';
  el.className = `${base} ${color}`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 1800);
  setTimeout(() => el.remove(), 2200);
}
// ---------- /Job card ----------
}

async function populateJobCardBuggies() {
  const sel = document.getElementById('jc-buggy');
  if (!sel) return;

  // Пытаемся переиспользовать кэш, если он уже собирался для "Log hours"
  const cached = window._buggiesCache;
  let rows = Array.isArray(cached) ? cached : null;

  try {
    if (!rows) {
      // fallback: читаем из public.buggies
      const { data, error } = await supabase
        .from('buggies')
        .select('id, number')
        .order('number', { ascending:1 });
      if (error) throw error;
      rows = data || [];
      window._buggiesCache = rows;
    }

    // очистим и перезаполним
    sel.innerHTML = '<option value="">Select buggy…</option>';
    for (const b of rows) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.number;
      sel.appendChild(opt);
    }
  } catch (e) {
    console.warn('[jobcard] failed to load buggies:', e);
    sel.innerHTML = '<option value="">(failed to load)</option>';
  }
}



init();
