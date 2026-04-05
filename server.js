const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

const app = express();
const server = http.createServer(app);

// WebSocket
const wss = new WebSocketServer({ server });
const wsClients = new Map(); // username -> Set<ws>

wss.on('connection', (ws, req) => {
  let username = null;
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'auth') {
        const payload = jwt.verify(data.token, JWT_SECRET);
        username = payload.username;
        if (!wsClients.has(username)) wsClients.set(username, new Set());
        wsClients.get(username).add(ws);
      }
    } catch {}
  });
  ws.on('close', () => {
    if (username && wsClients.has(username)) {
      wsClients.get(username).delete(ws);
      if (wsClients.get(username).size === 0) wsClients.delete(username);
    }
  });
});

function broadcast(data, excludeUser) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function notifyUser(username, data) {
  const clients = wsClients.get(username);
  if (clients) {
    const msg = JSON.stringify(data);
    clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'token已过期' });
  }
}

function adminOnly(req, res, next) {
  const user = db.findUser(req.user.username);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// ============ Auth Routes ============
app.post('/api/auth/register', (req, res) => {
  const { username, password, color } = req.body;
  if (!username || !password || !color) return res.status(400).json({ error: '缺少必填字段' });

  const users = db.getUsers();
  if (users.find(u => u.username === username)) return res.status(400).json({ error: '用户名已存在' });
  if (users.find(u => u.color === color)) return res.status(400).json({ error: '该颜色已被选择' });

  const hash = bcrypt.hashSync(password, 10);
  const isFirst = users.length === 0;
  db.createUser({ username, password: hash, color, role: isFirst ? 'admin' : 'user' });

  res.json({ message: isFirst ? '注册成功！你是第一位用户，已自动成为管理员' : '注册成功' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '缺少必填字段' });

  const user = db.findUser(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: user.username, color: user.color, role: user.role } });
});

app.put('/api/auth/password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '缺少必填字段' });

  const user = db.findUser(req.user.username);
  if (!user || !bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(400).json({ error: '当前密码错误' });
  }

  db.updateUser(req.user.username, { password: bcrypt.hashSync(newPassword, 10) });
  res.json({ message: '密码修改成功' });
});

// ============ User Routes ============
app.get('/api/users', auth, (req, res) => {
  const users = db.getUsers().map(u => ({ username: u.username, color: u.color, role: u.role }));
  res.json(users);
});

app.get('/api/users/colors', (req, res) => {
  const taken = db.getUsers().map(u => u.color);
  res.json(taken);
});

app.put('/api/users/:username/role', auth, adminOnly, (req, res) => {
  const { role } = req.body;
  if (req.params.username === req.user.username) return res.status(400).json({ error: '不能修改自己的角色' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: '无效的角色' });

  const updated = db.updateUser(req.params.username, { role });
  if (!updated) return res.status(404).json({ error: '用户不存在' });
  broadcast({ type: 'users_changed' });
  res.json({ message: '角色更新成功' });
});

app.delete('/api/users/:username', auth, adminOnly, (req, res) => {
  if (req.params.username === req.user.username) return res.status(400).json({ error: '不能删除自己' });
  const user = db.findUser(req.params.username);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  db.deleteUser(req.params.username);
  broadcast({ type: 'users_changed' });
  res.json({ message: '用户已删除' });
});

// ============ Task Routes ============
app.get('/api/tasks', auth, (req, res) => {
  runAutoStatus();
  res.json(db.getTasks());
});

app.post('/api/tasks', auth, (req, res) => {
  const { title, description, priority, assignee, dueDate, startTime, endTime, participants } = req.body;
  if (!title || !dueDate) return res.status(400).json({ error: '缺少必填字段' });

  const id = 'task_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const participantList = (participants || []).map(u => ({ username: u, status: 'pending', myDone: false }));

  const task = {
    id, title, description: description || '', priority: priority || '中',
    assignee: assignee || req.user.username, dueDate, startTime: startTime || '', endTime: endTime || '',
    creator: req.user.username, status: '待办', participants: participantList,
    createdAt: new Date().toISOString(),
  };

  db.createTask(task);

  // Send notifications to participants
  participantList.forEach(p => {
    const notif = {
      id: 'notif_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
      type: 'invite', to: p.username, from: req.user.username,
      taskId: id, taskTitle: title, responded: false, response: null,
      createdAt: new Date().toISOString(),
    };
    db.addNotification(notif);
    notifyUser(p.username, { type: 'notification', notif });
  });

  broadcast({ type: 'tasks_changed' });
  res.json(task);
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const task = db.findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator !== req.user.username) return res.status(403).json({ error: '只有创建者可以编辑' });
  if (task.status === '已完成') return res.status(400).json({ error: '已完成的任务不可编辑' });

  const { title, description, priority, assignee, dueDate, startTime, endTime, participants } = req.body;
  const newParticipants = (participants || []).map(u => {
    const existing = task.participants.find(p => p.username === u);
    return existing || { username: u, status: 'pending', myDone: false };
  });

  // Notify new participants
  const oldNames = task.participants.map(p => p.username);
  newParticipants.filter(p => !oldNames.includes(p.username)).forEach(p => {
    const notif = {
      id: 'notif_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
      type: 'invite', to: p.username, from: req.user.username,
      taskId: task.id, taskTitle: title || task.title, responded: false, response: null,
      createdAt: new Date().toISOString(),
    };
    db.addNotification(notif);
    notifyUser(p.username, { type: 'notification', notif });
  });

  const updated = db.replaceTask(req.params.id, {
    ...task,
    title: title || task.title, description: description !== undefined ? description : task.description,
    priority: priority || task.priority, assignee: assignee || task.assignee,
    dueDate: dueDate || task.dueDate, startTime: startTime !== undefined ? startTime : task.startTime,
    endTime: endTime !== undefined ? endTime : task.endTime, participants: newParticipants,
  });

  broadcast({ type: 'tasks_changed' });
  res.json(updated);
});

app.put('/api/tasks/:id/complete', auth, (req, res) => {
  const task = db.findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.status === '已完成') return res.status(400).json({ error: '任务已完成' });

  db.updateTask(req.params.id, { status: '已完成' });
  broadcast({ type: 'tasks_changed' });
  res.json({ message: '任务已标记完成' });
});

app.put('/api/tasks/:id/my-done', auth, (req, res) => {
  const task = db.findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.status === '已完成') return res.status(400).json({ error: '任务已完成' });

  const pIdx = task.participants.findIndex(p => p.username === req.user.username);
  if (pIdx === -1) return res.status(403).json({ error: '你不是参与者' });

  task.participants[pIdx].myDone = true;
  db.replaceTask(req.params.id, task);
  broadcast({ type: 'tasks_changed' });
  res.json({ message: '已标记我的部分完成' });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const task = db.findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.creator !== req.user.username) return res.status(403).json({ error: '只有创建者可以删除' });

  db.deleteTask(req.params.id);
  broadcast({ type: 'tasks_changed' });
  res.json({ message: '任务已删除' });
});

// ============ Notification Routes ============
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.getNotificationsFor(req.user.username));
});

app.get('/api/notifications/pending-count', auth, (req, res) => {
  res.json({ count: db.getPendingNotificationsFor(req.user.username).length });
});

app.put('/api/notifications/:id/respond', auth, (req, res) => {
  const { response } = req.body;
  if (!['accepted', 'rejected'].includes(response)) return res.status(400).json({ error: '无效的响应' });

  const notif = db.respondNotification(req.params.id, response);
  if (!notif) return res.status(404).json({ error: '通知不存在' });

  // Update participant status in task
  const task = db.findTask(notif.taskId);
  if (task) {
    const pIdx = task.participants.findIndex(p => p.username === req.user.username);
    if (pIdx !== -1) {
      task.participants[pIdx].status = response;
      db.replaceTask(notif.taskId, task);
    }
  }

  broadcast({ type: 'tasks_changed' });
  res.json({ message: response === 'accepted' ? '已接受邀请' : '已拒绝邀请' });
});

// ============ Auto Status ============
function runAutoStatus() {
  const tasks = db.getTasks();
  const now = new Date();
  let changed = false;

  tasks.forEach(task => {
    if (task.status === '已完成') return;
    if (task.status === '待办' && task.dueDate && task.startTime) {
      const start = new Date(task.dueDate + 'T' + task.startTime);
      if (now >= start) { task.status = '进行中'; changed = true; }
    }
    if (task.dueDate && task.endTime) {
      const end = new Date(task.dueDate + 'T' + task.endTime);
      if (now > end && task.status !== '已完成' && task.priority !== '高') {
        task.priority = '高'; changed = true;
      }
    }
  });

  if (changed) db.setTasks(tasks);
}

// Run auto status every 30s
setInterval(runAutoStatus, 30000);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
