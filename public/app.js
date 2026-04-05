// ============ 12 Colors ============
const COLORS = [
  { name: '红色', hex: '#ef4444' },
  { name: '橙色', hex: '#f97316' },
  { name: '琥珀', hex: '#f59e0b' },
  { name: '绿色', hex: '#22c55e' },
  { name: '青色', hex: '#06b6d4' },
  { name: '蓝色', hex: '#3b82f6' },
  { name: '靛蓝', hex: '#6366f1' },
  { name: '紫色', hex: '#8b5cf6' },
  { name: '粉色', hex: '#ec4899' },
  { name: '玫红', hex: '#f43f5e' },
  { name: '棕色', hex: '#a16207' },
  { name: '灰绿', hex: '#64748b' },
];

// ============ API Layer ============
function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); localStorage.removeItem('currentUser'); }

async function api(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api' + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ============ State ============
let currentUser = null;
let currentView = 'board';
let viewDate = new Date();
let myFilter = 'all';
let editingTaskId = null;
let cachedUsers = [];
let cachedTasks = [];
let ws = null;

// ============ WebSocket ============
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'tasks_changed' || msg.type === 'users_changed') {
        refreshData();
      }
      if (msg.type === 'notification') {
        updateNotificationBadge();
      }
    } catch {}
  };
  ws.onclose = () => {
    if (currentUser) setTimeout(connectWS, 3000);
  };
}

async function refreshData() {
  try {
    cachedUsers = await api('/users');
    cachedTasks = await api('/tasks');
    renderCurrentView();
    updateNotificationBadge();
  } catch {}
}

// ============ Auth ============
function showLogin() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
}
function showRegister() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  renderColorPicker();
}

async function renderColorPicker() {
  const picker = document.getElementById('colorPicker');
  let takenColors = [];
  try { takenColors = await api('/users/colors'); } catch {}
  picker.innerHTML = COLORS.map(c => {
    const taken = takenColors.includes(c.hex);
    return `<div class="color-swatch ${taken ? 'taken' : ''}"
      style="background:${c.hex}"
      title="${c.name}${taken ? ' (已被选择)' : ''}"
      ${taken ? '' : `onclick="selectColor('${c.hex}')"`}></div>`;
  }).join('');
}

function selectColor(hex) {
  document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
  event.target.classList.add('selected');
  document.getElementById('selectedColor').value = hex;
}

async function register() {
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value.trim();
  const color = document.getElementById('selectedColor').value;
  if (!username || !password) return alert('请填写用户名和密码');
  if (!color) return alert('请选择一个颜色');
  try {
    const res = await api('/auth/register', {
      method: 'POST', body: JSON.stringify({ username, password, color }),
    });
    alert(res.message);
    showLogin();
  } catch (e) { alert(e.message); }
}

async function login() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (!username || !password) return alert('请填写用户名和密码');
  try {
    const res = await api('/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    });
    setToken(res.token);
    currentUser = res.user;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    enterApp();
  } catch (e) { alert(e.message); }
}

function logout() {
  currentUser = null;
  clearToken();
  if (ws) { ws.close(); ws = null; }
  document.getElementById('appPage').style.display = 'none';
  document.getElementById('authPage').style.display = 'flex';
}

async function enterApp() {
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'block';
  const nameEl = document.getElementById('currentUserName');
  nameEl.textContent = currentUser.role === 'admin' ? currentUser.username + ' (管理员)' : currentUser.username;
  document.getElementById('currentUserBadge').style.background = currentUser.color;
  connectWS();
  await refreshData();
}

// ============ Auto-session restore ============
async function tryRestore() {
  const token = getToken();
  const saved = localStorage.getItem('currentUser');
  if (token && saved) {
    try {
      currentUser = JSON.parse(saved);
      await api('/users');
      enterApp();
    } catch {
      clearToken();
      currentUser = null;
    }
  }
}

// ============ Views ============
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
    document.getElementById(currentView + 'View').classList.add('active-view');
    renderCurrentView();
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    myFilter = btn.dataset.filter;
    renderMyView();
  });
});

function renderCurrentView() {
  switch (currentView) {
    case 'board': renderBoardView(); break;
    case 'day': renderDayView(); break;
    case 'week': renderWeekView(); break;
    case 'month': renderMonthView(); break;
    case 'my': renderMyView(); break;
  }
}

// ============ Helper ============
function getUserColor(username) {
  const u = cachedUsers.find(u => u.username === username);
  return u ? u.color : '#9ca3af';
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isOverdue(task) {
  if (task.status === '已完成') return false;
  if (!task.dueDate || !task.endTime) return false;
  const end = new Date(task.dueDate + 'T' + task.endTime);
  return end < new Date();
}

function taskCardHTML(task) {
  const overdue = isOverdue(task);
  const creatorColor = getUserColor(task.creator);
  const accepted = (task.participants || []).filter(p => p.status === 'accepted');

  let html = `<div class="task-card ${overdue ? 'overdue' : ''}" style="border-left-color:${creatorColor}" onclick="openDetail('${task.id}')">`;
  html += `<div class="task-card-header"><span class="task-card-title">${esc(task.title)}</span>`;
  html += `<span class="task-card-priority priority-${task.priority}">${task.priority}</span></div>`;
  if (task.description) html += `<div class="task-card-desc">${esc(task.description)}</div>`;
  html += `<div class="task-card-meta"><span class="task-card-assignee"><span class="mini-badge" style="background:${getUserColor(task.assignee)}"></span>${esc(task.assignee)}</span>`;
  if (task.startTime && task.endTime) html += `<span class="task-card-time">${task.startTime}-${task.endTime}</span>`;
  html += `</div>`;
  if (accepted.length > 0) {
    html += `<div class="task-card-participants">`;
    accepted.forEach(p => { html += `<span class="mini-badge" style="background:${getUserColor(p.username)}" title="${esc(p.username)}"></span>`; });
    html += `</div>`;
  }
  if (overdue) html += `<span class="task-card-overdue-tag">已逾期</span>`;
  html += `</div>`;
  return html;
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ============ Board View ============
function renderBoardView() {
  const tasks = cachedTasks;
  const e = s => { const t = tasks.filter(t => t.status === s); return t.length ? t.map(taskCardHTML).join('') : '<div class="empty-state">暂无任务</div>'; };
  document.getElementById('colTodo').innerHTML = e('待办');
  document.getElementById('colInProgress').innerHTML = e('进行中');
  document.getElementById('colDone').innerHTML = e('已完成');
}

// ============ Day View ============
function renderDayView() {
  const dateStr = formatDate(viewDate);
  const dayNames = ['日','一','二','三','四','五','六'];
  document.getElementById('dayTitle').textContent =
    `${viewDate.getFullYear()}年${viewDate.getMonth()+1}月${viewDate.getDate()}日 周${dayNames[viewDate.getDay()]}`;
  const tasks = cachedTasks.filter(t => t.dueDate === dateStr);
  let html = '';
  for (let h = 6; h <= 23; h++) {
    const hStr = String(h).padStart(2, '0');
    const slot = tasks.filter(t => { if (!t.startTime) return h === 8; return parseInt(t.startTime.split(':')[0]) === h; });
    html += `<div class="time-slot"><div class="time-label">${hStr}:00</div><div class="time-tasks">`;
    slot.forEach(t => {
      html += `<span class="time-task-chip" style="background:${getUserColor(t.creator)}" onclick="openDetail('${t.id}')">${esc(t.title)}${t.startTime && t.endTime ? ` (${t.startTime}-${t.endTime})` : ''}</span>`;
    });
    html += `</div></div>`;
  }
  document.getElementById('dayContent').innerHTML = html;
}

function navDate(offset) { viewDate = new Date(viewDate.getTime() + offset * 86400000); renderCurrentView(); }
function goToday() { viewDate = new Date(); renderCurrentView(); }

// ============ Week View ============
function renderWeekView() {
  const start = new Date(viewDate); start.setDate(start.getDate() - start.getDay());
  const end = new Date(start); end.setDate(end.getDate() + 6);
  document.getElementById('weekTitle').textContent =
    `${start.getFullYear()}年${start.getMonth()+1}月${start.getDate()}日 - ${end.getMonth()+1}月${end.getDate()}日`;
  const dayNames = ['周日','周一','周二','周三','周四','周五','周六'];
  const today = formatDate(new Date());
  let html = '<div class="week-header-cell"></div>';
  for (let d = 0; d < 7; d++) {
    const day = new Date(start); day.setDate(day.getDate() + d);
    const ds = formatDate(day);
    html += `<div class="week-header-cell ${ds === today ? 'today-col' : ''}">${dayNames[d]}<br>${day.getDate()}日</div>`;
  }
  for (let h = 6; h <= 22; h++) {
    html += `<div class="week-time-label">${String(h).padStart(2,'0')}:00</div>`;
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(day.getDate() + d);
      const ds = formatDate(day);
      const slot = cachedTasks.filter(t => { if (t.dueDate !== ds) return false; if (!t.startTime) return h === 8; return parseInt(t.startTime.split(':')[0]) === h; });
      html += `<div class="week-cell">`;
      slot.forEach(t => { html += `<span class="week-task-chip" style="background:${getUserColor(t.creator)}" onclick="openDetail('${t.id}')" title="${esc(t.title)}">${esc(t.title)}</span>`; });
      html += `</div>`;
    }
  }
  document.getElementById('weekContent').innerHTML = html;
}

// ============ Month View ============
function renderMonthView() {
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  document.getElementById('monthTitle').textContent = `${year}年${month + 1}月`;
  const firstDay = new Date(year, month, 1);
  const startDay = new Date(firstDay); startDay.setDate(startDay.getDate() - startDay.getDay());
  const today = formatDate(new Date());
  let html = ['日','一','二','三','四','五','六'].map(d => `<div class="month-day-header">${d}</div>`).join('');
  const cur = new Date(startDay);
  for (let i = 0; i < 42; i++) {
    const ds = formatDate(cur);
    const dayTasks = cachedTasks.filter(t => t.dueDate === ds);
    html += `<div class="month-day ${cur.getMonth() !== month ? 'other-month' : ''} ${ds === today ? 'today' : ''}">`;
    html += `<div class="month-day-num">${cur.getDate()}</div>`;
    dayTasks.slice(0, 3).forEach(t => { html += `<span class="month-task-dot" style="background:${getUserColor(t.creator)}" onclick="openDetail('${t.id}')">${esc(t.title)}</span>`; });
    if (dayTasks.length > 3) html += `<span style="font-size:11px;color:#6b7280">+${dayTasks.length - 3} 更多</span>`;
    html += `</div>`;
    cur.setDate(cur.getDate() + 1);
  }
  document.getElementById('monthContent').innerHTML = html;
}

function navMonth(offset) { viewDate.setMonth(viewDate.getMonth() + offset); renderCurrentView(); }

// ============ My View ============
function renderMyView() {
  let filtered;
  switch (myFilter) {
    case 'created': filtered = cachedTasks.filter(t => t.creator === currentUser.username); break;
    case 'assigned': filtered = cachedTasks.filter(t => t.assignee === currentUser.username); break;
    case 'participating': filtered = cachedTasks.filter(t => (t.participants || []).some(p => p.username === currentUser.username && p.status === 'accepted')); break;
    default: filtered = cachedTasks.filter(t => t.creator === currentUser.username || t.assignee === currentUser.username || (t.participants || []).some(p => p.username === currentUser.username && p.status === 'accepted'));
  }
  if (!filtered.length) { document.getElementById('myTaskList').innerHTML = '<div class="empty-state">暂无任务</div>'; return; }
  const po = { '高': 0, '中': 1, '低': 2 };
  filtered.sort((a, b) => {
    const ao = isOverdue(a) ? 0 : 1, bo = isOverdue(b) ? 0 : 1; if (ao !== bo) return ao - bo;
    const ad = a.status === '已完成' ? 1 : 0, bd = b.status === '已完成' ? 1 : 0; if (ad !== bd) return ad - bd;
    return (po[a.priority] || 1) - (po[b.priority] || 1);
  });
  document.getElementById('myTaskList').innerHTML = filtered.map(t => {
    const overdue = isOverdue(t), cc = getUserColor(t.creator);
    return `<div class="my-task-row ${overdue ? 'overdue' : ''}" style="border-left-color:${cc}" onclick="openDetail('${t.id}')">
      <span class="my-task-status status-${t.status}"></span>
      <div class="my-task-info"><div class="my-task-title">${esc(t.title)}${overdue ? ' <span class="task-card-overdue-tag">已逾期</span>' : ''}</div>
      <div class="my-task-subtitle">${t.dueDate || ''} ${t.startTime || ''}-${t.endTime || ''} · 负责人: ${esc(t.assignee)}</div></div>
      <div class="my-task-right"><span class="task-card-priority priority-${t.priority}">${t.priority}</span>
      <span class="mini-badge" style="background:${cc}" title="创建者: ${esc(t.creator)}"></span></div></div>`;
  }).join('');
}

// ============ Task Modal ============
function openTaskModal(taskId) {
  editingTaskId = taskId || null;
  document.getElementById('taskModalTitle').textContent = taskId ? '编辑任务' : '新建任务';
  const sel = document.getElementById('taskAssignee');
  sel.innerHTML = cachedUsers.map(u => `<option value="${esc(u.username)}" ${u.username === currentUser.username ? 'selected' : ''}>${esc(u.username)}</option>`).join('');
  const picker = document.getElementById('participantPicker');
  picker.innerHTML = cachedUsers.filter(u => u.username !== currentUser.username).map(u =>
    `<div class="participant-chip" data-user="${esc(u.username)}" onclick="toggleParticipant(this)"><span class="mini-badge" style="background:${u.color}"></span>${esc(u.username)}</div>`
  ).join('');
  if (taskId) {
    const task = cachedTasks.find(t => t.id === taskId);
    if (task) {
      document.getElementById('taskTitle').value = task.title;
      document.getElementById('taskDesc').value = task.description || '';
      document.getElementById('taskPriority').value = task.priority;
      document.getElementById('taskAssignee').value = task.assignee;
      document.getElementById('taskDueDate').value = task.dueDate || '';
      document.getElementById('taskStartTime').value = task.startTime || '';
      document.getElementById('taskEndTime').value = task.endTime || '';
      (task.participants || []).forEach(p => { const c = picker.querySelector(`[data-user="${p.username}"]`); if (c) c.classList.add('selected'); });
    }
  } else {
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDesc').value = '';
    document.getElementById('taskPriority').value = '中';
    document.getElementById('taskDueDate').value = formatDate(new Date());
    document.getElementById('taskStartTime').value = '';
    document.getElementById('taskEndTime').value = '';
  }
  document.getElementById('taskModal').style.display = 'flex';
}
function closeTaskModal() { document.getElementById('taskModal').style.display = 'none'; editingTaskId = null; }
function toggleParticipant(el) { el.classList.toggle('selected'); }

async function saveTask() {
  const title = document.getElementById('taskTitle').value.trim();
  const description = document.getElementById('taskDesc').value.trim();
  const priority = document.getElementById('taskPriority').value;
  const assignee = document.getElementById('taskAssignee').value;
  const dueDate = document.getElementById('taskDueDate').value;
  const startTime = document.getElementById('taskStartTime').value;
  const endTime = document.getElementById('taskEndTime').value;
  if (!title) return alert('请填写标题');
  if (!dueDate) return alert('请选择截止日期');
  const participants = [];
  document.querySelectorAll('#participantPicker .participant-chip.selected').forEach(el => participants.push(el.dataset.user));
  try {
    const body = JSON.stringify({ title, description, priority, assignee, dueDate, startTime, endTime, participants });
    if (editingTaskId) { await api('/tasks/' + editingTaskId, { method: 'PUT', body }); }
    else { await api('/tasks', { method: 'POST', body }); }
    closeTaskModal();
    await refreshData();
  } catch (e) { alert(e.message); }
}

// ============ Notifications ============
async function updateNotificationBadge() {
  try {
    const res = await api('/notifications/pending-count');
    const badge = document.getElementById('notifCount');
    if (res.count > 0) { badge.textContent = res.count; badge.style.display = 'flex'; }
    else { badge.style.display = 'none'; }
  } catch {}
}

async function toggleNotificationPanel() {
  const panel = document.getElementById('notificationPanel');
  if (panel.style.display === 'none') { await renderNotifications(); panel.style.display = 'block'; }
  else { panel.style.display = 'none'; }
}

async function renderNotifications() {
  try {
    const notifs = await api('/notifications');
    const list = document.getElementById('notificationList');
    if (!notifs.length) { list.innerHTML = '<div class="empty-state">暂无通知</div>'; return; }
    const sorted = [...notifs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    list.innerHTML = sorted.map(n => {
      let html = `<div class="notif-item"><div class="notif-text"><strong>${esc(n.from)}</strong> 邀请你参与任务「${esc(n.taskTitle)}」</div>`;
      if (n.responded) { html += `<div class="notif-responded">你已${n.response === 'accepted' ? '接受' : '拒绝'}了该邀请</div>`; }
      else { html += `<div class="notif-actions"><button class="notif-accept" onclick="respondNotif('${n.id}','accepted')">接受</button><button class="notif-reject" onclick="respondNotif('${n.id}','rejected')">拒绝</button></div>`; }
      return html + `</div>`;
    }).join('');
  } catch {}
}

async function respondNotif(notifId, response) {
  try {
    await api('/notifications/' + notifId + '/respond', { method: 'PUT', body: JSON.stringify({ response }) });
    await renderNotifications();
    updateNotificationBadge();
    await refreshData();
  } catch (e) { alert(e.message); }
}

// ============ Task Detail ============
function openDetail(taskId) {
  const task = cachedTasks.find(t => t.id === taskId);
  if (!task) return;
  const cc = getUserColor(task.creator);
  let body = '';
  body += `<div class="detail-section"><div class="detail-label">状态</div><div class="detail-value"><span class="my-task-status status-${task.status}" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>${task.status}${isOverdue(task) ? ' <span class="task-card-overdue-tag">已逾期</span>' : ''}</div></div>`;
  body += `<div class="detail-section"><div class="detail-label">描述</div><div class="detail-value">${task.description ? esc(task.description) : '无'}</div></div>`;
  body += `<div class="detail-section"><div class="detail-label">优先级</div><div class="detail-value"><span class="task-card-priority priority-${task.priority}">${task.priority}</span></div></div>`;
  body += `<div class="detail-section"><div class="detail-label">创建者</div><div class="detail-value"><span class="mini-badge" style="background:${cc};vertical-align:middle"></span> ${esc(task.creator)}</div></div>`;
  body += `<div class="detail-section"><div class="detail-label">负责人</div><div class="detail-value"><span class="mini-badge" style="background:${getUserColor(task.assignee)};vertical-align:middle"></span> ${esc(task.assignee)}</div></div>`;
  body += `<div class="detail-section"><div class="detail-label">截止日期</div><div class="detail-value">${task.dueDate || '未设置'}</div></div>`;
  if (task.startTime || task.endTime) body += `<div class="detail-section"><div class="detail-label">时间</div><div class="detail-value">${task.startTime || '?'} - ${task.endTime || '?'}</div></div>`;
  const parts = task.participants || [];
  if (parts.length > 0) {
    body += `<div class="detail-section"><div class="detail-label">参与者</div><div class="detail-participants">`;
    parts.forEach(p => {
      let sl, sc;
      if (p.myDone) { sl = '已完成'; sc = 'my-done'; } else if (p.status === 'accepted') { sl = '已接受'; sc = 'accepted'; }
      else if (p.status === 'rejected') { sl = '已拒绝'; sc = 'rejected'; } else { sl = '待回复'; sc = 'pending'; }
      body += `<div class="detail-participant"><span class="mini-badge" style="background:${getUserColor(p.username)}"></span>${esc(p.username)} <span class="part-status ${sc}">${sl}</span></div>`;
    });
    body += `</div></div>`;
  }
  document.getElementById('detailTitle').textContent = task.title;
  document.getElementById('detailBody').innerHTML = body;

  let footer = '';
  const locked = task.status === '已完成';
  const isCr = task.creator === currentUser.username, isAs = task.assignee === currentUser.username;
  const isPt = parts.some(p => p.username === currentUser.username && p.status === 'accepted');
  const canAct = !locked && (task.status === '待办' || task.status === '进行中');
  if (!locked) {
    if ((isCr || isAs) && canAct) footer += `<button class="btn-action btn-complete" onclick="completeTask('${task.id}')">标记已完成</button>`;
    if (isPt && canAct) {
      const myP = parts.find(p => p.username === currentUser.username);
      if (!myP.myDone) footer += `<button class="btn-action btn-my-done" onclick="markMyDone('${task.id}')">我的部分已完成</button>`;
      footer += `<button class="btn-action btn-complete" onclick="completeTask('${task.id}')">整个任务已完成</button>`;
    }
    if (isCr) {
      footer += `<button class="btn-action" style="background:#667eea;color:white" onclick="closeDetailModal();openTaskModal('${task.id}')">编辑</button>`;
      footer += `<button class="btn-action btn-delete" onclick="deleteTask('${task.id}')">删除</button>`;
    }
  } else { footer += `<span style="color:#10b981;font-weight:600">任务已完成（已锁定）</span>`; }
  document.getElementById('detailFooter').innerHTML = footer;
  document.getElementById('taskDetailModal').style.display = 'flex';
}

function closeDetailModal() { document.getElementById('taskDetailModal').style.display = 'none'; }

async function completeTask(taskId) {
  try { await api('/tasks/' + taskId + '/complete', { method: 'PUT' }); closeDetailModal(); await refreshData(); } catch (e) { alert(e.message); }
}
async function markMyDone(taskId) {
  try { await api('/tasks/' + taskId + '/my-done', { method: 'PUT' }); closeDetailModal(); await refreshData(); openDetail(taskId); } catch (e) { alert(e.message); }
}
async function deleteTask(taskId) {
  if (!confirm('确定要删除这个任务吗？')) return;
  try { await api('/tasks/' + taskId, { method: 'DELETE' }); closeDetailModal(); await refreshData(); } catch (e) { alert(e.message); }
}

// ============ User Management ============
function isAdmin() { return currentUser && currentUser.role === 'admin'; }

async function openUserManagement() {
  await renderUserList();
  document.getElementById('userMgmtModal').style.display = 'flex';
}
function closeUserMgmt() { document.getElementById('userMgmtModal').style.display = 'none'; }

async function renderUserList() {
  const users = await api('/users');
  const admin = isAdmin();
  let html = `<div class="user-mgmt-header"><h3>所有用户（${users.length}）</h3><button class="btn-change-pwd" onclick="openChangePwd()">修改我的密码</button></div><div class="user-list">`;
  users.forEach(u => {
    const isSelf = u.username === currentUser.username, isUA = u.role === 'admin';
    const cn = COLORS.find(c => c.hex === u.color);
    html += `<div class="user-row"><div class="user-row-badge" style="background:${u.color}"></div>`;
    html += `<div class="user-row-info"><div class="user-row-name">${esc(u.username)} `;
    if (isSelf) html += `<span class="user-self-tag">我</span> `;
    html += `<span class="user-row-role ${isUA ? 'role-admin' : 'role-user'}">${isUA ? '管理员' : '普通用户'}</span></div>`;
    html += `<div class="user-row-meta">颜色: ${cn ? cn.name : u.color}</div></div>`;
    if (admin && !isSelf) {
      html += `<div class="user-row-actions">`;
      html += isUA ? `<button class="btn-demote" onclick="toggleAdminRole('${esc(u.username)}',false)">取消管理员</button>`
                    : `<button class="btn-promote" onclick="toggleAdminRole('${esc(u.username)}',true)">设为管理员</button>`;
      html += `<button class="btn-del-user" onclick="deleteUserAdmin('${esc(u.username)}')">删除</button></div>`;
    }
    html += `</div>`;
  });
  document.getElementById('userMgmtBody').innerHTML = html + '</div>';
}

async function toggleAdminRole(username, makeAdmin) {
  try { await api('/users/' + encodeURIComponent(username) + '/role', { method: 'PUT', body: JSON.stringify({ role: makeAdmin ? 'admin' : 'user' }) }); await renderUserList(); } catch (e) { alert(e.message); }
}
async function deleteUserAdmin(username) {
  if (!confirm(`确定要删除用户「${username}」吗？`)) return;
  try { await api('/users/' + encodeURIComponent(username), { method: 'DELETE' }); await renderUserList(); await refreshData(); } catch (e) { alert(e.message); }
}

// ============ Change Password ============
function openChangePwd() {
  document.getElementById('oldPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('changePwdModal').style.display = 'flex';
}
function closeChangePwd() { document.getElementById('changePwdModal').style.display = 'none'; }

async function submitChangePwd() {
  const oldPassword = document.getElementById('oldPassword').value.trim();
  const newPassword = document.getElementById('newPassword').value.trim();
  const confirmPwd = document.getElementById('confirmPassword').value.trim();
  if (!oldPassword || !newPassword || !confirmPwd) return alert('请填写所有字段');
  if (newPassword !== confirmPwd) return alert('两次输入的新密码不一致');
  try { await api('/auth/password', { method: 'PUT', body: JSON.stringify({ oldPassword, newPassword }) }); alert('密码修改成功！'); closeChangePwd(); }
  catch (e) { alert(e.message); }
}

// ============ Close modals on backdrop click ============
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => { if (e.target === modal) { modal.style.display = 'none'; editingTaskId = null; } });
});
document.addEventListener('click', e => {
  const panel = document.getElementById('notificationPanel'), bell = document.querySelector('.notification-bell');
  if (panel.style.display === 'block' && !panel.contains(e.target) && !bell.contains(e.target)) panel.style.display = 'none';
});

// ============ Init ============
tryRestore();
