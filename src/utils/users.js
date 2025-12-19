import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import config from './config.js';
import logger from './logger.js';

const USERS_FILE = path.join(config.paths.data, 'users.json');

function ensureFile() {
  if (!fs.existsSync(USERS_FILE)) {
    const initial = { admin: [], maintenance: [] };
    fs.writeFileSync(USERS_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

export function listUsers(role) {
  try {
    ensureFile();
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return (data[role] || []).map(u => ({ username: u.username }));
  } catch (err) {
    logger.error('List users error', { error: err.message });
    return [];
  }
}

export function addUser(role, username, passwordPlain) {
  try {
    ensureFile();
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    data[role] = data[role] || [];
    if (data[role].some(u => u.username === username)) {
      return { ok: false, error: 'User already exists' };
    }
    const hash = bcrypt.hashSync(passwordPlain, 10);
    data[role].push({ username, hash });
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    logger.error('Add user error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

export function removeUser(role, username) {
  try {
    ensureFile();
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    data[role] = (data[role] || []).filter(u => u.username !== username);
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    logger.error('Remove user error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

export function verifyUser(role, username, passwordPlain) {
  try {
    ensureFile();
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = (data[role] || []).find(u => u.username === username);
    if (!user) return false;
    return bcrypt.compareSync(passwordPlain, user.hash);
  } catch (err) {
    logger.error('Verify user error', { error: err.message });
    return false;
  }
}
