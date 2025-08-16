import {
  getSession, onAuthChange, login, logout,
  listTickets, listOpenTickets, createTicketSimple, listBuggies, updateTicket,
  updateTicketFields, assignToMe, setStarted, setDone,
  addWorklog, listWorklogs, subscribeTickets
} from "./api.js";
import { supabase } from "./supabase.js";

// ⚠️ Ничего не менять здесь, кроме URL при необходимости
async function sendMakeWebhook(payload) {
  const url = 'https://hook.eu2.make.com/yd5t7uksm2f28kub3dj0da0t9m2iigty';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) { /* fallback … */ }
}

// DEV: дать доступ из консоли (на проде можно убрать)
if (typeof window !== 'undefined') window.sendMakeWebhook = sendMakeWebhook;

// ---- notify shim (safe) ----
if (typeof window.notify !== 'function') {
  window.notify = function notifyShim(message, type = 'info') {
    // simple toast
    const box = document.createElement('div');
    box.textContent = message;
    box.style.cssText = `
      position: fixed; right: 16px; bottom: 16px;
      background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#16a34a' : '#111'};
      color: #fff; padding: 10px 14px; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.2); z-index: 9999; opacity: .96;
      font: 14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    `;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1800);
  };
}
// ---- end shim ----

// --- Tiny toast helper (once) ---
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

window.notify = (message, type = 'info') => {
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
};

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
    const { data, error } = await supabase
      .from('mechanics')
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

// UI refs
const logoutBtn       = document.getElementById("logoutBtn");
const addTicketBtn    = document.getElementById("addTicketBtn");
const statusFilter    = document.getElementById("filterStatus");
const priorityFilter  = document.getElementById("filterPriority");
const refreshBtn      = document.getElementById("refreshBtn");
const cards           = document.getElementById("cards");

// Modal
const modal      = document.getElementById("ticketModal");
const m_buggy    = document.getElementById("m_buggy");
const m_priority = document.getElementById("m_priority");
const m_desc     = document.getElementById("m_desc");
const m_cancel   = document.getElementById("m_cancel");
const m_save     = document.getElementById("m_save");

// Креды общего аккаунта
const MECHANIC_EMAIL = "mechanics@bigred.local";
const MECHANIC_PASSWORD = "110590";

let offTickets = null;

// pagination & filters
let page = 0;
const pageSize = 25;
let currentStatus = 'all';
let currentPriority = 'all';
let onlyMy = false;
let myId = null;
let ticketsCache = [];

// ---- Helpers for ticket actions ----
async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

async function fetchTicketById(ticketId) {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();
  if (error) throw error;
  return data;
}

async function refreshTickets() {
  await fetchTickets(true);
}

// Assign to me — только назначение, статус не меняется
async function handleAssign(ticketId) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No user');
  const t = await fetchTicketById(ticketId);
  if (t.assignee) { await refreshTickets(); return; }
  await updateTicket(ticketId, { assignee: userId });
  showToast('Assigned', 'success');
  
  // Обновляем состояние кнопок в текущей карточке
  const cardEl = document.querySelector(`[data-id="${ticketId}"]`);
  if (cardEl) {
    const updatedTicket = { ...t, assignee: userId };
    applyButtonState(cardEl, updatedTicket, userId);
  }
  
  await refreshTickets();
}

// Start: из open → auto-assign если пусто, started_at=now, status=in_progress
async function handleStart(ticketId) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No user');
  const t = await fetchTicketById(ticketId);
  if (t.status === 'done') { showToast('Already done', 'info'); return; }
  const patch = {
    status: 'in_progress',
    started_at: t.started_at || new Date().toISOString(),
  };
  if (!t.assignee) patch.assignee = userId;
  await updateTicket(ticketId, patch);
  showToast('Started', 'success');
  
  // Обновляем состояние кнопок в текущей карточке
  const cardEl = document.querySelector(`[data-id="${ticketId}"]`);
  if (cardEl) {
    const updatedTicket = { ...t, ...patch };
    applyButtonState(cardEl, updatedTicket, userId);
    
    // Дополнительно обновляем состояние кнопки Save odometer
    const saveOdoBtn = cardEl.querySelector('[data-role="save-odo"]');
    if (saveOdoBtn) {
      if (patch.status === 'in_progress') {
        saveOdoBtn.disabled = false;
        saveOdoBtn.classList.remove('disabled');
      }
    }
  }
  
  await refreshTickets();
}

// Done: доступно из in_progress и из open (быстрое закрытие)
async function handleDone(ticketId) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No user');
  const t = await fetchTicketById(ticketId);
  if (t.status === 'done') { showToast('Already done', 'info'); return; }
  const patch = {
    status: 'done',
    completed_at: new Date().toISOString(),
  };
  if (t.status === 'open') {
    if (!t.assignee) patch.assignee = userId;
    if (!t.started_at) patch.started_at = new Date().toISOString();
  }
  await updateTicket(ticketId, patch);

  // 🔔 вебхук: тикет закрыт механиком
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    // достанем номер багги
    let buggyNumber = null;
    if (t.buggy_id) {
      const { data: buggyData } = await supabase
        .from('buggies')
        .select('number')
        .eq('id', t.buggy_id)
        .single();
      buggyNumber = buggyData?.number || null;
    }

    // попытаемся получить имя механика
    let mechName = user?.user_metadata?.name || user?.email || 'Unknown';
    try {
      const { data: m } = await supabase
        .from('mechanics')
        .select('name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (m?.name) mechName = m.name;
    } catch {}

    await sendMakeWebhook({
      event: 'ticket_done',
      ticket_id: ticketId,
      buggy_id: t.buggy_id ?? null,
      buggy_number: buggyNumber,
      actor_role: 'mechanic',
      actor_id: user?.id ?? null,
      actor_name: mechName,
      created_at_iso: new Date().toISOString(),
      tz_offset_minutes: new Date().getTimezoneOffset() * -1,
      page: location.pathname,
    });
  } catch (e) {
    // вебхук не должен ломать основной функционал
    console.warn('[webhook] ticket_done failed:', e);
  }

  showToast('Completed', 'success');
  
  // Обновляем состояние кнопок в текущей карточке
  const cardEl = document.querySelector(`[data-id="${ticketId}"]`);
  if (cardEl) {
    const updatedTicket = { ...t, ...patch };
    applyButtonState(cardEl, updatedTicket, userId);
    
    // Дополнительно обновляем состояние кнопки Save odometer
    const saveOdoBtn = cardEl.querySelector('[data-role="save-odo"]');
    if (saveOdoBtn) {
      if (patch.status === 'done') {
        saveOdoBtn.disabled = true;
        saveOdoBtn.classList.add('disabled');
      }
    }
  }
  
  await refreshTickets();
}

async function fetchTickets(reset = true) {
  if (reset) { 
    page = 0; 
    ticketsCache = [];
    // Показываем загрузку вместо "No tickets found"
    if (cards) cards.innerHTML = '<div class="text-center text-slate-500 py-8">Loading tickets...</div>';
  }
  const assignee = (onlyMy && myId) ? myId : null;
  const data = await listTickets({
    status: currentStatus,
    priority: currentPriority,
    assignee,
    limit: pageSize,
    offset: page * pageSize,
  });
  ticketsCache = reset ? data : ticketsCache.concat(data);
  renderTickets(ticketsCache);
}

const toastWrap = document.getElementById("toastWrap");
function showToast(msg, type = "info") {
  if (!toastWrap) return;
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function norm(x){ return String(x || "").toLowerCase(); }

function styleBase() {
  const sf = document.getElementById("filterStatus");
  const pf = document.getElementById("filterPriority");
  const logoutBtn = document.getElementById("logout-btn");

  // Убираем переопределение стилей logout кнопки, так как она уже стилизована в CSS
  // Убираем переопределение стилей select, так как они уже стилизованы в CSS
}

// Жёсткий ресет блокировки скролла при загрузке страницы
function hardResetScrollLock() {
  const b = document.body;

  // cнимаем инлайновые блокировки
  b.style.position = '';
  b.style.top = '';
  b.style.left = '';
  b.style.right = '';
  b.style.width = '';
  b.style.overflow = '';
  b.style.touchAction = '';

  // возвращаем прокрутку в сохранённую позицию, если была
  if (b.dataset.scrollY) {
    const y = parseInt(b.dataset.scrollY || '0', 10);
    b.removeAttribute('data-scroll-y');
    window.scrollTo(0, y);
  }

  // удаляем фон модалки, если вдруг остался
  document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());

  // скрываем модалку, если осталась видимой
  const modal = document.getElementById('ticketModal');
  if (modal) {
    modal.setAttribute('hidden', 'hidden');
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('show');
  }
}

// Безопасная блокировка скролла (iOS-friendly)
function lockScroll() {
  const y = window.scrollY || window.pageYOffset;
  document.body.dataset.scrollY = String(y);
  document.body.style.position = 'fixed';
  document.body.style.top = `-${y}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}

function unlockScroll() {
  const y = parseInt(document.body.dataset.scrollY || '0', 10);
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.removeAttribute('data-scroll-y');
  window.scrollTo(0, y);
}

function openCreateTicketModal() {
  const modal = document.getElementById('ticketModal');
  if (!modal) return;

  // фон (удаляем старые на всякий случай)
  document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', () => closeModalById('ticketModal'));

  // перенести модалку в body (чтобы не мешали stacking contexts)
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  modal.removeAttribute('hidden');
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('show');

  // блокируем скролл только сейчас
  lockScroll();
}

// Универсальная закрывалка по id
function closeModalById(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.setAttribute('hidden', 'hidden');
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('show');

  // убрать backdrop(ы)
  document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());

  // разблокировать скролл
  unlockScroll();
}

function closeCreateTicketModal() {
  closeModalById('ticketModal');
}

function showModal()  { openCreateTicketModal(); }
function hideModal()  { closeCreateTicketModal(); }

async function loadBuggiesIntoModal() {
  if (!m_buggy) return;
  const items = await listBuggies();
  m_buggy.innerHTML =
    '<option value="">— No buggy —</option>' +
    (items || []).map(b => `<option value="${b.id}">${b.number}</option>`).join("");
}

// ---- SINGLE source of truth: renderTickets ----
async function renderTickets(tickets = null) {
  if (!cards) return;

  // Use passed tickets or fetch them
  if (!tickets) {
    try {
      tickets = await listOpenTickets();
    } catch (e) {
      console.error("Load tickets error:", e);
      cards.innerHTML = `<div class="text-center text-red-600 py-8">${e.message}</div>`;
      return;
    }

    // 2) считаем открытыми: open + in_progress
    const OPEN = new Set(["open","in_progress"]);
    const norm = (x) => String(x || "").toLowerCase();
    tickets = (tickets || []).filter(t => OPEN.has(norm(t.status)));

    // 3) применяем фильтры
    const sf = statusFilter ? norm(statusFilter.value) : "all";
    const pf = priorityFilter ? norm(priorityFilter.value) : "all";
    if (sf !== "all") tickets = tickets.filter(t => norm(t.status) === sf);
    if (pf !== "all") tickets = tickets.filter(t => norm(t.priority) === pf);
  }

  // 4) подтянем список багги один раз и сделаем map id->number
  let buggyMap = new Map();
  try {
    const buggies = await listBuggies();
    buggyMap = new Map((buggies || []).map(b => [b.id, b.number]));
  } catch (_) {}

  // 4.1) подтянем карту user_id -> mechanic name
  let assigneeNameByUserId = new Map();
  try {
    const { data } = await supabase
      .from('mechanics')
      .select('user_id, name')
      .not('user_id', 'is', null);
    (data || []).forEach(row => {
      if (row.user_id) assigneeNameByUserId.set(row.user_id, row.name);
    });
  } catch (_) {}

  // 4.2) подтянем карту user_id -> creator name (механики + гиды)
  let creatorNameByUserId = new Map();
  try {
    // Механики
    const { data: mechanics } = await supabase
      .from('mechanics')
      .select('user_id, name')
      .not('user_id', 'is', null);
    (mechanics || []).forEach(row => {
      if (row.user_id) creatorNameByUserId.set(row.user_id, row.name);
    });
    
    // Гиды
    const { data: guides } = await supabase
      .from('guides')
      .select('user_id, name')
      .not('user_id', 'is', null);
    (guides || []).forEach(row => {
      if (row.user_id) creatorNameByUserId.set(row.user_id, row.name);
    });
  } catch (_) {}

  if (!tickets.length) {
    cards.innerHTML = `<div class="text-center text-slate-500 py-8">No tickets found</div>`;
    return;
  }

  // 5) рендер карточек — description выше, кнопки в ряд, багги = number
  cards.innerHTML = tickets.map(t => {
    const id  = t.id;
    const st  = norm(t.status);
    const pri = norm(t.priority);
    const priClass = ['low','medium','high'].includes(pri) ? pri : 'medium';

    const priBorder = pri==='high'
      ? 'border-l-4 border-red-500'
      : pri==='medium'
      ? 'border-l-4 border-amber-500'
      : 'border-l-4 border-emerald-500';

    // Определяем класс бейджа в зависимости от приоритета
    const priBadge =
      pri === 'high'
        ? 'bg-red-500 text-white'
        : pri === 'medium'
        ? 'bg-amber-400 text-white'
        : 'bg-green-500 text-white';

    const priTint =
      pri==='high'   ? 'bg-red-50/50' :
      pri==='medium' ? 'bg-amber-50/40' :
                       'bg-emerald-50/40';

    const buggyNumber = t.buggy_id ? (buggyMap.get(t.buggy_id) || '') : '';

    return `
      <div class="card ticket-card prio-${priClass}" data-id="${id}" data-ticket-id="${id}" data-priority="${pri}">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <div class="text-slate-700 text-[0.95rem] uppercase tracking-wide font-semibold mb-1">Buggy</div>
            <div class="font-semibold text-slate-800 text-lg truncate">${buggyNumber || '—'}</div>
          </div>
          <span class="${priBadge} text-sm sm:text-base font-bold px-3 py-1 rounded-full shadow-sm ring-1 ring-black/5">
            ${pri}
          </span>
        </div>

        <div class="grid sm:grid-cols-2 gap-6">
          <div>
            <div class="text-slate-700 text-[0.95rem] uppercase tracking-wide font-semibold mb-1">Description</div>
            <div class="text-slate-800 mb-3">${t.description ?? ''}</div>
            
            <div class="text-slate-600 text-xs mb-3">
              Created by: <span class="font-medium">${t.created_by ? (creatorNameByUserId.get(t.created_by) || 'Unknown') : 'Unknown'}</span> • 
              <span class="text-slate-500">${new Date(t.created_at).toLocaleString()}</span>
            </div>

            <div class="flex items-center justify-start gap-2 mb-3">
              <div class="text-slate-700 text-[0.95rem] uppercase tracking-wide font-semibold">Status</div>
              <span class="px-3 py-1 rounded-full text-sm font-semibold ring-1 ring-black/5 select-none ${
                st==='done' ? 'bg-green-100 text-green-800' :
                st==='in_progress' ? 'bg-blue-100 text-blue-800' :
                'bg-slate-100 text-slate-800'
              }">${st}</span>
            </div>
            <div class="flex justify-center gap-4 mt-2">
              <button type="button" class="btn btn-primary" data-action="start">Start</button>
              <button type="button" class="btn btn-success" data-action="done">Done</button>
              <button
                class="btn btn-secondary mech-testdrive"
                data-action="request-testdrive"
                data-ticket-id="${t.id}">
                Request test drive
              </button>
            </div>
          </div>

          <div>
            <div class="text-slate-600 text-sm uppercase tracking-wide font-medium mb-1">Priority</div>
            <select class="t-priority tw-select border rounded-lg px-3 py-2 min-w-[160px] focus:outline-none focus:ring-2 focus:ring-slate-300">
              <option value="low" ${pri==='low'?'selected':''}>low</option>
              <option value="medium" ${pri==='medium'?'selected':''}>medium</option>
              <option value="high" ${pri==='high'?'selected':''}>high</option>
            </select>

            <div class="mt-4 flex items-center justify-between gap-3">
              <div>
                <div class="text-slate-600 text-sm uppercase tracking-wide font-medium">Assignee</div>
                <div class="assignee-line text-slate-800 text-sm mt-0.5">${t.assignee ? (assigneeNameByUserId.get(t.assignee) || t.assignee) : '—'}</div>
              </div>
              <button type="button" class="btn btn-secondary" data-action="assign">Assign to me</button>
            </div>

            <div class="grid grid-cols-2 gap-3 mt-4">
              <div>
                <div class="text-slate-600 text-sm uppercase tracking-wide font-medium mb-1">Hours (odo)</div>
                <input type="number" min="0" step="1" class="hours-in border rounded-lg px-3 py-2 w-full" value="${t.hours_in ?? ''}" placeholder="e.g. 128" data-role="odometer"/>
              </div>
              <div>
                <div class="text-slate-600 text-sm uppercase tracking-wide font-medium mb-1">KM</div>
                <input type="number" min="0" step="1" class="hours-out border rounded-lg px-3 py-2 w-full" value="${t.hours_out ?? ''}" placeholder="e.g. 3500" data-role="km"/>
              </div>
            </div>
            <div class="flex gap-2 mt-2">
              <button type="button" class="btn btn-primary px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border text-sm text-[#475569]" data-role="save-odo">Save odometer</button>
            </div>

            <div class="grid grid-cols-2 gap-3 mt-4">
              <div>
                <div class="text-slate-600 text-xs uppercase tracking-wide font-medium">Started</div>
                <div class="text-slate-800 text-sm">${t.started_at ? new Date(t.started_at).toLocaleString() : '—'}</div>
              </div>
              <div>
                <div class="text-slate-600 text-xs uppercase tracking-wide font-medium">Completed</div>
                <div class="text-slate-800 text-sm">${t.completed_at ? new Date(t.completed_at).toLocaleString() : '—'}</div>
              </div>
            </div>

            <div class="mt-5">
              <div class="text-slate-600 text-sm uppercase tracking-wide font-medium mb-1">Worklog</div>
              <div class="flex flex-col gap-2">
                <input class="wl-note border rounded-lg px-3 py-2" placeholder="what was done"/>
                <button class="btn-add-log px-3 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition text-sm">Add log</button>
              </div>
              <div class="wl-list mt-3 text-sm text-slate-700 space-y-1"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 6) Применяем состояние кнопок по правилам
  const { data: userResp2 } = await supabase.auth.getUser();
  const currentUserId = userResp2?.user?.id || null;
  cards.querySelectorAll('.ticket-card').forEach((cardEl, i) => {
    const ticket = tickets[i];
    applyButtonState(cardEl, ticket, currentUserId);
    
    // Initialize save button state based on input values and ticket status
    const od = cardEl.querySelector('[data-role="odometer"]');
    const km = cardEl.querySelector('[data-role="km"]');
    const saveBtn = cardEl.querySelector('[data-role="save-odo"]');
    if (saveBtn) {
      const hasInputs = od?.value.trim() && km?.value.trim();
      const isDone = ticket.status === 'done';
      
      // Кнопка активна только если есть ввод И статус не "done"
      saveBtn.disabled = !hasInputs || isDone;
      
      // Добавляем CSS класс для визуального отображения
      if (isDone) {
        saveBtn.classList.add('disabled');
      } else {
        saveBtn.classList.remove('disabled');
      }
    }
  });
  
  // 7) Инициализируем состояние кнопок тест-драйва
  await applyTestDriveStatesForMechanic();
}

// Выставление доступности кнопок согласно статусу
function applyButtonState(cardEl, ticket, currentUserId) {
  const btnStart  = cardEl.querySelector('[data-action="start"]');
  const btnDone   = cardEl.querySelector('[data-action="done"]');
  const btnAssign = cardEl.querySelector('[data-action="assign"]');

  const status = String(ticket.status || '').toLowerCase();
  const canAssign = !ticket.assignee && status === 'open';

  if (status === 'open') {
    btnStart?.removeAttribute('disabled');
    btnStart?.classList.remove('disabled');
    btnDone?.removeAttribute('disabled');
    btnDone?.classList.remove('disabled');
    if (btnAssign) {
      btnAssign.disabled = !canAssign;
      if (!canAssign) btnAssign.classList.add('disabled');
      else btnAssign.classList.remove('disabled');
    }
  } else if (status === 'in_progress') {
    btnStart?.setAttribute('disabled','true');
    btnStart?.classList.add('disabled');
    btnDone?.removeAttribute('disabled');
    btnDone?.classList.remove('disabled');
    btnAssign?.setAttribute('disabled','true');
    btnAssign?.classList.add('disabled');
  } else {
    // done
    btnStart?.setAttribute('disabled','true');
    btnStart?.classList.add('disabled');
    btnDone?.setAttribute('disabled','true');
    btnDone?.classList.add('disabled');
    btnAssign?.setAttribute('disabled','true');
    btnAssign?.classList.add('disabled');
  }

  // переназначаем на новый обработчик для кнопки Save hours
  const saveBtn = cardEl.querySelector('.btn-save-hours');
  if (saveBtn) saveBtn.onclick = () => handleSaveOdometerAndKm(ticket);
  
  // Управление активностью кнопки Save odometer
  const saveOdoBtn = cardEl.querySelector('[data-role="save-odo"]');
  if (saveOdoBtn) {
    if (status === 'done') {
      saveOdoBtn.disabled = true;
      saveOdoBtn.classList.add('disabled');
    } else {
      // open или in_progress
      saveOdoBtn.disabled = false;
      saveOdoBtn.classList.remove('disabled');
    }
  }
}

// === helper: toast function ===
function toast(msg, type = 'success') {
  if (typeof notify === 'function') { notify(msg, type); return; }
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    Object.assign(box.style, {
      position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)',
      zIndex: '9999', pointerEvents: 'none'
    });
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  Object.assign(t.style, {
    margin: '6px 0', padding: '10px 14px', borderRadius: '10px',
    background: type === 'error' ? '#fee2e2' : '#dcfce7',
    color: '#111827', boxShadow: '0 4px 12px rgba(0,0,0,.15)', pointerEvents: 'auto',
    transition: 'opacity .3s'
  });
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; }, 1500);
  setTimeout(() => { t.remove(); if (!box.childElementCount) box.remove(); }, 1900);
}

// ---- UI wiring ----
function wireUI() {
  if (logoutBtn) {
    // Защита от множественных кликов
    let isLoggingOut = false;
    logoutBtn.onclick = async () => {
      if (isLoggingOut) return; // Игнорируем повторные клики
      isLoggingOut = true;
      logoutBtn.disabled = true;
      logoutBtn.textContent = 'Logging out...';
      
      try {
        await doLogout();
      } catch (error) {
        console.error('Logout failed:', error);
        // Восстанавливаем кнопку при ошибке
        isLoggingOut = false;
        logoutBtn.disabled = false;
        logoutBtn.textContent = 'Logout';
      }
    };
  }

  // Обработчики фильтров → сохранить значения и перерисовать
  statusFilter?.addEventListener('change', () => {
    currentStatus = String(statusFilter.value || 'all').toLowerCase();
    fetchTickets(true);
  });
  priorityFilter?.addEventListener('change', () => {
    currentPriority = String(priorityFilter.value || 'all').toLowerCase();
    fetchTickets(true);
  });

  if (addTicketBtn) addTicketBtn.onclick = async () => {
    await loadBuggiesIntoModal();
    showModal();
  };

  // Обработчик кнопки Cancel уже добавлен в HTML через onclick
  
  // Делегирование: сработает даже если кнопка создана позже
  document.addEventListener('click', (e) => {
    const cancelBtn = e.target.closest('[data-modal-cancel]');
    if (!cancelBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const modalId = cancelBtn.getAttribute('data-modal-cancel') || 'ticketModal';
    closeModalById(modalId);
  });

  // Делегирование кликов по кнопкам тикетов
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const card = btn.closest('.ticket-card');
    if (!card) return;

    const ticketId = card.dataset.id;
    const action = btn.dataset.action;

    try {
      if (action === 'assign') {
        await handleAssign(ticketId);
      } else if (action === 'start') {
        await handleStart(ticketId);
      } else if (action === 'done') {
        await handleDone(ticketId);
      }
    } catch (err) {
      console.error(err);
      showToast('Action failed', 'error');
    }
  });

  // Делегированный обработчик кнопки Test drive
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="request-testdrive"]');
    if (!btn) return;

    e.preventDefault();

    const ticketId = btn.dataset.ticketId;
    if (!ticketId) {
      notify?.('Ticket id is missing', 'error');
      return;
    }

    try {
      await saveTestDriveRequested(ticketId);

      // оптимистический UI
      btn.disabled = true;
      btn.textContent = 'Test drive requested';
      btn.classList.add('btn-ghost');
      btn.setAttribute('aria-pressed', 'true');

      const badge = btn.closest('.ticket-card')?.querySelector('[data-testdrive-badge]');
      if (badge) {
        badge.textContent = 'Requested';
        badge.className = 'badge badge-warn';
      }

      notify?.('Test drive requested', 'success');
    } catch (err) {
      console.error('[mech] upsert job_extra error:', err);
      notify?.('Failed to request test drive', 'error');
    }
  });

  // === helper: integer parsing with validation ===
  function toInt(val) {
    const n = Number(val);
    return Number.isFinite(n) && Number.isInteger(n) ? n : NaN;
  }

  // === delegated click for "Save odometer" ===
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-role="save-odo"]');
    if (!btn) return;

    const card = btn.closest('[data-ticket-id]');
    if (!card) {
      alert('Ticket container not found');
      return;
    }

    const ticketId = card.dataset.ticketId;
    const odometerEl = card.querySelector('[data-role="odometer"]');
    const kmEl       = card.querySelector('[data-role="km"]');

    if (!ticketId) {
      alert('Ticket id is missing');
      return;
    }
    if (!odometerEl || !kmEl) {
      alert('Inputs for odometer/KM are missing');
      return;
    }

    const hours = toInt(odometerEl.value.trim());
    const km    = toInt(kmEl.value.trim());

    if (!Number.isInteger(hours)) {
      alert('Enter odometer hours (integer).');
      odometerEl.focus();
      return;
    }
    if (!Number.isInteger(km)) {
      alert('Enter KM (integer).');
      kmEl.focus();
      return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Saving…';

    try {
      const { data, error } = await supabase.rpc('mech_save_odometer_km', {
        p_ticket: ticketId,
        p_hours : hours,
        p_km    : km,
      });
      if (error) throw error;

      toast('Saved ✓', 'success');

      // clear inputs and disable button until new values
      odometerEl.value = '';
      kmEl.value = '';
      btn.textContent = original;
      btn.disabled = true;

      // small visual flash on the card (optional)
      card.style.boxShadow = '0 0 0 2px rgba(34,197,94,.5)';
      setTimeout(() => { card.style.boxShadow = ''; }, 500);
    } catch (err) {
      console.error('[mech] save odometer/km error:', err);
      toast(`Save failed: ${err.message || err}`, 'error');
      btn.textContent = original;
    } finally {
      btn.disabled = false ? !(odometerEl.value && kmEl.value) : false;
    }
  });

  // Закрытие по ESC (если модалка видима)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openModal = document.querySelector('.modal[hidden="false"], .modal:not([hidden])');
    if (openModal && openModal.id) closeModalById(openModal.id);
  });

  // Ensure numeric-only filtering and button enable/disable
  document.addEventListener('input', (e) => {
    const card = e.target.closest('[data-ticket-id]');
    if (!card) return;

    const od = card.querySelector('[data-role="odometer"]');
    const km = card.querySelector('[data-role="km"]');
    const btn = card.querySelector('[data-role="save-odo"]');

    if (e.target === od || e.target === km) {
      // digits only
      e.target.value = e.target.value.replace(/\D/g, '');
      // enable only if both have values
      if (btn) btn.disabled = !(od?.value.trim() && km?.value.trim());
    }
  });
  
  // Жёсткий ресет блокировки скролла при загрузке страницы
  document.addEventListener('DOMContentLoaded', hardResetScrollLock);

  // Обработчик клика по backdrop уже добавлен в openCreateTicketModal

  if (m_save) m_save.onclick = async () => {
    try {
      await createTicketSimple({
        buggy_id: m_buggy?.value || null,
        priority: m_priority?.value || "medium",
        description: (m_desc?.value || "").trim(),
      });
      showToast("Ticket created", "success");
      m_desc.value = "";
      await fetchTickets(true);
      closeCreateTicketModal();
    } catch (e) {
      console.error("Create ticket error:", e);
      alert(e.message);
    }
  };
}

// новый небольшой хелпер для upsert в job_extra (по ticket_id)
async function upsertJobExtraKm(ticketId, km) {
  // upsert с конфликтом по ticket_id (в Supabase — onConflict)
  const { error } = await supabase
    .from('job_extra')
    .upsert(
      { ticket_id: ticketId, buggy_km: km },
      { onConflict: 'ticket_id' }
    );
  return { error };
}

// Call this when the "Save hours" button is clicked for a given ticket
async function handleSaveOdometerAndKm(ticket) {
  // Try both our usual ids and data-attributes in case markup differs
  const hoursInEl =
    document.getElementById(`hours-in-${ticket.id}`) ||
    document.querySelector(`[data-field="hours-in"][data-ticket="${ticket.id}"]`);

  const kmEl =
    document.getElementById(`hours-out-${ticket.id}`) ||
    document.querySelector(`[data-field="km"][data-ticket="${ticket.id}"]`);

  const buggy_hours = parseInt(hoursInEl?.value, 10);
  const buggy_km = parseInt(kmEl?.value, 10);

  if (!Number.isInteger(buggy_hours) || !Number.isInteger(buggy_km)) {
    alert('Enter integer values for odometer and KM.');
    return;
  }

  // One UPSERT, no representation back => avoids SELECT RLS on job_extra
  const { error } = await supabase
    .from('job_extra')
    .upsert(
      {
        ticket_id: ticket.id,
        buggy_hours,
        buggy_km,
      },
      {
        onConflict: 'ticket_id',
        returning: 'minimal', // key to avoid SELECT
      }
    );

  if (error) {
    console.error('[mech] upsert job_extra error:', error);
    alert('Failed to save odometer/KM.');
  } else {
    alert('Odometer and KM saved ✓');
  }
}

// ---- Auth state ----
function updateUI(session) {
  const signedIn = !!session;

  if (signedIn) {
    renderTickets();
    if (!offTickets) {
      offTickets = subscribeTickets((payload) => {
        // payload.new содержит добавленную строку
        const t = payload?.new || {};
        // сразу перерисуем список
        renderTickets();
        // дружелюбный тост
        const pri = String(t.priority || "").toLowerCase();
        showToast(`New ticket${t.description ? ': ' + t.description : ''}${pri ? ' ('+pri+')' : ''}`, "success");
      });
    }
  } else {
    if (offTickets) { offTickets(); offTickets = null; }
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#888;">No tickets found</td></tr>`;
  }
}

async function init() {
  // Импортируем функцию проверки аутентификации
  const { checkAuth, setupAuthListener } = await import('./auth-check.js');
  
  // Проверяем аутентификацию
  const { user, isAuthenticated } = await checkAuth('mechanic', './mechanic-login.html');
  
  if (!isAuthenticated) {
    return; // Редирект уже произошел в checkAuth
  }
  
  // Настраиваем слушатель изменений аутентификации
  setupAuthListener((event, session) => {
    if (event === 'SIGNED_OUT') {
      window.location.href = './mechanic-login.html';
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
  const role = localStorage.getItem('role') || 'mechanic';
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
  
  wireUI();
  styleBase();

  // Default filters for mechanics: show OPEN tickets (not just mine)
  currentStatus = 'open';
  const sfEl = document.getElementById('filterStatus');
  if (sfEl) sfEl.value = 'open';

  let session = await getSession();
  console.log("session at start:", session);

  // ⬇️ временный автологин (для разработки / инкогнито)
  if (!session) {
    try {
      await login(MECHANIC_EMAIL, MECHANIC_PASSWORD);
      session = await getSession();
      console.log("session after auto-login:", session);
    } catch (e) {
      console.error("Auto-login failed:", e);
      alert("Auto-login failed: " + e.message);
    }
  }

  // Get current user ID
  const { data: userResp } = await supabase.auth.getUser();
  myId = userResp?.user?.id || null;

  updateUI(session);
  await fetchTickets(true);
  onAuthChange((s) => {
    console.log("auth change:", s);
    updateUI(s);
  });

  // Initialize dealer visits for mechanics
  await initDealerVisitsMech();
}

// === DEALER VISITS LOGIC FOR MECHANICS ===
const DEALER = {
  mapById: new Map(),
};

async function initDealerVisitsMech() {
  // не инициализируем, если секции нет (безопасно для других страниц)
  const dealerSection = document.getElementById('dealer-mech');
  if (!dealerSection) {
    console.log('[dealer/mech] Section not found, skipping initialization');
    return;
  }

  console.log('[dealer/mech] Initializing dealer visits section...');

  try {
    console.log('[dealer/mech] Loading buggies...');
    await loadDealerBuggiesForMechanic();
    
    console.log('[dealer/mech] Loading active dealer visits...');
    await loadMyDealerActive();

    const giveBtn = document.getElementById('dealer-mech-give-btn');
    if (giveBtn) {
      giveBtn.addEventListener('click', handleGiveToDealerClick);
      console.log('[dealer/mech] Give button handler attached');
    } else {
      console.warn('[dealer/mech] Give button not found');
    }

    // подключаем обработчик change для селектора багги
    const buggySel = document.getElementById('dealer-mech-buggy');
    if (buggySel) {
      buggySel.addEventListener('change', refreshDealerGiveBtn);
      console.log('[dealer/mech] Buggy select change handler attached');
    } else {
      console.warn('[dealer/mech] Buggy select not found');
    }
    
    console.log('[dealer/mech] Initialization completed successfully');
  } catch (e) {
    console.error('[dealer/mech] init error:', e);
    notify('Failed to init dealer visits', 'error');
  }
}

// элементы
const dealerBuggySel = document.getElementById('dealer-mech-buggy');
const dealerGiveBtn = document.getElementById('dealer-mech-give-btn');

// вызывать на change селекта и после успешной вставки/возврата
async function refreshDealerGiveBtn() {
  const buggyId = dealerBuggySel.value;
  if (!buggyId) {
    dealerGiveBtn.disabled = true;
    dealerGiveBtn.title = '';
    return;
  }
  const { data, error } = await supabase
    .from('dealer_visits')
    .select('id')
    .eq('buggy_id', buggyId)
    .is('returned_at', null)
    .limit(1);

  // если есть активная запись — запрещаем отдачу
  const isLocked = !error && data && data.length > 0;
  dealerGiveBtn.disabled = isLocked;
  dealerGiveBtn.title = isLocked ? 'This buggy is already at dealer' : '';
}

async function loadDealerBuggiesForMechanic() {
  console.log('[dealer/mech] Starting to load buggies...');
  
  DEALER.mapById.clear();
  const sel = document.getElementById('dealer-mech-buggy');
  
  if (!sel) {
    console.error('[dealer/mech] Select element not found!');
    return;
  }
  
  console.log('[dealer/mech] Select element found, clearing options...');
  sel.innerHTML = '<option value="">Select buggy…</option>';

  try {
    console.log('[dealer/mech] Querying buggies from database...');
    const { data, error } = await supabase
      .from('buggies')
      .select('id, number')
      .order('number', { ascending: true });

    if (error) {
      console.error('[dealer/mech] buggies error:', error);
      notify('Failed to load buggies', 'error');
      return;
    }

    console.log('[dealer/mech] Received', data?.length || 0, 'buggies from database');
    
    for (const b of data || []) {
      DEALER.mapById.set(b.id, b.number);
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.number;
      sel.appendChild(opt);
    }
    
    console.log('[dealer/mech] Select populated with', sel.options.length - 1, 'buggies');
    console.log('[dealer/mech] DEALER.mapById size:', DEALER.mapById.size);
    
    // вызываем проверку кнопки после загрузки багги
    await refreshDealerGiveBtn();
    
  } catch (e) {
    console.error('[dealer/mech] Unexpected error loading buggies:', e);
  }
}

async function handleGiveToDealerClick() {
  const buggy_id = document.getElementById('dealer-mech-buggy')?.value;
  const issue    = document.getElementById('dealer-mech-issue')?.value?.trim();

  if (!buggy_id) { notify('Select a buggy, please', 'warn'); return; }
  if (!issue)     { notify('Describe the issue', 'warn');     return; }

  const payload = { buggy_id, issue, status: 'at_dealer' }; // given_at/created_by via defaults

  const { error } = await supabase
    .from('dealer_visits')
    .insert([payload], { returning: 'minimal' });

  if (error) {
    // 23505 = нарушение уникального индекса (багги уже у дилера)
    if (error.code === '23505') {
      notify('This buggy is already at dealer.', 'error'); // английский алерт
      await refreshDealerGiveBtn();
      return;
    }
    console.error('[dealer/mech] give error:', error);
    notify('Failed to create dealer visit.', 'error');
    return;
  }

  notify('Given to dealer ✔️', 'success');
  document.getElementById('dealer-mech-issue').value = '';
  document.getElementById('dealer-mech-buggy').value = '';
  await refreshDealerGiveBtn();
  await loadMyDealerActive();
}

async function loadMyDealerActive() {
  const list = document.getElementById('dealer-mech-active-list');
  if (!list) return;
  list.innerHTML = '';

  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;

  const { data, error } = await supabase
    .from('dealer_visits')
    .select('id, buggy_id, given_at, issue, status')
    .eq('created_by', uid)
    .eq('status', 'at_dealer')
    .order('given_at', { ascending: false });

  if (error) {
    console.error('[dealer/mech] list error:', error);
    notify('Failed to load active dealer visits', 'error');
    return;
  }

  if (!data?.length) {
    list.innerHTML = '<li class="muted">No active dealer visits</li>';
    return;
  }

  for (const row of data) {
    const li = document.createElement('li');
    li.className = 'item-row flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4';

    const left = document.createElement('div');
    const buggyNum = DEALER.mapById.get(row.buggy_id) ?? '—';
    left.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <div class="text-base sm:text-lg font-bold text-gray-800">#${buggyNum}</div>
        <span class="badge badge-sm badge-warning">active</span>
      </div>
      <div class="text-sm sm:text-base text-gray-700 mb-1">${row.issue}</div>
      <div class="text-xs sm:text-sm text-gray-500">Given: ${new Date(row.given_at).toLocaleString()}</div>
    `;

    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary px-3 py-2 min-w-[120px] text-center text-sm w-full sm:w-auto';
    btn.textContent = 'Mark returned';
    btn.onclick = () => handleMarkReturnedDealer(row.id);

    li.append(left, btn);
    list.appendChild(li);
  }
}

async function handleMarkReturnedDealer(id) {
  const { error } = await supabase
    .from('dealer_visits')
    .update({ status: 'closed', returned_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('[dealer/mech] close error:', error);
    notify('Failed to mark returned', 'error');
    return;
  }
  notify('Returned from dealer', 'success');
  await refreshDealerGiveBtn();
  await loadMyDealerActive();
}

// === Dealer visits view functions ===

// 1) Загрузка списка из dealer_visits_view
async function fetchDealerVisits(filter = 'active') {
  // читаем из VIEW, где уже есть buggy_number и created_by_name
  let query = supabase
    .from('dealer_visits_view')
    .select('id, buggy_number, given_at, returned_at, issue, created_by_name')
    .order('given_at', { ascending: false });

  if (filter === 'active') {
    query = query.is('returned_at', null);
  } else if (filter === 'returned') {
    query = query.not('returned_at', 'is', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[dealer] load error:', error);
    return [];
  }
  return data || [];
}

// 2) Рендер одной карточки (добавили «By {created_by_name}»)
function renderDealerCard(row) {
  const by = row.created_by_name || '—';
  const given = formatDateTime(row.given_at);

  return `
    <div class="card p-3 sm:p-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <div class="flex items-center gap-2">
          <div class="text-base sm:text-lg font-bold text-slate-800">#${row.buggy_number}</div>
          ${row.returned_at ? 
            `<span class="badge badge-sm bg-green-100 text-green-800 text-xs px-2 py-1">done</span>` : 
            `<span class="badge badge-sm bg-amber-100 text-amber-800 text-xs px-2 py-1">active</span>`
          }
        </div>
      </div>
      
      <div class="mt-2 sm:mt-3 space-y-1">
        <div class="text-xs sm:text-sm text-slate-600">
          <span class="font-medium">Given:</span> ${given}
        </div>
        <div class="text-xs sm:text-sm text-slate-600">
          <span class="font-medium">By:</span> ${by}
        </div>
        <div class="text-sm sm:text-base text-slate-700 mt-2">
          ${escapeHtml(row.issue || '—')}
        </div>
      </div>
    </div>
  `;
}

// Вспомогательные функции
function formatDateTime(x) { 
  return new Date(x).toLocaleString(); 
}

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// === Test drive state initialization ===
async function applyTestDriveStatesForMechanic() {
  const btns = [...document.querySelectorAll('[data-action="request-testdrive"]')];
  if (!btns.length) return;

  const ids = btns.map(b => b.dataset.ticketId).filter(Boolean);
  const { data, error } = await supabase
    .from('job_extra')
    .select('ticket_id, test_drive')
    .in('ticket_id', ids);

  if (error) {
    console.error('[mech] load job_extra failed', error);
    return;
  }
  const map = new Map((data || []).map(r => [r.ticket_id, r.test_drive]));
  for (const btn of btns) {
    const st = map.get(btn.dataset.ticketId);
    if (st === 'requested') {
      btn.disabled = true;
      btn.textContent = 'Test drive requested';
      btn.classList.add('btn-ghost');
      btn.setAttribute('aria-pressed', 'true');

      const badge = btn.closest('.ticket-card')?.querySelector('[data-testdrive-badge]');
      if (badge) {
        badge.textContent = 'Requested';
        badge.className = 'badge badge-warn';
      }
    }
  }
}

// === Test drive helper ===
async function saveTestDriveRequested(ticketId) {
  const payload = { ticket_id: ticketId, test_drive: 'requested' };

  const { data, error } = await supabase
    .from('job_extra')
    .upsert(payload, { onConflict: 'ticket_id' })  // <— ключ
    .select('ticket_id, test_drive')
    .single();

  if (error) throw error;

  // 🔔 вебхук: запрос тест-драйва
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

    // попытаемся получить имя механика
    let mechName = user?.user_metadata?.name || user?.email || 'Unknown';
    try {
      const { data: m } = await supabase
        .from('mechanics')
        .select('name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (m?.name) mechName = m.name;
    } catch {}

    await sendMakeWebhook({
      event: 'testdrive_requested',
      ticket_id: ticketId,
      buggy_id: ticketData?.buggy_id ?? null,
      buggy_number: buggyNumber,
      actor_role: 'mechanic',
      actor_id: user?.id ?? null,
      actor_name: mechName,
      created_at_iso: new Date().toISOString(),
      tz_offset_minutes: new Date().getTimezoneOffset() * -1,
      page: location.pathname,
    });
  } catch (e) {
    // вебхук не должен ломать основной функционал
    console.warn('[webhook] testdrive_requested failed:', e);
  }

  return data; // { ticket_id, test_drive: 'requested' }
}





init();
