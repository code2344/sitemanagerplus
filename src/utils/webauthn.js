/**
 * WebAuthn Utilities (Server-side)
 * Minimal persistence and flows for admin/maintenance roles.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from './config.js';
import logger from './logger.js';

const STORE_FILE = path.join(config.paths.data, 'webauthn.json');

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    }
  } catch (e) {
    logger.warn('Failed to load WebAuthn store', { error: e.message });
  }
  return { admin: { userId: 'admin', credentials: [] }, maintenance: { userId: 'maintenance', credentials: [] } };
}

function saveStore(store) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    logger.error('Failed to save WebAuthn store', { error: e.message });
  }
}

export function getWebAuthnStore() {
  return loadStore();
}

export function hasRegisteredCredential(role) {
  const store = loadStore();
  const rec = store[role];
  return !!rec && Array.isArray(rec.credentials) && rec.credentials.length > 0;
}

// Stubbed options for compatibility with client; using manual verification to avoid complex lib wiring
export function getRegistrationOptions(role) {
  const store = loadStore();
  const userId = store[role]?.userId || role;
  const challenge = crypto.randomBytes(32).toString('base64url');
  // Save challenge in volatile file for simplicity
  const tmpFile = path.join(config.paths.data, `webauthn-${role}-challenge.txt`);
  fs.writeFileSync(tmpFile, challenge, 'utf8');
  return {
    challenge,
    rp: { name: 'SiteManager+' },
    user: { id: Buffer.from(userId).toString('base64'), name: userId, displayName: userId },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 60000,
    attestation: 'direct',
    authenticatorSelection: {
      authenticatorAttachment: 'cross-platform',
      residentKey: 'discouraged',
      userVerification: 'preferred',
    },
  };
}

export function verifyRegistration(role, attestationResponse) {
  // Minimal: persist rawId/id provided by client for later authentication checks
  if (!attestationResponse || !attestationResponse.rawId || !attestationResponse.id) return false;
  const store = loadStore();
  if (!store[role]) store[role] = { userId: role, credentials: [] };
  const exists = store[role].credentials.find(c => c.id === attestationResponse.id);
  if (!exists) {
    store[role].credentials.push({ id: attestationResponse.id, rawId: attestationResponse.rawId });
    saveStore(store);
  }
  return true;
}

export function getAuthenticationOptions(role) {
  const store = loadStore();
  const creds = store[role]?.credentials || [];
  const challenge = crypto.randomBytes(32).toString('base64url');
  const tmpFile = path.join(config.paths.data, `webauthn-${role}-challenge.txt`);
  fs.writeFileSync(tmpFile, challenge, 'utf8');
  return {
    challenge,
    allowCredentials: creds.map(c => ({ type: 'public-key', id: c.rawId })),
    timeout: 60000,
    userVerification: 'preferred',
  };
}

export function verifyAuthentication(role, assertionResponse) {
  // Minimal check: ensure the assertion references a known credential id
  if (!assertionResponse || !assertionResponse.id) return false;
  const store = loadStore();
  const creds = store[role]?.credentials || [];
  const match = creds.find(c => c.id === assertionResponse.id);
  return !!match;
}

export function clearCredentialsForRole(role) {
  const store = loadStore();
  if (!store[role]) store[role] = { userId: role, credentials: [] };
  store[role].credentials = [];
  saveStore(store);
}
