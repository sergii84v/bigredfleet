import { supabase } from "./supabase.js";

// ---------- AUTH ----------
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function logout() {
  await supabase.auth.signOut();
}

// ---------- DATA ----------
export async function listBuggies() {
  const { data, error } = await supabase
    .from("buggies")
    .select("id, number")
    .order("number", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Берём все тикеты (фильтр «открытых» делаем в app.js)
export async function listOpenTickets() {
  return listTickets({ status: 'open', priority: 'all' });
}

export async function listTickets({
  status = 'all',
  priority = 'all',
  assignee = null,
  limit = 30,
  offset = 0
} = {}) {
  let q = supabase
    .from('tickets')
    .select('id, buggy_id, description, status, priority, created_at, created_by, assignee, started_at, completed_at, hours_in, hours_out')
    .order('created_at', { ascending: false });

  if (status && status !== 'all') q = q.eq('status', status);
  if (priority && priority !== 'all') q = q.eq('priority', priority);
  if (assignee) q = q.eq('assignee', assignee);
  if (limit != null && offset != null) q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listTicketsWithCreator({
  status = 'all',
  priority = 'all',
  assignee = null,
  limit = 30,
  offset = 0
} = {}) {
  let q = supabase
    .from('admin_ticket_overview')
    .select('ticket_id, buggy_id, description, status, priority, created_at, assignee, started_at, completed_at, hours_in, hours_out, created_by_name')
    .order('created_at', { ascending: false });

  if (status && status !== 'all') q = q.eq('status', status);
  if (priority && priority !== 'all') q = q.eq('priority', priority);
  if (assignee) q = q.eq('assignee', assignee);
  if (limit != null && offset != null) q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) throw error;
  
  // Преобразуем данные для совместимости с существующим кодом
  return (data || []).map(ticket => ({
    ...ticket,
    id: ticket.ticket_id, // admin_ticket_overview использует ticket_id
    buggy_number: ticket.buggy_number // если есть в представлении
  }));
}

export function subscribeTickets(cb) {
  const channel = supabase
    .channel("tickets-realtime")
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "tickets" },
        cb)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export async function createTicketSimple({ buggy_id = null, priority = "medium", description = "" }) {
  // Получаем текущего пользователя для created_by
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("Not authenticated");
  
  const payload = { 
    buggy_id, 
    priority, 
    description, 
    status: "open",
    created_by: user.id  // ✅ Добавляем created_by
  };
  
  const { data, error } = await supabase.from("tickets").insert(payload).select('id').single();
  if (error) throw error;
  return data;
}

export async function updateTicket(id, patch) {
  const { error } = await supabase
    .from("tickets")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function assignToMe(ticketId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("tickets")
    .update({ assignee: user.id })
    .eq("id", ticketId);
  if (error) throw error;
}

export async function setStarted(ticketId) {
  const { error } = await supabase
    .from("tickets")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", ticketId);
  if (error) throw error;
}

export async function setDone(ticketId, hoursOut = null) {
  const patch = {
    status: "done",
    completed_at: new Date().toISOString(),
  };
  if (hoursOut !== null && hoursOut !== undefined) patch.hours_out = hoursOut;
  const { error } = await supabase
    .from("tickets")
    .update(patch)
    .eq("id", ticketId);
  if (error) throw error;
}

export async function addWorklog(ticketId, note, minutes) {
  const { error } = await supabase
    .from("worklogs")
    .insert({ ticket_id: ticketId, note, minutes });
  if (error) throw error;
}

export async function listWorklogs(ticketId) {
  const { data, error } = await supabase
    .from("worklogs")
    .select("id, note, minutes, created_at, user_id")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateTicketFields(id, patch) {
  const { error } = await supabase
    .from("tickets")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

// 1) список моих открытых тикетов (использует RLS; вернёт только свои)
export async function listMyOpenTickets() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  
  if (!user?.id) return; // на всякий случай, если не залогинен

  const { data, error } = await supabase
    .from('tickets')
    .select('id, buggy_id, description, status, created_at')
    .eq('created_by', user.id)                    // ← вот это главное
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // Подтягиваем данные из job_extra для тест-драйвов
  if (data && data.length > 0) {
    const ids = data.map(t => t.id);
    const { data: extra, error: extraErr } = await supabase
      .from('job_extra')
      .select('ticket_id, test_drive')
      .in('ticket_id', ids);
    
    if (!extraErr && extra) {
      const extraMap = new Map(extra.map(r => [r.ticket_id, r.test_drive]));
      // Добавляем test_drive к каждому тикету
      data.forEach(ticket => {
        ticket.test_drive = extraMap.get(ticket.id) || null;
      });
    }
    
    // Подтягиваем номера багги
    const buggyIds = data.map(t => t.buggy_id).filter(Boolean);
    if (buggyIds.length > 0) {
      const { data: buggies, error: buggiesErr } = await supabase
        .from('buggies')
        .select('id, number')
        .in('id', buggyIds);
      
      if (!buggiesErr && buggies) {
        const buggyMap = new Map(buggies.map(b => [b.id, b.number]));
        // Добавляем buggy_number к каждому тикету
        data.forEach(ticket => {
          ticket.buggy_number = buggyMap.get(ticket.buggy_id) || null;
        });
      }
    }
  }
  
  return data || [];
}

// 2) лог моточасов багги (без тикета)
export async function logBuggyHours({ buggy_id, hours_in = null, hours_out = null, note = '' }) {
  const payload = { buggy_id, hours_in, hours_out, note };
  const { error } = await supabase.from('buggy_hours_logs').insert(payload);
  if (error) throw error;
}

// Новый вариант — одно поле "hours" + опциональный момент "reading_at"
export async function logBuggyHoursSimple({ buggy_id, hours, reading_at = null, note = '' }) {
  if (!buggy_id) throw new Error('buggy_id required');
  if (hours == null || isNaN(Number(hours))) throw new Error('hours required');

  const payload = { buggy_id, hours: Number(hours), note };
  if (reading_at) payload.reading_at = reading_at;

  const { error } = await supabase.from('buggy_hours_logs').insert(payload);
  if (error) throw error;
}

// Обновим выборку последних логов, чтобы показывать hours/reading_at
export async function listMyRecentHours(limit = 10) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  
  const { data, error } = await supabase
    .from('buggy_hours_logs')
    .select('id, buggy_id, hours, reading_at, note, created_at')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  
  // Подтягиваем номера багги
  if (data && data.length > 0) {
    const buggyIds = data.map(h => h.buggy_id).filter(Boolean);
    if (buggyIds.length > 0) {
      const { data: buggies, error: buggiesErr } = await supabase
        .from('buggies')
        .select('id, number')
        .in('id', buggyIds);
      
      if (!buggiesErr && buggies) {
        const buggyMap = new Map(buggies.map(b => [b.id, b.number]));
        // Добавляем buggy_number к каждому логу
        data.forEach(hours => {
          hours.buggy_number = buggyMap.get(hours.buggy_id) || null;
        });
      }
    }
  }
  
  return data || [];
}

export async function listGuides() {
  const { data, error } = await supabase
    .from('guides')
    .select('id, name, slug')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listMechanics() {
  const { data, error } = await supabase
    .from('mechanics')
    .select('id, name, slug, user_id')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}
