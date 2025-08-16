import { supabase } from './supabase.js';

// Helper for buggy status badges (legacy, not used anymore)
function renderBuggyStatusBadge(buggyId) {
  // This function is kept for backward compatibility but not used in new implementation
  return '';
}

// 2) при рендере карточки
function renderBuggyCard(b, statusById) {
  const st = statusById.get(b.id) || {};
  const isService = st.status_label === 'in_service';

  // бейдж с fallback'ами (приоритет: At dealer > In service > Ready)
  let badgeText, badgeClass;
  if (b._uiAtDealer) {
    badgeText = 'At dealer';
    badgeClass = 'bg-sky-100 text-sky-700';
  } else if (st.status_label) {
    if (isService) {
      badgeText = 'In service';
      badgeClass = 'bg-amber-100 text-amber-700';
    } else {
      badgeText = 'Ready';
      badgeClass = 'bg-emerald-100 text-emerald-700';
    }
  } else {
    badgeText = '—';
    badgeClass = 'bg-gray-100 text-gray-500';
  }

  // подпись под заголовком с fallback'ами
  let subtitle;
  if (b._uiAtDealer) {
    subtitle = 'At dealer';
  } else if (isService && st.in_service_since) {
    subtitle = `since ${fmtDate(st.in_service_since)} · ${daysFrom(st.in_service_since)}d`;
  } else if (st.last_ticket_at) {
    subtitle = `Updated ${timeAgo(st.last_ticket_at)}`;
  } else {
    subtitle = 'No status';
  }

  return `
    <div class="buggy-chip" title="${b.model??''}">
      <div class="buggy-chip__header">
        <span class="buggy-chip__num">#${b.number}${b.model ? ' · '+b.model : ''}</span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}">${badgeText}</span>
      </div>
      <div class="buggy-chip__subtitle text-slate-500 text-sm">${subtitle}</div>
    </div>
  `;
}

// 3) хелперы дат
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day:'2-digit', month:'2-digit', year:'numeric' });
}

function daysFrom(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000)); // 24*60*60*1000
}

function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)   return `${sec}s ago`;
  const min = Math.floor(sec/60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min/60);
  if (hr < 24)    return `${hr}h ago`;
  const d   = Math.floor(hr/24);
  return `${d}d ago`;
}

// Job Cards: load buggies for select
async function hydrateJobCardsBuggies() {
  const sel = document.getElementById('jobcards-buggy');
  if (!sel) return;

  // базовая опция
  sel.innerHTML = '';
  sel.appendChild(new Option('All buggies', ''));

  const { data, error } = await supabase
    .from('buggies')
    .select('id, number')
    .order('number', { ascending: true });

  if (error) {
    console.error('[jobcards] buggies load error:', error);
    return;
  }

  const seen = new Set();
  for (const row of data || []) {
    const num = String(row.number ?? '').trim();
    if (!num || seen.has(num)) continue;
    seen.add(num);
    // value = buggy_id, label = номер
    sel.appendChild(new Option(num, row.id));
  }
}

// Job Cards: read filters from DOM
function getJobCardsFilters() {
  const sel = document.getElementById('jobcards-buggy');
  const buggyId = sel ? sel.value : '';

  const fromInput = document.getElementById('jobcards-from');
  const toInput   = document.getElementById('jobcards-to');
  const fromVal = fromInput?.value?.trim() || '';
  const toVal   = toInput?.value?.trim() || '';
  return { buggyId, fromVal, toVal };
}

const roleTitle = document.getElementById('roleTitle');
const userNameBadge = document.getElementById('userNameBadge');
const logoutBtn = document.getElementById('logoutBtn');
const toastWrap = document.getElementById('toastWrap');
const tbl = document.getElementById('admTickets');
const btnRefresh = document.getElementById('admRefresh');
const btnPrev = document.getElementById('admPrev');
const btnNext = document.getElementById('admNext');
const pageLabel = document.getElementById('admPage');

let page = 1;
// Admin state
let adminState = {
  page: 1,
  pageSize: 20,
  status: 'all',
  priority: 'all',
  sort: { field: 'created_at', dir: 'desc' }
};

// Tickets paging state used by delegated filters/pager
let ticketsPage = 1;
const TICKETS_PAGE_SIZE = 20;

// Unified read of ticket filters directly from DOM
function readTicketFilters() {
  const statusEl   = document.getElementById('tickets-status');
  const priorityEl = document.getElementById('tickets-priority');
  const buggyEl    = document.getElementById('tickets-buggy');
  const status   = (statusEl?.value || '').trim();
  const priority = (priorityEl?.value || '').trim();
  const buggy    = (buggyEl?.value || '').trim();
  return { status, priority, buggy };
}

// Unified English labels
const LABELS = {
  created: 'Created',
  buggy: 'Buggy',
  description: 'Description',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  started: 'Started',
  completed: 'Completed',
  created_by: 'Created by'
};

function ensureToastContainer() {
  let c = document.getElementById('toasts');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toasts';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

export function showToast(message, type = 'success') {
  const c = ensureToastContainer();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ---- Buggies: modal controls ----
function openAdminModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('hidden');
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
  setFieldError('buggy-number-error', null);
}
function closeAdminModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('open');
  m.classList.add('hidden');
  document.body.style.overflow = '';
}
async function createBuggyHandler() {
  const numEl = document.getElementById('buggy-number');
  const modelEl = document.getElementById('buggy-model');
  const errId = 'buggy-number-error';
  const btn = document.getElementById('btn-create-buggy');
  const number = String(numEl?.value || '').trim();
  const model  = String(modelEl?.value || '').trim();
  if (!number) { setFieldError(errId, 'Number is required'); numEl?.focus(); return; }
  try {
    btn?.classList.add('is-loading');
    const { error } = await supabase.from('buggies').insert({ number, model: model || null });
    if (error) {
      if (error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate')) {
        setFieldError(errId, `Buggy ${number} already exists`);
        showToast(`Buggy ${number} already exists`, 'error');
      } else {
        showToast(`Failed to add buggy: ${error.message}`, 'error');
      }
      return;
    }
    setFieldError(errId, null);
    closeAdminModal('admin-add-buggy-modal');
    showToast(`Buggy ${number} added`, 'success');
    refreshBuggiesEverywhere();
    await hydrateJobCardsBuggies();
    document.getElementById('btn-open-add-buggy')?.focus();
  } catch (e) {
    showToast(`Failed to add buggy: ${String(e.message || e)}`, 'error');
  } finally {
    btn?.classList.remove('is-loading');
  }
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
  else { el.textContent = ''; el.classList.add('hidden'); }
}

function clearAddBuggyForm() {
  const form = document.getElementById('addBuggyForm');
  if (form) form.reset();
  const num = document.getElementById('buggyNumberInput') || document.getElementById('buggy-number');
  const mdl = document.getElementById('buggyModelInput') || document.getElementById('buggy-model');
  if (num) num.value = '';
  if (mdl) mdl.value = '';
  if (typeof setFieldError === 'function') setFieldError('buggy-number-error', null);
}

function refreshBuggiesEverywhere() {
  // refresh Buggy Hours select only; do not auto-load hours
  if (typeof populateHoursBuggies === 'function') {
    // allow repopulation next time
    window.__hoursBuggiesPopulated = false;
    populateHoursBuggies();
  }
  if (typeof loadBuggies === 'function') loadBuggies().catch(console.error);
  // If there are other buggy selects (e.g., tickets), refresh them here similarly
}

async function getAdminProfile() {
  const { data: u } = await supabase.auth.getUser();
  const user = u?.user || null;
  if (!user) return { user: null, name: null };
  const email = user.email || '';
  const { data, error } = await supabase
    .from('admins')
    .select('name, slug')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  const name = data?.name || email.split('@')[0] || '—';
  return { user, name, email };
}

function formatDate(dt) {
  if (!dt) return '—';
  try { return new Date(dt).toLocaleString(); } catch { return '—'; }
}

// --- Job Cards date helpers ---
function parseUiDateToIso(dStr, endOfDay = false) {
  if (!dStr || !/\d/.test(dStr)) return null;
  const p = dStr.trim().split(/[./-]/).map(Number);
  if (p.length !== 3) return null;
  const [dd, mm, yyyy] = p; // dd/mm/yyyy
  if (!dd || !mm || !yyyy) return null;
  const d = endOfDay
    ? new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999))
    : new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0));
  return d.toISOString();
}

function fmtDateSafe(x) {
  if (!x) return '—';
  try {
    const s = typeof x === 'string' ? x.replace(' ', 'T') : x;
    const d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function chip(val, type) {
  const v = String(val || '').toLowerCase();
  let cls = 'px-2 py-0.5 rounded-full text-xs font-semibold select-none ';
  if (type === 'status') {
    if (v === 'done') cls += 'bg-green-100 text-green-800';
    else if (v === 'in_progress') cls += 'bg-blue-100 text-blue-800';
    else cls += 'bg-slate-100 text-slate-800';
  } else {
    if (v === 'high') cls += 'bg-red-100 text-red-800';
    else if (v === 'medium') cls += 'bg-amber-100 text-amber-800';
    else cls += 'bg-emerald-100 text-emerald-800';
  }
  return `<span class="${cls}">${v || '—'}</span>`;
}

async function fetchDictionaries() {
  const [
    { data: buggies },
    { data: mechs },
    { data: gids },
    { data: admins }
  ] = await Promise.all([
    supabase.from('buggies').select('id, number'),
    supabase.from('mechanics').select('user_id, name, slug'),
    supabase.from('guides').select('user_id, name, slug'),
    supabase.from('admins').select('user_id, name, slug')
  ]);

  const mapBuggies = new Map((buggies || []).map(b => [b.id, b.number]));
  const mapMechs = new Map((mechs || []).map(m => [m.user_id, m.name || m.slug]));
  const mapGuides = new Map((gids || []).map(g => [g.user_id, g.name || g.slug]));
  const mapAdmins = new Map((admins || []).map(a => [a.user_id, a.name || a.slug]));
  return { mapBuggies, mapMechs, mapGuides, mapAdmins };
}

async function loadTickets() {
  // Read filters directly from DOM (ensure function exists)
  const { status, priority, buggy } = (typeof readTicketFilters === 'function') ? readTicketFilters() : { status: '', priority: '', buggy: '' };

  // determine page and range (ticketsPage driven by UI)
  const pageNum = ticketsPage || adminState.page || 1;
  ticketsPage = pageNum;
  adminState.page = pageNum;
  const from = (pageNum - 1) * (TICKETS_PAGE_SIZE || adminState.pageSize);
  const to = from + (TICKETS_PAGE_SIZE || adminState.pageSize) - 1;

  // Loading state
  showLoading();
  let q = supabase
    .from('admin_ticket_overview_v2')
    .select('*, created_by_name, buggy_number, buggy_hours', { count: 'exact' });

  // Sorting
  const asc = adminState.sort.dir === 'asc';
  q = q.order(adminState.sort.field, { ascending: asc });

  // Apply filters only when present
  if (status)   q = q.eq('status', status);
  if (priority) q = q.eq('priority', priority);
  if (buggy)    q = q.eq('buggy_number', buggy);

  console.log('[tickets] querying with:', { status, priority, buggy, page: pageNum });

  const { data: tickets, error, count } = await q.range(from, to);
  if (error) { hideLoading(); console.error(error); showToast(error.message, 'error'); return; }
  
  // Debug: log first ticket to see what fields are available
  if (tickets && tickets.length > 0) {
    console.log('[tickets] First ticket data:', tickets[0]);
    console.log('[tickets] created_by_name field:', tickets[0].created_by_name);
  }

  // Build name maps for created_by and assignee (mechanics + guides)
  try {
    const [{ data: mechRows }, { data: guideRows }] = await Promise.all([
      supabase.from('mechanics').select('user_id, name'),
      supabase.from('guides').select('user_id, name')
    ]);

    const nameByUserId = new Map();
    const mechNameByUserId = new Map();
    (mechRows || []).forEach(r => {
      if (!r?.user_id) return;
      mechNameByUserId.set(r.user_id, r.name || '');
      nameByUserId.set(r.user_id, { name: r.name || '', role: 'Mechanic' });
    });
    (guideRows || []).forEach(r => {
      if (!r?.user_id) return;
      nameByUserId.set(r.user_id, { name: r.name || '', role: 'Guide' });
    });

    // Annotate tickets
    (tickets || []).forEach(t => {
      // Only set created_by_name if it's not already present in the database
      if (!t.created_by_name) {
        const info = t?.created_by ? nameByUserId.get(t.created_by) : null;
        t.created_by_name = info?.name || `User ${String(t.created_by || '').slice(0,8)}`;
        t.created_by_role = info?.role || 'User';
      }
      if (t.assignee) {
        const an = mechNameByUserId.get(t.assignee);
        if (an) t.assignee_name = an;
      }
    });
  } catch (e) {
    console.warn('Name maps build failed:', e);
  }

  const dicts = await fetchDictionaries();
  renderTickets(tickets || [], dicts);
  renderCards(tickets || [], dicts);

  updatePager(count || 0);
  hideLoading();
}

function renderTickets(rows, dicts) {
  const tbody = tbl?.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const getCreatorLabel = getCreatorLabelFactory(dicts || { mapMechs:new Map(), mapGuides:new Map(), mapAdmins:new Map() });
  
  // Debug: log first row to see what we're rendering
  if (rows && rows.length > 0) {
    console.log('[renderTickets] First row data:', rows[0]);
    console.log('[renderTickets] buggy_number:', rows[0].buggy_number);
    console.log('[renderTickets] created_by_name:', rows[0].created_by_name);
  }
  
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50';
    // Use buggy_number directly from the database instead of mapping through buggy_id
    const buggy = r.buggy_number || '—';
    const assigneeName = r.assignee_name || (r.assignee ? (dicts?.mapMechs?.get(r.assignee) || (String(r.assignee).slice(0,8) + '…')) : '—');
    // Use created_by_name directly from the database
    const createdBy = r.created_by_name || '—';
    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap">${formatDate(r.created_at)}</td>
      <td class="px-4 py-2 whitespace-nowrap">${buggy}</td>
      <td class="px-4 py-2">${r.description ?? '—'}</td>
      <td class="px-4 py-2 whitespace-nowrap">${chip(r.status,'status')}</td>
      <td class="px-4 py-2 whitespace-nowrap">${chip(r.priority,'priority')}</td>
      <td class="px-4 py-2 whitespace-nowrap">${assigneeName}</td>
      <td class="px-4 py-2 whitespace-nowrap">${formatDate(r.started_at)}</td>
      <td class="px-4 py-2 whitespace-nowrap">${formatDate(r.completed_at)}</td>
      <td class="px-4 py-2 whitespace-nowrap">${createdBy}</td>
      <td class="px-4 py-2 whitespace-nowrap">${r.location ?? '—'}</td>
      <td class="px-4 py-2 whitespace-nowrap">${r.buggy_hours ?? '—'}</td>
      <td class="px-4 py-2 whitespace-nowrap">${r.buggy_km ?? '—'}</td>
      <td class="px-4 py-2 whitespace-nowrap">${r.job_done ?? '—'}</td>
      <td class="px-4 py-2 whitespace-nowrap">${r.job_status ?? '—'}</td>
      <td class="px-4 py-2 whitespace-nowrap">${r.test_drive ?? '—'}</td>
      <td class="px-4 py-2 whitespace-nowrap">${r.parts_used ?? '—'}</td>
      <td class="px-4 py-2">${r.notes ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function getCreatorLabelFactory(dicts) {
  const { mapMechs, mapGuides, mapAdmins } = dicts;
  return function getCreatorLabel(uid) {
    if (!uid) return 'By User —';
    if (mapMechs.has(uid))  return `By Mechanic ${mapMechs.get(uid)}`;
    if (mapGuides.has(uid)) return `By Guide ${mapGuides.get(uid)}`;
    if (mapAdmins.has(uid)) return `By Admin ${mapAdmins.get(uid)}`;
    return `By User ${String(uid).slice(0,8)}…`;
  };
}

function renderCards(rows, dicts) {
  const wrap = document.getElementById('admCards');
  if (!wrap) return;
  wrap.innerHTML = '';
  const getCreatorLabel = getCreatorLabelFactory(dicts);
  rows.forEach(t => {

    const buggy = t.buggy_number || '—';
    const assigneeName = t.assignee_name || '—';
    const prio = String(t.priority||'').toLowerCase();
    const prioClass = prio==='high' ? 'prio-high' : prio==='medium' ? 'prio-medium' : 'prio-low';
    
    const card = document.createElement('div');
    card.className = `ticket-card-mobile ${prioClass}`;
    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="text-lg font-bold">Buggy ${buggy}</div>
        <div class="flex items-center gap-2">
          ${chip(t.status,'status')}
          ${chip(t.priority,'priority')}
        </div>
      </div>

      <div class="mb-1 text-[11px] uppercase tracking-wide text-slate-500">${LABELS.created}</div>
      <div class="mb-3 font-medium">${formatDate(t.created_at)}</div>

      <div class="mb-1 text-[11px] uppercase tracking-wide text-slate-500">${LABELS.description}</div>
      <div class="mb-3">${t.description || '—'}</div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <div class="mb-1 text-[11px] uppercase tracking-wide text-slate-500">${LABELS.assignee}</div>
          <div class="mb-3">${assigneeName}</div>
        </div>
        <div>
          <div class="mb-1 text-[11px] uppercase tracking-wide text-slate-500">${LABELS.created_by}</div>
          <div class="mb-3">${t.created_by_name || '—'}</div>
        </div>
        <div>
          <div class="mb-1 text-[11px] uppercase tracking-wide text-slate-500">${LABELS.started}</div>
          <div class="mb-3">${formatDate(t.started_at)}</div>
        </div>
        <div>
          <div class="mb-1 text-[11px] uppercase tracking-wide text-slate-500">${LABELS.completed}</div>
          <div class="mb-3">${formatDate(t.completed_at)}</div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 mt-2">
        <div><div class="text-[11px] uppercase tracking-wide text-slate-500">Location</div><div>${t.location ?? '—'}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-slate-500">Hours</div><div>${t.buggy_hours ?? '—'}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-slate-500">Km</div><div>${t.buggy_km ?? '—'}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-slate-500">Job done</div><div>${t.job_done ?? '—'}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-slate-500">Job status</div><div>${t.job_status ?? '—'}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-slate-500">Test drive</div><div>${t.test_drive ?? '—'}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-slate-500">Parts</div><div>${t.parts_used ?? '—'}</div></div>
        <div class="col-span-2"><div class="text-[11px] uppercase tracking-wide text-slate-500">Notes</div><div>${t.notes ?? '—'}</div></div>
      </div>
    `;
    wrap.appendChild(card);
  });
}

function showLoading() {
  const wrap = document.getElementById('admCards');
  if (wrap) wrap.innerHTML = '<div class="text-center text-slate-500 py-6">Loading…</div>';
  const tbody = tbl?.querySelector('tbody');
  if (tbody) tbody.innerHTML = '<tr><td class="px-4 py-6 text-center text-slate-500" colspan="16">Loading…</td></tr>';
}
function hideLoading() { /* no-op for now */ }

function updatePager(totalCount) {
  if (pageLabel) pageLabel.textContent = `Page ${ticketsPage}`;
  const maxIndex = (ticketsPage) * TICKETS_PAGE_SIZE;
  // disable Prev on first page
  if (btnPrev) btnPrev.disabled = ticketsPage <= 1;
  // disable Next if we reached the end
  if (btnNext) btnNext.disabled = totalCount <= maxIndex;
}

function initAdminFilters() {
  const s = document.getElementById('adminFilterStatus');
  const p = document.getElementById('adminFilterPriority');
  const r = document.getElementById('adminFilterReset');

  if (s) s.addEventListener('change', () => {
    adminState.status = s.value || 'all';
    adminState.page = 1;
    ticketsPage = 1;
    loadTickets();
  });
  if (p) p.addEventListener('change', () => {
    adminState.priority = p.value || 'all';
    adminState.page = 1;
    ticketsPage = 1;
    loadTickets();
  });
  if (r) r.addEventListener('click', () => {
    adminState.status = 'all';
    adminState.priority = 'all';
    if (s) s.value = '';
    if (p) p.value = '';
    adminState.page = 1;
    ticketsPage = 1;
    loadTickets();
  });
}

// === Simple tickets init wrapper (independent) ===
function bindTicketFilters() {
  const wrap = document.getElementById('tickets-filters');
  const resetBtn = document.getElementById('tickets-reset');

  if (wrap && !wrap.dataset.bound) {
    wrap.addEventListener('change', (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'tickets-status' || t.id === 'tickets-priority' || t.id === 'tickets-buggy') {
        ticketsPage = 1;
        const f = (typeof readTicketFilters === 'function') ? readTicketFilters() : { status:'', priority:'', buggy:'' };
        console.log('[tickets] change ->', f);
        loadTickets();
      }
    });
    wrap.dataset.bound = '1';
  }

  resetBtn?.addEventListener('click', () => {
    const s = document.getElementById('tickets-status');
    const p = document.getElementById('tickets-priority');
    const b = document.getElementById('tickets-buggy');
    if (s) s.value = '';
    if (p) p.value = '';
    if (b) b.value = '';
    ticketsPage = 1;
    console.log('[tickets] reset');
    loadTickets();
  });
}

// Load buggies for tickets filter
async function loadBuggiesForTicketsFilter() {
  const buggySelect = document.getElementById('tickets-buggy');
  if (!buggySelect) return;

  try {
    const { data, error } = await supabase
      .from('buggies')
      .select('id, number')
      .order('number', { ascending: true });

    if (error) {
      console.warn('[admin] buggies load error:', error);
      return;
    }

    // Clear existing options except "All buggies"
    buggySelect.innerHTML = '<option value="">All buggies</option>';
    
    // Add buggy options
    for (const buggy of data || []) {
      const opt = document.createElement('option');
      opt.value = String(buggy.number); // Filter by buggy_number
      opt.textContent = String(buggy.number);
      buggySelect.appendChild(opt);
    }
  } catch (e) {
    console.error('[admin] Failed to load buggies for filter:', e);
  }
}

function initAdminTickets() {
  bindTicketFilters();
  loadBuggiesForTicketsFilter(); // Load buggies for filter
  loadTickets();
}

export async function init() {
  // Импортируем функцию проверки аутентификации
  const { checkAuth, setupAuthListener } = await import('./auth-check.js');
  
  // Проверяем аутентификацию для админа
  const { user, isAuthenticated } = await checkAuth('admin', './admin-login.html');
  
  if (!isAuthenticated) {
    return; // Редирект уже произошел в checkAuth
  }
  
  // Настраиваем слушатель изменений аутентификации
  setupAuthListener((event, session) => {
    if (event === 'SIGNED_OUT') {
      window.location.href = './admin-login.html';
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
  
  // Admin profile name
  try {
    const { name } = await getAdminProfile();
    if (roleTitle) roleTitle.textContent = 'Admin';
    if (userNameBadge) userNameBadge.textContent = name || email.split('@')[0] || '—';
  } catch (e) {
    console.error(e);
  }

  // Wire controls
  logoutBtn?.addEventListener('click', async () => {
    try { await supabase.auth.signOut(); } finally { window.location.href = './admin-login.html'; }
  });
  btnRefresh?.addEventListener('click', () => { ticketsPage = 1; loadTickets(); });
  btnPrev?.addEventListener('click', () => { if (ticketsPage > 1) { ticketsPage--; loadTickets(); } });
  btnNext?.addEventListener('click', () => { ticketsPage++; loadTickets(); });

  // Optional sorting on desktop headers
  document.getElementById('thCreated')?.addEventListener('click', () => {
    const field = 'created_at';
    if (adminState.sort.field === field) {
      adminState.sort.dir = adminState.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      adminState.sort.field = field; adminState.sort.dir = 'desc';
    }
    adminState.page = 1; ticketsPage = 1; loadTickets();
  });
  document.getElementById('thPriority')?.addEventListener('click', () => {
    const field = 'priority';
    if (adminState.sort.field === field) {
      adminState.sort.dir = adminState.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      adminState.sort.field = field; adminState.sort.dir = 'asc';
    }
    adminState.page = 1; ticketsPage = 1; loadTickets();
  });

  // First load handled by independent initializers below
}

document.addEventListener('DOMContentLoaded', async () => {
  init();
  // Independent initializations
  initAdminTickets();
  if (typeof initAdminHours === 'function') initAdminHours();
  if (typeof ensureHoursAfterTickets === 'function') ensureHoursAfterTickets();
  // also wire simplified Hours init API if needed
  if (typeof initHoursSection === 'function') initHoursSection();
  // Buggies modal wiring
  document.getElementById('btn-open-add-buggy')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearAddBuggyForm?.();
    openAdminModal('admin-add-buggy-modal');
    setTimeout(() => (document.getElementById('buggyNumberInput')||document.getElementById('buggy-number'))?.focus(), 0);
  });
  document.getElementById('btn-cancel-add-buggy')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearAddBuggyForm?.();
    closeAdminModal('admin-add-buggy-modal');
  });
  document.getElementById('btn-create-buggy')?.addEventListener('click', createBuggyHandler);
  // live filter number input
  const numEl = document.getElementById('buggyNumberInput') || document.getElementById('buggy-number');
  numEl?.addEventListener('input', (e) => { e.target.value = String(e.target.value||'').replace(/\D/g,''); });
  if (typeof loadBuggies === 'function') loadBuggies();
  
  // Job Cards initialization
  await hydrateJobCardsBuggies();
  bindJobCardsControls();
  loadJobCards(1);
});

// --- keep Hours card right after Tickets card, regardless of how sections are appended later
function ensureHoursAfterTickets() {
  const wrap   = document.getElementById('admin-sections');
  const tickets= document.getElementById('tickets-card');
  const hours  = document.getElementById('hours-card');
  if (!wrap || !tickets || !hours) return;
  if (tickets.nextElementSibling !== hours) tickets.after(hours);
}

// call once after UI built
document.addEventListener('DOMContentLoaded', () => {
  try { ensureHoursAfterTickets(); } catch (e) { console.warn(e); }
});

// wrap global initAdmin if present to ensure ordering after re-renders
if (typeof window !== 'undefined' && typeof window.initAdmin === 'function') {
  const _initAdmin = window.initAdmin;
  window.initAdmin = async (...args) => {
    const res = await _initAdmin.apply(window, args);
    try { ensureHoursAfterTickets(); } catch (e) { console.warn(e); }
    return res;
  };
}

// Observe container for dynamic changes and keep order
const sections = document.getElementById('admin-sections');
if (sections) {
  const mo = new MutationObserver(() => {
    try { ensureHoursAfterTickets(); } catch(e) {}
  });
  mo.observe(sections, { childList:true, subtree:false });
}




// ---- Buggy Hours: state & utils
const hoursState = {
  buggyId: 'all',     // 'all' | <uuid>
  from: null,         // ISO string or null
  to: null,           // ISO string or null
};

// Guard to avoid double-populating buggy select
let __hoursBuggiesPopulated = false;

// Inclusive day bounds helpers
function dayStartISO(value) {
  if (!value) return null;
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function dayEndISO(value) {
  if (!value) return null;
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

// Populate buggy select by numbers (value = number string)
async function populateHoursBuggies() {
  if (__hoursBuggiesPopulated) return;
  __hoursBuggiesPopulated = true;

  const sel = document.getElementById('hours-buggy');
  if (!sel) return;

  // clear & placeholder
  sel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'All buggies';
  sel.appendChild(optAll);

  const { data, error } = await supabase
    .from('buggies')
    .select('id, number')
    .order('number', { ascending: true });

  if (!error && Array.isArray(data)) {
    console.log('[admin] Loaded buggies:', data);
    const seen = new Set();
    for (const row of data) {
      const num = row?.number;
      if (!num || seen.has(num)) continue;
      seen.add(num);

      const opt = document.createElement('option');
      opt.value = String(row.id); // value = buggy_id
      opt.textContent = String(num); // label = buggy_number
      sel.appendChild(opt);
      console.log('[admin] Added option:', { value: opt.value, text: opt.textContent });
    }
  }

  // force default to placeholder
  sel.value = '';

  // show empty state initially
  clearHoursResults();
}

// Apply filter using admin_buggy_hours view
async function applyHoursFilter() {
  console.log('[admin] applyHoursFilter called');
  
  const buggySel = document.getElementById('hours-buggy');
  const fromEl   = document.getElementById('hours-from');
  const toEl     = document.getElementById('hours-to');

  const buggyNumber = buggySel?.value || '';
  const fromVal  = fromEl?.value?.trim() || '';
  const toVal    = toEl?.value?.trim() || '';
  
  console.log('[admin] Filter values:', { buggyNumber, fromVal, toVal });

  // guard: nothing selected → do not query
  if (!buggyNumber && !fromVal && !toVal) { clearHoursResults(); return; }

  const fromISO = fromVal ? new Date(fromVal + 'T00:00:00Z').toISOString() : null;
  const toISO   = toVal   ? new Date(toVal   + 'T23:59:59Z').toISOString() : null;

  let q = supabase
    .from('buggy_hours_logs')
    .select('reading_at, hours, guide_name, buggy_id, note')
    .order('reading_at', { ascending: false });

  // Filter by buggy_id (which is the value of the select)
  if (buggyNumber) {
    console.log('[admin] Filtering by buggy_id:', buggyNumber);
    q = q.eq('buggy_id', buggyNumber);
  }
  if (fromISO) {
    console.log('[admin] Filtering by from date:', fromISO);
    q = q.gte('reading_at', fromISO);
  }
  if (toISO) {
    console.log('[admin] Filtering by to date:', toISO);
    q = q.lte('reading_at', toISO);
  }

  console.log('[admin] Executing query...');
  
  // Сначала проверим, есть ли вообще записи в таблице
  const { data: allData, error: allError } = await supabase
    .from('buggy_hours_logs')
    .select('*')
    .limit(5);
  
  if (allError) {
    console.error('[admin] Error checking all records:', allError);
  } else {
    console.log('[admin] All records in buggy_hours_logs:', { count: allData?.length || 0, data: allData || [] });
  }
  
  // Проверим конкретный buggy_id
  if (buggyNumber) {
    const { data: specificData, error: specificError } = await supabase
      .from('buggy_hours_logs')
      .select('*')
      .eq('buggy_id', buggyNumber)
      .limit(5);
    
    if (specificError) {
      console.error('[admin] Error checking specific buggy_id:', specificError);
    } else {
      console.log('[admin] Records for buggy_id', buggyNumber, ':', { count: specificData?.length || 0, data: specificData || [] });
    }
  }
  
  const { data, error } = await q;
  
  if (error) {
    console.error('[admin] hours query error:', error);
    renderHoursTable([]);
    return;
  }
  
  console.log('[admin] Query result:', { count: data?.length || 0, data: data?.slice(0, 2) || [] });
  renderHoursTable(data || []);
}

// Reset hours filter
function resetHoursFilter() {
  const buggySel = document.getElementById('hours-buggy');
  const fromEl   = document.getElementById('hours-from');
  const toEl     = document.getElementById('hours-to');
  if (buggySel) buggySel.value = '';
  if (fromEl)   fromEl.value = '';
  if (toEl)     toEl.value = '';
  clearHoursResults();
}

// call once on page init
async function initAdminHours() {
  await populateHoursBuggies();
  // do not auto-load; wait for Apply
  document.getElementById('hours-apply')?.addEventListener('click', applyHoursFilter);
  document.getElementById('hours-reset')?.addEventListener('click', resetHoursFilter);
}

// helpers (reuse if you already have them)
// fmtDate function already defined above
// Hours formatting helpers
function fmtDateISOToDMY(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString();
}
function fmtTimeISO(iso) {
  try {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDateTime(iso) {
  try {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '—';
  }
}

// Render the hours table (Date, Time of tour, Hours) and totals
function renderHoursTable(rows) {
  const tbody = document.querySelector('#hours-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'No records';
    td.className = 'text-slate-400 py-3';
    tr.appendChild(td);
    tbody.appendChild(tr);

    return;
  }

  for (const r of rows) {
    const dt = new Date(r.reading_at);
    const dateStr = dt.toLocaleDateString(undefined, { year:'numeric', month:'numeric', day:'numeric' });
    const timeStr = dt.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });

    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = dateStr;
    tdDate.className = 'py-2';
    tr.appendChild(tdDate);

    const tdTime = document.createElement('td');
    tdTime.textContent = timeStr;
    tdTime.className = 'py-2';
    tr.appendChild(tdTime);

    const tdGuide = document.createElement('td');
    tdGuide.textContent = r.guide_name ?? '—';
    tdGuide.className = 'py-2';
    tr.appendChild(tdGuide);

    const tdHours = document.createElement('td');
    tdHours.textContent = r.hours ?? '—';
    tdHours.className = 'py-2 text-right';
    tr.appendChild(tdHours);

    tbody.appendChild(tr);
  }


}

// Initialize simplified Hours section API: populate first, then apply filters
function initHoursSection() {
  try {
    if (typeof populateHoursBuggies === 'function') {
      Promise.resolve(populateHoursBuggies()).then(() => {
        // show empty state; do not auto-apply
      });
    }
    if (window.__hoursSectionWired) return;
    window.__hoursSectionWired = true;
    const applyBtn = document.getElementById('hours-apply');
    const resetBtn = document.getElementById('hours-reset');
    applyBtn?.addEventListener('click', (e) => { e.preventDefault(); if (typeof applyHoursFilter === 'function') applyHoursFilter(); });
    resetBtn?.addEventListener('click', (e) => { e.preventDefault(); if (typeof resetHoursFilter === 'function') resetHoursFilter(); });
  } catch (e) {
    console.warn('initHoursSection failed:', e);
  }
}

// Clear results helper for Hours panel
function clearHoursResults() {
  const tbody = document.querySelector('#hours-table tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">No records</td></tr>';
  }
}

// Load buggies card list
async function loadBuggies(){
  console.log('[admin] loadBuggies called');
  const root = document.getElementById('buggies-list');
  const cnt  = document.getElementById('buggies-count');
  if(!root) {
    console.error('[admin] buggies-list element not found');
    return;
  }
  root.innerHTML = 'Loading...';
  
  console.log('[admin] Fetching buggies and statuses from database...');
  
  // 1) грузим бэгги + статусы + визиты к дилеру параллельно с безопасной обработкой ошибок
  let buggies = [], e1 = null;
  let statusById = new Map();
  let activeDealerBuggyIds = new Set();
  try {
    console.log('[admin] Starting Promise.all...');
    const [q1, q2, q3] = await Promise.all([
      supabase.from('buggies').select('id, number, model, created_at').order('number', { ascending:true }),
      supabase.from('buggy_status_view')
        .select('buggy_id,status_label,last_ticket_at,in_service_since'),
      supabase.from('dealer_visits_overview')
        .select('buggy_number, returned_at')
        .is('returned_at', null)
    ]);
    console.log('[admin] Promise.all completed, q1:', q1, 'q2:', q2, 'q3:', q3);
    
    if (q1.error) {
      e1 = q1.error;
      console.error('[admin] buggies query error:', e1);
    } else {
      buggies = q1.data ?? [];
      console.log('[admin] buggies data:', buggies);
    }
    
    if (q2.error) {
      console.warn('[admin] buggy_status_view error → игнорируем:', q2.error);
    } else {
      statusById = new Map((q2.data ?? []).map(r => [r.buggy_id, r]));
      console.log('[admin] statusById created:', statusById);
    }
    
    if (q3.error) {
      console.warn('[admin] dealer_visits_overview error → игнорируем:', q3.error);
    } else {
      activeDealerBuggyIds = buildActiveDealerSet(q3.data, buggies);
      console.log('[admin] activeDealerBuggyIds created:', activeDealerBuggyIds);
    }
  } catch (err) {
    console.warn('[admin] загрузка данных свалилась → рендерим без них:', err);
  }
  
  if (e1) {
    console.error('[admin] buggies error:', e1);
    root.textContent = 'Failed to load buggies';
    return;
  }
  
  if (!buggies || buggies.length === 0) {
    console.log('[admin] No buggies found');
    root.textContent = 'No buggies yet';
    if (cnt) cnt.textContent = '0';
    return;
  }
  
  console.log('[admin] Buggy data loaded:', { count: buggies.length, data: buggies.slice(0, 2) });
  console.log('[admin] Statuses loaded:', { count: statusById.size, statusById: Object.fromEntries(statusById) });
  
  // Render summary
  console.log('[admin] Rendering summary...');
  let summary = '';
  
  // Подсчитываем счетчики с учетом багги "у дилера"
  let readyCount = 0;
  let inServiceCount = 0;
  const atDealerCount = activeDealerBuggyIds.size;
  
  for (const b of buggies) {
    // если багги у дилера — отмечаем для бейджа и пропускаем подсчёт ready/in_service
    if (activeDealerBuggyIds.has(b.id)) {
      b._uiAtDealer = true; // пометка для карточки
      continue;
    }
    // иначе оставляем текущую логику
    const st = statusById.get(b.id) || {};
    if (st.status_label === 'in_service') {
      inServiceCount++;
    } else {
      readyCount++;
    }
  }
  
  summary = [
    { key: 'ready',      label: 'Ready',      count: readyCount },
    { key: 'in_service', label: 'In service', count: inServiceCount },
    { key: 'at_dealer',  label: 'At dealer',  count: atDealerCount },
  ].map(x => `<span class="mr-3 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100">${x.label}: <b class="ml-1">${x.count}</b></span>`).join('');
  
  const summaryEl = document.querySelector('#buggies-summary');
  if (summaryEl) {
    summaryEl.innerHTML = summary;
    console.log('[admin] Summary rendered:', summary);
  } else {
    console.error('[admin] buggies-summary element not found');
  }
  
  if (cnt) cnt.textContent = String(buggies.length);
  console.log('[admin] Rendering buggy cards...');
  
  root.innerHTML = buggies.map(b => renderBuggyCard(b, statusById)).join('');
  console.log('[admin] Buggy cards rendered');
}

// Populate buggy select for Job Cards
async function fillBuggySelectForJobCards() {
  const sel = document.getElementById('jc-buggy');
  if (!sel) return;
  const { data, error } = await supabase.from('buggies').select('id, number').order('number', { ascending: true });
  if (error) return console.error('[JobCards] buggy list error:', error);
  sel.innerHTML = `<option value="all">All buggies</option>` +
    data.map(b => `<option value="${b.id}">${b.number}</option>`).join('');
}

// --- Job Cards (admin) ---
(function enableJobCardsSafe() {
  try {
    // если supabase не доступен — выходим
    if (typeof supabase === 'undefined') return;

    // требуемые элементы интерфейса
    const need = ['jc-buggy','jc-from','jc-to','jc-apply','jc-reset','jc-list','jc-prev','jc-next','jc-page'];
    const qs = id => document.getElementById(id);
    if (!need.every(id => qs(id))) return; // UI нет — тихо выходим

    // ----- сюда помести ВЕСЬ текущий код Job Cards (jcEl, jcState, parseUiDateToIso, fmtDateSafe,
    //      loadJobCards, renderJobCards, updateJcPager и привязки событий) БЕЗ ИЗМЕНЕНИЙ -----
    
    const jcEl = {
      buggy:  qs('jc-buggy'),
      from:   qs('jc-from'),
      to:     qs('jc-to'),
      apply:  qs('jc-apply'),
      reset:  qs('jc-reset'),
      list:   qs('jc-list'),
      prev:   qs('jc-prev'),
      next:   qs('jc-next'),
      page:   qs('jc-page')
    };

    const jcState = { page: 1, pageSize: 6, total: 0 };

    function jobCardItem(row) {
      const num = row.buggy_number ?? '—';
      const hours = row.hours ?? '—';
      const km = row.km ?? '—';
      const loc = row.location ? escapeHtml(row.location) : null;
      const issue = row.issue ? escapeHtml(row.issue) : '';
      const reported = fmtDateTime(row.reported_at);

      return `
        <li class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 md:p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="text-lg md:text-xl font-semibold text-slate-900">#${num}</div>
            <time class="text-sm text-slate-500">${reported}</time>
          </div>

          <div class="mt-2 flex flex-wrap gap-2 text-sm">
            <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              <span class="font-medium">Hours:</span> ${hours}
            </span>
            <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              <span class="font-medium">KM:</span> ${km}
            </span>
            ${loc ? `
              <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5Z"/>
                </svg>
                ${loc}
              </span>` : ''
            }
          </div>

          ${issue ? `<p class="mt-3 text-slate-800 leading-relaxed">${issue}</p>` : ''}
        </li>
      `;
    }

    async function loadJobCards() {
      if (!jcEl.list) return;
      jcEl.list.innerHTML = '<div class="muted">Loading…</div>';

      let q = supabase.from('job_cards_v1')
        .select('*', { count: 'exact' })
        .order('reported_at', { ascending: false, nullsFirst: false });

      // фильтр по багги (value должно быть id багги, текстом показываем номер)
      const buggyId = jcEl.buggy?.value || '';
      if (buggyId && buggyId !== 'all') q = q.eq('buggy_id', buggyId);

      // даты из UI dd/mm/yyyy
      const fromIso = parseUiDateToIso(jcEl.from?.value, false);
      const toIso   = parseUiDateToIso(jcEl.to?.value,   true);
      if (fromIso) q = q.gte('reported_at', fromIso);
      if (toIso)   q = q.lte('reported_at', toIso);

      const from = (jcState.page - 1) * jcState.pageSize;
      const to   = from + jcState.pageSize - 1;
      q = q.range(from, to);

      const { data, count, error } = await q;
      if (error) {
        console.error('[JobCards] load error:', error);
        jcEl.list.innerHTML = `<div class="error">Failed to load</div>`;
        jcState.total = 0;
        updateJcPager();
        return;
      }
      jcState.total = count || 0;
      renderJobCards(data || []);
      updateJcPager();
    }

    function renderJobCards(items) {
      const list = document.getElementById('jobcards-list');
      if (!list) return;

      if (!items || !items.length === 0) {
        list.innerHTML = '<li class="jc-card"><div class="jc-desc">No data yet</div></li>';
        return;
      }

      for (const it of items) {
        const li = document.createElement('li');
        li.className = 'jc-card';

        // expected fields from the view: buggy_number, reported_at, hours, km, location, issue
        const buggy = it.buggy_number ? `#${it.buggy_number}` : '#—';
        const date  = it.reported_at ? new Date(it.reported_at).toLocaleString() : '';

        li.innerHTML = `
          <div class="jc-head">
            <div class="jc-id">${buggy}</div>
            <time class="jc-date">${date}</time>
          </div>

          <div class="jc-meta">
            <span class="jc-chip">Hours: ${it.hours ?? '—'}</span>
            <span class="jc-chip">KM: ${it.km ?? '—'}</span>
            <span class="jc-chip">📍 ${it.location ?? '—'}</span>
          </div>

          <p class="jc-desc">${it.issue ?? ''}</p>
        `;

        list.appendChild(li);
      }

      // если у тебя есть сводка — не забудь обновить:
      if (typeof updateJobCardsSummary === 'function') {
        updateJobCardsSummary(items);
      }
    }

    function updateJcPager() {
      if (!jcEl.page) return;
      const totalPages = Math.max(1, Math.ceil(jcState.total / jcState.pageSize));
      jcEl.page.textContent = `Page ${jcState.page} of ${totalPages}`;
      if (jcEl.prev) jcEl.prev.disabled = jcState.page <= 1;
      if (jcEl.next) jcEl.next.disabled = jcState.page >= totalPages;
    }

    // Event bindings
    jcEl.apply?.addEventListener('click', () => {
      jcState.page = 1;
      loadJobCards();
    });

    jcEl.reset?.addEventListener('click', () => {
      jcEl.buggy.value = 'all';
      jcEl.from.value = '';
      jcEl.to.value = '';
      jcState.page = 1;
      loadJobCards();
    });

    jcEl.prev?.addEventListener('click', () => {
      if (jcState.page > 1) {
        jcState.page--;
        loadJobCards();
      }
    });

    jcEl.next?.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(jcState.total / jcState.pageSize));
      if (jcState.page < totalPages) {
        jcState.page++;
        loadJobCards();
      }
    });

    // Initialize
    fillBuggySelectForJobCards();
    loadJobCards();

  } catch (e) {
    console.error('[JobCards fatal]', e); // не рушим остальной скрипт
  }
})();

// ---------- HOTFIX MOUNT FOR JOB CARDS ----------
(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    list: () => $('jobcards-list'),
    buggy: () => $('jobcards-buggy'),
    from: () => $('jobcards-from'),
    to: () => $('jobcards-to'),
    apply: () => $('jobcards-apply'),
    reset: () => $('jobcards-reset'),
    page: () => $('jobcards-page'),
    prev: () => $('jobcards-prev'),
    next: () => $('jobcards-next'),
  };

  let jcPage = 1;
  const PAGE_SIZE = 6;

  // 1) Рендер карточек (только верстка)
  function renderJobCards(items) {
    const list = els.list();
    if (!list) return;
    list.innerHTML = '';

    if (!items || items.length === 0) {
      list.innerHTML = '<li class="jc-card"><div class="jc-desc">No data yet</div></li>';
      return;
    }

    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'jc-card';
      const buggy = it.buggy_number ? `#${it.buggy_number}` : '#—';
      const date = it.reported_at ? new Date(it.reported_at).toLocaleString() : '';

      li.innerHTML = `
        <div class="jc-head">
          <div class="jc-id">${buggy}</div>
          <time class="jc-date">${date}</time>
        </div>

        <div class="jc-meta">
          <span class="jc-chip">Hours: ${it.hours ?? '—'}</span>
          <span class="jc-chip">KM: ${it.km ?? '—'}</span>
          <span class="jc-chip">📍 ${it.location ?? '—'}</span>
        </div>

        <p class="jc-desc">${it.issue ?? ''}</p>
      `;
      list.appendChild(li);
    }
  }

  // 2) Подгрузка списка багги (для фильтра) — берём из buggies
  async function loadBuggyOptions() {
    const sel = els.buggy();
    if (!sel) return;

    // если уже наполнен — не дублируем
    if (sel.options.length > 0) return;

    sel.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All buggies';
    sel.appendChild(all);

    try {
      // если у тебя другое имя таблицы/колонок — скорректируй тут
      const { data, error } = await supabase.from('buggies')
        .select('id, number')
        .order('number', { ascending: true });

      if (error) throw error;

      (data || []).forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;           // фильтруем по id
        opt.textContent = b.number; // показываем номер
        sel.appendChild(opt);
      });
    } catch (e) {
      console.error('[jobcards] loadBuggyOptions error:', e);
    }
  }

  // 3) Загрузка job_cards_v1 с фильтрами/страницей
  async function loadJobCards(page = 1) {
    const { buggyId, fromVal, toVal } = getJobCardsFilters();

    let q = supabase.from('job_cards_v1').select('*', { count: 'exact' });

    if (buggyId) q = q.eq('buggy_id', buggyId);
    if (fromVal) q = q.gte('reported_at', fromVal);
    if (toVal)   q = q.lte('reported_at', toVal);

    q = q.order('reported_at', { ascending: false }).range((page-1)*PAGE_SIZE, page*PAGE_SIZE-1);

    const { data, error, count } = await q;
    if (error) {
      console.error('[jobcards] loadJobCards error:', error);
      const list = els.list();
      if (list) list.innerHTML = '<li class="jc-card"><div class="jc-desc">Failed to load</div></li>';
      return;
    }
    renderJobCards(data || []);
    if (els.page()) els.page().textContent = `Page ${page} of ${Math.max(1, Math.ceil((count || 0) / PAGE_SIZE))}`;
  }

  // 4) Навесим обработчики
  function mountJobCardsUI() {
    if (!els.list()) return; // секции нет — выходим тихо (не ломаем админку)

    loadBuggyOptions().then(() => loadJobCards(jcPage));

    els.apply()?.addEventListener('click', () => {
      jcPage = 1;
      loadJobCards(jcPage);
    });
    els.reset()?.addEventListener('click', () => {
      if (els.buggy()) els.buggy().value = '';
      if (els.from()) els.from().value = '';
      if (els.to()) els.to().value = '';
      jcPage = 1;
      loadJobCards(jcPage);
    });
    els.prev()?.addEventListener('click', () => {
      if (jcPage > 1) {
        jcPage--;
        loadJobCards(jcPage);
      }
    });
    els.next()?.addEventListener('click', () => {
      jcPage++;
      loadJobCards(jcPage);
    });
  }

  // запускаем после Supabase init и DOM готов
  document.addEventListener('DOMContentLoaded', mountJobCardsUI);
})();

// === Dealer visits (admin) ===

// держим текущий фильтр здесь
let dealerVisitsFilter = 'active';

// Вспомогательная функция для построения Set активных визитов к дилеру
function buildActiveDealerSet(visits, buggies) {
  const ids = new Set();
  // Создаем Map для быстрого поиска buggy.id по buggy.number
  const buggyNumberToId = new Map(buggies.map(b => [b.number, b.id]));
  
  for (const v of visits || []) {
    // Защита от разных регистров/типов
    const isActive = v.returned_at === null || v.returned_at === undefined;
    if (isActive && v.buggy_number) {
      const buggyId = buggyNumberToId.get(v.buggy_number);
      if (buggyId) ids.add(buggyId);
    }
  }
  return ids;
}

function escapeHTML(s = '') {
  return s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function loadDealerVisitsAdmin(filter = dealerVisitsFilter) {
  const list = document.getElementById('dealer-visits-list');
  if (!list) return;
  list.innerHTML = '<div class="text-slate-400 text-sm">Loading…</div>';

  try {
    let q = supabase
      .from('dealer_visits_overview')
      .select('id, buggy_number, issue, given_at, returned_at, created_by_name');

    if (filter === 'active') {
      q = q.is('returned_at', null);
    } else if (filter === 'returned') {
      q = q.not('returned_at', 'is', null);
    }
    // для "all" фильтр не ставим

    const { data, error } = await q
      .order('given_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    if (!data || data.length === 0) {
      list.innerHTML = '<div class="text-slate-500">No records</div>';
      return;
    }

    list.innerHTML = data.map(v => {
      const isReturned = !!v.returned_at;
      const badge = isReturned
        ? `<span class="badge bg-emerald-100 text-emerald-700">returned</span>`
        : `<span class="badge bg-amber-100 text-amber-700">active</span>`;

      return `
        <div class="card flex items-center justify-between">
          <div>
            <div class="font-semibold">#${v.buggy_number ?? '—'}</div>
            <div class="text-xs text-slate-500">Given: ${new Date(v.given_at).toLocaleString()} • By ${v.created_by_name || '—'}</div>
            ${isReturned ? `<div class="text-xs text-slate-500">Returned: ${new Date(v.returned_at).toLocaleString()}</div>` : ''}
            <div class="text-sm mt-1">${escapeHTML(v.issue || '')}</div>
          </div>
          ${badge}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('[admin][dealer] load error', err);
    if (typeof notify === 'function') notify('Failed to load dealer visits', 'error');
    list.innerHTML = '<div class="text-red-500">Load failed</div>';
  }
}

// слушатели на селектор и кнопку
document.getElementById('dealer-visits-filter')?.addEventListener('change', (e) => {
  dealerVisitsFilter = e.target.value;
  loadDealerVisitsAdmin(dealerVisitsFilter);
});

document.getElementById('dealer-visits-refresh')?.addEventListener('click', () => {
  loadDealerVisitsAdmin(dealerVisitsFilter);
});

// первичная загрузка
document.addEventListener('DOMContentLoaded', () => {
  const f = document.getElementById('dealer-visits-filter');
  if (f) f.value = dealerVisitsFilter;
  loadDealerVisitsAdmin(dealerVisitsFilter);
});
