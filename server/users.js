'use strict';

// 가족용 간단 회원 저장소 (JSON 파일).
// 의존성 없이 crypto + fs 만 사용한다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json');

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') throw new Error('bad');
    obj.users = obj.users || {};
    obj.sessions = obj.sessions || {};
    return obj;
  } catch (e) {
    return { users: {}, sessions: {} };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt: salt, hash: hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    return false;
  }
}

function validateName(name) {
  name = String(name === null || name === undefined ? '' : name).trim();
  if (!name) return '이름을 입력해 주세요.';
  if (name.length > 12) return '이름은 12자 이내로 입력해 주세요.';
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return '이름에 제어 문자를 사용할 수 없습니다.';
  return null;
}

function register(name, password) {
  const err = validateName(name);
  if (err) throw new Error(err);
  name = String(name).trim();
  if (typeof password !== 'string' || password.length < 4) {
    throw new Error('비밀번호는 4자 이상이어야 합니다.');
  }
  const data = load();
  if (data.users[name]) throw new Error('이미 사용 중인 이름입니다.');
  const { salt, hash } = hashPassword(password);
  data.users[name] = {
    name: name,
    salt: salt,
    hash: hash,
    money: 300000,
    createdAt: Date.now(),
  };
  const token = crypto.randomUUID();
  data.sessions[token] = name;
  save(data);
  return { name: name, money: data.users[name].money, token: token };
}

function login(name, password) {
  name = String(name === null || name === undefined ? '' : name).trim();
  const data = load();
  const u = data.users[name];
  if (!u) throw new Error('이름 또는 비밀번호가 올바르지 않습니다.');
  if (!verifyPassword(password, u.salt, u.hash)) {
    throw new Error('이름 또는 비밀번호가 올바르지 않습니다.');
  }
  const token = crypto.randomUUID();
  data.sessions[token] = name;
  save(data);
  return { name: u.name, money: u.money, token: token };
}

function logout(token) {
  if (!token) return;
  const data = load();
  if (data.sessions[token]) {
    delete data.sessions[token];
    save(data);
  }
}

function userByToken(token) {
  if (!token) return null;
  const data = load();
  const name = data.sessions[token];
  if (!name) return null;
  const u = data.users[name];
  if (!u) return null;
  return { name: u.name, money: u.money };
}

function updateMoney(name, money) {
  if (!name) return;
  const data = load();
  const u = data.users[name];
  if (!u) return;
  u.money = Math.round(money);
  save(data);
}

function leaderboard(limit) {
  const data = load();
  const list = Object.values(data.users).map(function (u) {
    return { name: u.name, money: u.money, createdAt: u.createdAt };
  });
  list.sort(function (a, b) {
    if (b.money !== a.money) return b.money - a.money;
    return a.createdAt - b.createdAt;
  });
  return list.slice(0, limit || 20);
}

module.exports = {
  register: register,
  login: login,
  logout: logout,
  userByToken: userByToken,
  updateMoney: updateMoney,
  leaderboard: leaderboard,
  validateName: validateName,
};