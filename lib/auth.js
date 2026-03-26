const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { getDb } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '8h';
const COOKIE_NAME = 'ceo_session';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      team: user.team,
      display_name: user.display_name,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function getCurrentUser(req) {
  try {
    let token = null;

    // Try cookie first
    if (req.cookies && req.cookies[COOKIE_NAME]) {
      token = req.cookies[COOKIE_NAME];
    } else if (req.headers && req.headers.cookie) {
      const cookies = cookie.parse(req.headers.cookie);
      token = cookies[COOKIE_NAME] || null;
    }

    // Fall back to Authorization header
    if (!token && req.headers && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (!token) return null;

    const decoded = verifyToken(token);
    return {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      team: decoded.team,
      display_name: decoded.display_name,
    };
  } catch (e) {
    return null;
  }
}

function setAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60, // 8 hours
      path: '/',
    })
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    })
  );
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getCurrentUser,
  setAuthCookie,
  clearAuthCookie,
  COOKIE_NAME,
};
