/**
 * Authentication & Authorization
 * 
 * Provides:
 * - Basic authentication for admin routes
 * - Role-based access control
 * - Rate limiting for sensitive endpoints
 * - Secure credential handling
 */

import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { verifyUser } from './users.js';
import { getWebAuthnStore, getRegistrationOptions, verifyRegistration, getAuthenticationOptions, verifyAuthentication, clearCredentialsForRole, hasRegisteredCredential } from './webauthn.js';

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 10; // Max failed attempts

// Track failed login attempts by IP
const loginAttempts = new Map();

// Default session lifetime: 2 hours
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const pairs = header.split(';').map(c => c.trim()).filter(Boolean);
  const cookies = {};
  for (const p of pairs) {
    const idx = p.indexOf('=');
    if (idx > -1) {
      const k = p.slice(0, idx);
      const v = decodeURIComponent(p.slice(idx + 1));
      cookies[k] = v;
    }
  }
  return cookies;
}

function setSessionCookie(res, token, path = '/') {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toUTCString();
  res.setHeader('Set-Cookie', `smplus_sid=${encodeURIComponent(token)}; Path=${path}; HttpOnly; SameSite=Lax; Expires=${expires}`);
}

function clearSessionCookie(res, path = '/') {
  const expires = new Date(0).toUTCString();
  res.setHeader('Set-Cookie', `smplus_sid=; Path=${path}; HttpOnly; SameSite=Lax; Expires=${expires}`);
}

// Stateless token: base64url(payload).base64url(hmac)
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sign(data) {
  return b64url(crypto.createHmac('sha256', config.auth.sessionSecret).update(data).digest());
}

function createToken(username, role, hwVerified = false) {
  const payload = {
    u: username,
    r: role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
    jti: uuidv4(),
    hw: !!hwVerified,
  };
  const data = b64url(JSON.stringify(payload));
  const mac = sign(data);
  return `${data}.${mac}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, mac] = parts;
  const expected = sign(data);
  const bMac = Buffer.from(mac);
  const bExp = Buffer.from(expected);
  if (bMac.length !== bExp.length) return null;
  if (!crypto.timingSafeEqual(bMac, bExp)) return null;
  try {
    const json = JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (json.exp && Date.now() / 1000 > json.exp) return null;
    return { username: json.u, role: json.r, hw: !!json.hw };
  } catch {
    return null;
  }
}

function destroySession(_sid) {
  // Stateless: nothing to do server-side
}

/**
 * Check rate limit for login attempts
 */
function checkRateLimit(ip) {
  const now = Date.now();
  let attempts = loginAttempts.get(ip) || [];
  
  // Clean old attempts
  attempts = attempts.filter(timestamp => (now - timestamp) < RATE_LIMIT_WINDOW);
  
  if (attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    logger.warn('Rate limit exceeded for login', { ip });
    return false;
  }

  loginAttempts.set(ip, attempts);
  return true;
}

/**
 * Record failed login attempt
 */
function recordFailedAttempt(ip) {
  const attempts = loginAttempts.get(ip) || [];
  attempts.push(Date.now());
  loginAttempts.set(ip, attempts);

  if (attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    logger.warn('Multiple failed login attempts', {
      ip,
      attempts: attempts.length,
    });
  }
}

/**
 * Clear rate limit for IP (successful login)
 */
function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

/**
 * Basic authentication middleware
 * Checks Authorization header with username:password in base64
 */
export function basicAuth(allowedRole = 'admin') {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    const ip = req.ip;

    // Check rate limit
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        error: 'Too many login attempts. Please try again later.',
      });
    }

    // Missing auth header
    if (!auth || !auth.startsWith('Basic ')) {
      // Do NOT send WWW-Authenticate to avoid browser Basic Auth prompt
      return res.status(401).json({ error: 'Unauthorized - missing credentials' });
    }

    try {
      // Decode base64 credentials
      const encoded = auth.slice(6);
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const [username, password] = decoded.split(':');

      // Get allowed credentials based on role
      // Validate against users store first, then fallback to single user from config
      let credentialsValid = verifyUser(allowedRole === 'maintenance' ? 'maintenance' : 'admin', username, password);
      if (!credentialsValid) {
        let allowedUsername, allowedPassword;
        if (allowedRole === 'maintenance') {
          allowedUsername = config.maintenanceAuth.username;
          allowedPassword = config.maintenanceAuth.password;
        } else {
          allowedUsername = config.admin.username;
          allowedPassword = config.admin.password;
        }
        credentialsValid = username === allowedUsername && password === allowedPassword;
      }

      if (!credentialsValid) {
        recordFailedAttempt(ip);
        logger.warn('Failed authentication attempt', {
          ip,
          attempted_username: username,
          role: allowedRole,
        });
        return res.status(401).json({ error: 'Unauthorized - invalid credentials' });
      }

      // Success: clear rate limit and continue
      clearRateLimit(ip);
      req.user = { username, role: allowedRole };
      next();

    } catch (err) {
      logger.error('Authentication error', {
        error: err.message,
        ip,
      });
      res.status(401).json({ error: 'Unauthorized - invalid format' });
    }
  };
}

/**
 * Check if request is authenticated
 */
export function isAuthenticated(req) {
  return !!req.user;
}

/**
 * Check if request user has a specific role
 */
export function hasRole(req, role) {
  return req.user && req.user.role === role;
}

/**
 * Rate limiting middleware for sensitive endpoints
 */
export function rateLimit(windowMs = 60000, maxRequests = 100) {
  const requestCounts = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();

    let requests = requestCounts.get(key) || [];
    requests = requests.filter(timestamp => (now - timestamp) < windowMs);

    if (requests.length >= maxRequests) {
      logger.warn('Rate limit exceeded', {
        ip: key,
        windowMs,
        maxRequests,
      });
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
      });
    }

    requests.push(now);
    requestCounts.set(key, requests);

    next();
  };
}

/**
 * HTML login page generator
 */
function renderLoginPage(panelPath = '/', roleLabel = 'Admin', errorMsg = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${roleLabel} Sign In</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b1020;color:#e8eef9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#121a33;border:1px solid #2a355a;border-radius:12px;max-width:360px;width:100%;padding:24px;box-shadow:0 8px 20px rgba(0,0,0,.35)}
    h1{font-size:20px;margin:0 0 16px}
    label{display:block;font-size:13px;margin:10px 0 6px;color:#a9b5d9}
    input{width:100%;padding:10px 12px;border:1px solid #3b4a79;border-radius:8px;background:#0b1020;color:#e8eef9}
    input:focus{outline:none;border-color:#6e8cff;box-shadow:0 0 0 3px rgba(110,140,255,.15)}
    .btn{width:100%;margin-top:16px;padding:10px 12px;background:#5a78ff;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer}
    .btn:hover{background:#4e68e0}
    .hint{margin-top:12px;font-size:12px;color:#8fa0c9}
    .error{background:#2a1a1a;color:#ffd6d6;border:1px solid #5a2a2a;padding:8px;border-radius:8px;margin-bottom:12px}
  </style>
</head>
<body>
  <div class="card">
    <h1>${roleLabel} Sign In</h1>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
    <form method="post" action="${panelPath}/login">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="btn" type="submit">Sign In</button>
    </form>
    <div class="hint">Access is restricted to authorized ${roleLabel.toLowerCase()}s.</div>
  </div>
  <script>window.history.replaceState(null,'',window.location.pathname)</script>
  </body>
</html>`;
}

/**
 * Session-based auth middleware: checks cookie first, then Basic header (without prompting)
 */
export function sessionAuth(requiredRole = 'admin', panelPath = '/') {
  return (req, res, next) => {
    const cookies = parseCookies(req);
    const sid = cookies.smplus_sid;
    const payload = verifyToken(sid);

    // Prefer a valid token
    if (payload && payload.role === requiredRole) {
      // Enforce hardware key if registered for this role
      const requireHW = hasRegisteredCredential(requiredRole);
      if (requireHW && !payload.hw) {
        // Serve hardware verification page
        res.status(401);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const roleLabel = requiredRole === 'maintenance' ? 'Ops' : 'Admin';
        return res.send(renderHWRequiredPage(panelPath, roleLabel));
      }
      req.user = { username: payload.username, role: payload.role };
      return next();
    }

    // Fallback: allow valid Basic header without sending challenge
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Basic ')) {
      try {
        const encoded = auth.slice(6);
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const [username, password] = decoded.split(':');

        let allowedUsername, allowedPassword;
        if (requiredRole === 'maintenance') {
          allowedUsername = config.maintenanceAuth.username;
          allowedPassword = config.maintenanceAuth.password;
        } else {
          allowedUsername = config.admin.username;
          allowedPassword = config.admin.password;
        }

        if (username === allowedUsername && password === allowedPassword) {
          // If credential is registered, require hardware key via page
          const requireHW = hasRegisteredCredential(requiredRole);
          if (requireHW) {
            res.status(401);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            const roleLabel = requiredRole === 'maintenance' ? 'Ops' : 'Admin';
            return res.send(renderHWRequiredPage(panelPath, roleLabel));
          }
          req.user = { username, role: requiredRole };
          return next();
        }
      } catch (e) {
        // ignore and fall through to login page
      }
    }

    // Not authenticated: serve login page for HTML navigations
    if ((req.headers.accept || '').includes('text/html') || req.method === 'GET') {
      res.status(401);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const roleLabel = requiredRole === 'maintenance' ? 'Ops' : 'Admin';
      return res.send(renderLoginPage(panelPath, roleLabel));
    }

    // API request
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

/**
 * Handlers: login and logout for panel
 */
export function loginHandlers(requiredRole = 'admin', panelPath = '/') {
  const roleLabel = requiredRole === 'maintenance' ? 'Ops' : 'Admin';

  const getLogin = (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const err = typeof req.query?.e === 'string' && req.query.e ? 'Invalid username or password' : '';
    res.send(renderLoginPage(panelPath, roleLabel, err));
  };

  const postLogin = (req, res) => {
    try {
      const { username, password } = req.body || {};

      let credentialsValid = verifyUser(requiredRole === 'maintenance' ? 'maintenance' : 'admin', username, password);
      if (!credentialsValid) {
        let allowedUsername, allowedPassword;
        if (requiredRole === 'maintenance') {
          allowedUsername = config.maintenanceAuth.username;
          allowedPassword = config.maintenanceAuth.password;
        } else {
          allowedUsername = config.admin.username;
          allowedPassword = config.admin.password;
        }
        credentialsValid = username === allowedUsername && password === allowedPassword;
      }
      if (!credentialsValid) {
        // Clear any existing bad session
        clearSessionCookie(res, panelPath);
        recordFailedAttempt(req.ip);
        logger.warn('Panel login failed', { panelPath, role: requiredRole, ip: req.ip, attempted_username: username });
        res.status(302);
        res.setHeader('Location', `${panelPath}/login?e=1`);
        return res.end();
      }

      // Success: decide if HW required
      const requireHW = hasRegisteredCredential(requiredRole);
      const token = createToken(username, requiredRole, !requireHW);
      setSessionCookie(res, token, panelPath);
      clearRateLimit(req.ip);
      res.status(302);
      res.setHeader('Location', requireHW ? `${panelPath}/hw` : panelPath + '/');
      return res.end();
    } catch (err) {
      logger.error('Login error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  const postLogout = (req, res) => {
    const cookies = parseCookies(req);
    const sid = cookies.smplus_sid;
    destroySession(sid);
    clearSessionCookie(res, panelPath);
    res.status(302);
    res.setHeader('Location', panelPath + '/login');
    return res.end();
  };

  return { getLogin, postLogin, postLogout };
}

/**
 * Hardware key required page
 */
function renderHWRequiredPage(panelPath = '/', roleLabel = 'Admin') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${roleLabel} • Hardware Key</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b1020;color:#e8eef9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#121a33;border:1px solid #2a355a;border-radius:12px;max-width:420px;width:100%;padding:24px;box-shadow:0 8px 20px rgba(0,0,0,.35)}
    h1{font-size:20px;margin:0 0 12px}
    .btn{width:100%;margin-top:12px;padding:10px 12px;background:#5a78ff;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer}
    .btn:hover{background:#4e68e0}
    .hint{margin-top:12px;font-size:12px;color:#8fa0c9}
    .error{background:#2a1a1a;color:#ffd6d6;border:1px solid #5a2a2a;padding:8px;border-radius:8px;margin-bottom:12px;display:none}
  </style>
  <script>
    async function startAuth(){
      try {
        const resp = await fetch('${panelPath}/webauthn/start', { method: 'POST' });
        const opts = await resp.json();
        const b64urlToUint8 = (s) => { const pad = (str) => str + '==='.slice((str.length + 3) % 4); const base64 = pad(s.replace(/-/g, '+').replace(/_/g, '/')); const bin = atob(base64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return arr.buffer; };
        const publicKey = { ...opts };
        if (typeof publicKey.challenge === 'string') publicKey.challenge = b64urlToUint8(publicKey.challenge);
        if (Array.isArray(publicKey.allowCredentials)) publicKey.allowCredentials = publicKey.allowCredentials.map(c => ({ ...c, id: typeof c.id === 'string' ? b64urlToUint8(c.id) : c.id }));
        const cred = await navigator.credentials.get({ publicKey });
        const clientDataJSON = btoa(String.fromCharCode(...new Uint8Array(cred.response.clientDataJSON)));
        const authenticatorData = btoa(String.fromCharCode(...new Uint8Array(cred.response.authenticatorData)));
        const signature = btoa(String.fromCharCode(...new Uint8Array(cred.response.signature)));
        const rawId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
        const data = { id: cred.id, rawId, type: cred.type, response: { clientDataJSON, authenticatorData, signature, userHandle: cred.response.userHandle ? btoa(String.fromCharCode(...new Uint8Array(cred.response.userHandle))) : null } };
        const verify = await fetch('${panelPath}/webauthn/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!verify.ok) { document.getElementById('err').style.display='block'; return; }
        window.location.href = '${panelPath}/';
      } catch (e) {
        console.error('HW verify error', e);
        document.getElementById('err').style.display='block';
      }
    }
  </script>
</head>
<body>
  <div class="card">
    <h1>Hardware Key Required</h1>
    <div id="err" class="error">Verification failed. Try again.</div>
    <p>Touch your security key to continue.</p>
    <button class="btn" onclick="startAuth()">Verify Hardware Key</button>
    <div class="hint">If you lost access, contact support to reset with OTP.</div>
  </div>
</body>
</html>`;
}

export function hardwareRoutes(requiredRole = 'admin', panelPath = '/') {
  const roleLabel = requiredRole === 'maintenance' ? 'Ops' : 'Admin';

  const getHW = (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderHWRequiredPage(panelPath, roleLabel));
  };

  const startAuth = (req, res) => {
    try {
      const opts = getAuthenticationOptions(requiredRole);
      res.json(opts);
    } catch (err) {
      logger.error('Start WebAuthn auth error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  const verifyAuth = (req, res) => {
    try {
      const ok = verifyAuthentication(requiredRole, req.body);
      if (!ok) return res.status(401).json({ error: 'Invalid hardware key' });
      // Issue a new session token with hwVerified
      const cookies = parseCookies(req);
      const sid = cookies.smplus_sid;
      const payload = verifyToken(sid);
      if (!payload) return res.status(401).json({ error: 'Session missing' });
      const token = createToken(payload.username, payload.role, true);
      setSessionCookie(res, token, panelPath);
      res.json({ status: 'success' });
    } catch (err) {
      logger.error('Verify WebAuthn auth error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  const startRegister = (req, res) => {
    try {
      const opts = getRegistrationOptions(requiredRole);
      res.json(opts);
    } catch (err) {
      logger.error('Start WebAuthn reg error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  const verifyRegister = (req, res) => {
    try {
      const ok = verifyRegistration(requiredRole, req.body);
      if (!ok) return res.status(400).json({ error: 'Registration failed' });
      res.json({ status: 'success' });
    } catch (err) {
      logger.error('Verify WebAuthn reg error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  const resetHW = (req, res) => {
    try {
      const { otp } = req.body || {};
      if (!validateOTP(otp)) return res.status(401).json({ error: 'Invalid OTP' });
      clearCredentialsForRole(requiredRole);
      res.json({ status: 'success', message: 'Hardware key reset. Please re-register.' });
    } catch (err) {
      logger.error('Reset HW error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  return { getHW, startAuth, verifyAuth, startRegister, verifyRegister, resetHW };
}

// OTP validation compatible with bin/otp.sh
function validateOTP(otp) {
  if (!otp || !/^[0-9]{6}$/.test(otp)) return false;
  const secret = config.auth.sessionSecret;
  const now = Math.floor(Date.now() / 60000); // minute counter
  for (let i = 0; i < 5; i++) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(now - i));
    const hmac = crypto.createHmac('sha256', secret).update(counter).digest();
    const code = (hmac.readUInt32BE(0) % 1000000).toString().padStart(6, '0');
    if (code === otp) return true;
  }
  return false;
}
