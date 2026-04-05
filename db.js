const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

const DEFAULT_DATA = {
  users: [],
  tasks: [],
  notifications: [],
};

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Users ---
function getUsers() { return load().users; }

function findUser(username) {
  return load().users.find(u => u.username === username) || null;
}

function createUser(user) {
  const data = load();
  data.users.push(user);
  save(data);
}

function updateUser(username, updates) {
  const data = load();
  const idx = data.users.findIndex(u => u.username === username);
  if (idx === -1) return null;
  Object.assign(data.users[idx], updates);
  save(data);
  return data.users[idx];
}

function deleteUser(username) {
  const data = load();
  data.users = data.users.filter(u => u.username !== username);
  data.notifications = data.notifications.filter(n => n.to !== username && n.from !== username);
  save(data);
}

// --- Tasks ---
function getTasks() { return load().tasks; }

function findTask(id) {
  return load().tasks.find(t => t.id === id) || null;
}

function createTask(task) {
  const data = load();
  data.tasks.push(task);
  save(data);
}

function updateTask(id, updates) {
  const data = load();
  const idx = data.tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  Object.assign(data.tasks[idx], updates);
  save(data);
  return data.tasks[idx];
}

function replaceTask(id, task) {
  const data = load();
  const idx = data.tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  data.tasks[idx] = task;
  save(data);
  return task;
}

function deleteTask(id) {
  const data = load();
  data.tasks = data.tasks.filter(t => t.id !== id);
  data.notifications = data.notifications.filter(n => n.taskId !== id);
  save(data);
}

function setTasks(tasks) {
  const data = load();
  data.tasks = tasks;
  save(data);
}

// --- Notifications ---
function getNotifications() { return load().notifications; }

function getNotificationsFor(username) {
  return load().notifications.filter(n => n.to === username);
}

function getPendingNotificationsFor(username) {
  return load().notifications.filter(n => n.to === username && !n.responded);
}

function addNotification(notif) {
  const data = load();
  // Prevent duplicate pending invites
  const dup = data.notifications.find(n =>
    n.to === notif.to && n.taskId === notif.taskId && n.type === 'invite' && !n.responded
  );
  if (dup) return;
  data.notifications.push(notif);
  save(data);
}

function respondNotification(notifId, response) {
  const data = load();
  const idx = data.notifications.findIndex(n => n.id === notifId);
  if (idx === -1) return null;
  data.notifications[idx].responded = true;
  data.notifications[idx].response = response;
  save(data);
  return data.notifications[idx];
}

module.exports = {
  getUsers, findUser, createUser, updateUser, deleteUser,
  getTasks, findTask, createTask, updateTask, replaceTask, deleteTask, setTasks,
  getNotifications, getNotificationsFor, getPendingNotificationsFor, addNotification, respondNotification,
};
