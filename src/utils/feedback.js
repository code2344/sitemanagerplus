/**
 * Feedback Management
 * 
 * Persistent storage for element-level feedback submissions.
 * Supports:
 * - Feedback item creation and management
 * - Comment threads on feedback items
 * - Screenshot file storage and cleanup
 * - Status tracking (open/resolved/archived)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from './config.js';
import logger from './logger.js';

const FEEDBACK_FILE = path.join(config.paths.data, 'feedback.json');
const SCREENSHOTS_DIR = path.join(config.paths.data, 'feedback-screenshots');

/**
 * Ensure directories exist
 */
function ensureDirectories() {
  if (!fs.existsSync(FEEDBACK_FILE)) {
    const initial = { feedback: [] };
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

/**
 * Load feedback data
 */
function loadFeedback() {
  try {
    ensureDirectories();
    const data = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
    return data.feedback || [];
  } catch (err) {
    logger.error('Load feedback error', { error: err.message });
    return [];
  }
}

/**
 * Save feedback data
 */
function saveFeedback(feedback) {
  try {
    ensureDirectories();
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify({ feedback }, null, 2), 'utf8');
  } catch (err) {
    logger.error('Save feedback error', { error: err.message });
    throw err;
  }
}

/**
 * Create a new feedback item
 */
export function createFeedback(payload) {
  try {
    const {
      page,
      element,
      type = 'suggestion', // bug, suggestion, question, typo
      message,
      screenshotBase64,
      submittedBy,
      submittedByRole,
    } = payload;

    if (!page || !element || !message || !submittedBy) {
      return { ok: false, error: 'Missing required fields' };
    }

    const feedback = loadFeedback();
    const id = crypto.randomBytes(8).toString('hex');
    let screenshotPath = null;

    // Save screenshot if provided
    if (screenshotBase64) {
      try {
        const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        screenshotPath = `${id}.png`;
        const screenshotFile = path.join(SCREENSHOTS_DIR, screenshotPath);
        fs.writeFileSync(screenshotFile, buffer);
      } catch (err) {
        logger.error('Save screenshot error', { error: err.message });
        // Continue without screenshot
      }
    }

    const newFeedback = {
      id,
      timestamp: new Date().toISOString(),
      page,
      element,
      type,
      message,
      screenshotPath,
      submittedBy,
      submittedByRole,
      status: 'open', // open, resolved, archived
      comments: [],
      resolvedBy: null,
      resolvedAt: null,
      adminNotes: null,
    };

    feedback.push(newFeedback);
    saveFeedback(feedback);

    logger.info('Feedback created', { id, page, submittedBy });
    return { ok: true, id, feedback: newFeedback };
  } catch (err) {
    logger.error('Create feedback error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Get all feedback items
 */
export function listFeedback(filters = {}) {
  try {
    let feedback = loadFeedback();

    // Apply filters
    if (filters.status) {
      feedback = feedback.filter(f => f.status === filters.status);
    }
    if (filters.type) {
      feedback = feedback.filter(f => f.type === filters.type);
    }
    if (filters.page) {
      feedback = feedback.filter(f => f.page === filters.page);
    }
    if (filters.submittedBy) {
      feedback = feedback.filter(f => f.submittedBy === filters.submittedBy);
    }

    // Sort by timestamp descending
    feedback.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return { ok: true, feedback };
  } catch (err) {
    logger.error('List feedback error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Get a specific feedback item
 */
export function getFeedback(id) {
  try {
    const feedback = loadFeedback();
    const item = feedback.find(f => f.id === id);
    if (!item) {
      return { ok: false, error: 'Feedback not found' };
    }
    return { ok: true, feedback: item };
  } catch (err) {
    logger.error('Get feedback error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Add a comment to feedback
 */
export function addComment(id, payload) {
  try {
    const { message, username, role } = payload;

    if (!message || !username) {
      return { ok: false, error: 'Missing required fields' };
    }

    const feedback = loadFeedback();
    const item = feedback.find(f => f.id === id);

    if (!item) {
      return { ok: false, error: 'Feedback not found' };
    }

    const comment = {
      id: crypto.randomBytes(8).toString('hex'),
      timestamp: new Date().toISOString(),
      username,
      role,
      message,
    };

    item.comments.push(comment);
    saveFeedback(feedback);

    logger.info('Comment added', { feedbackId: id, commentId: comment.id, username });
    return { ok: true, comment };
  } catch (err) {
    logger.error('Add comment error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Resolve feedback (admin only)
 */
export function resolveFeedback(id, payload) {
  try {
    const { resolvedBy, adminNotes } = payload;

    if (!resolvedBy) {
      return { ok: false, error: 'Missing resolvedBy' };
    }

    const feedback = loadFeedback();
    const item = feedback.find(f => f.id === id);

    if (!item) {
      return { ok: false, error: 'Feedback not found' };
    }

    item.status = 'resolved';
    item.resolvedBy = resolvedBy;
    item.resolvedAt = new Date().toISOString();
    item.adminNotes = adminNotes || null;

    saveFeedback(feedback);

    logger.info('Feedback resolved', { id, resolvedBy });
    return { ok: true, feedback: item };
  } catch (err) {
    logger.error('Resolve feedback error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Delete feedback and associated screenshot (admin only)
 */
export function deleteFeedback(id) {
  try {
    const feedback = loadFeedback();
    const itemIndex = feedback.findIndex(f => f.id === id);

    if (itemIndex === -1) {
      return { ok: false, error: 'Feedback not found' };
    }

    const item = feedback[itemIndex];

    // Delete screenshot if exists
    if (item.screenshotPath) {
      try {
        const screenshotFile = path.join(SCREENSHOTS_DIR, item.screenshotPath);
        if (fs.existsSync(screenshotFile)) {
          fs.unlinkSync(screenshotFile);
        }
      } catch (err) {
        logger.warn('Failed to delete screenshot', { error: err.message });
      }
    }

    feedback.splice(itemIndex, 1);
    saveFeedback(feedback);

    logger.info('Feedback deleted', { id });
    return { ok: true };
  } catch (err) {
    logger.error('Delete feedback error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Get screenshot as base64 (for display in UI)
 */
export function getScreenshotBase64(screenshotPath) {
  try {
    if (!screenshotPath) {
      return null;
    }
    const filePath = path.join(SCREENSHOTS_DIR, screenshotPath);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    return 'data:image/png;base64,' + buffer.toString('base64');
  } catch (err) {
    logger.error('Get screenshot error', { error: err.message });
    return null;
  }
}

/**
 * Clean up old feedback (optional maintenance)
 */
export function archiveOldFeedback(daysOld = 30) {
  try {
    const feedback = loadFeedback();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const archived = feedback.map(f => {
      if (f.status === 'resolved' && new Date(f.resolvedAt) < cutoff) {
        f.status = 'archived';
      }
      return f;
    });

    saveFeedback(archived);
    logger.info('Old feedback archived', { daysOld });
    return { ok: true };
  } catch (err) {
    logger.error('Archive feedback error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

// ============================================================================
// Feedback State Management (Enable/Disable)
// ============================================================================

const FEEDBACK_STATE_FILE = path.join(config.paths.data, 'feedback-state.json');

/**
 * Load feedback enabled state
 */
function loadFeedbackState() {
  try {
    ensureDirectories();
    if (!fs.existsSync(FEEDBACK_STATE_FILE)) {
      const initial = { enabled: true };
      fs.writeFileSync(FEEDBACK_STATE_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const data = JSON.parse(fs.readFileSync(FEEDBACK_STATE_FILE, 'utf8'));
    return data;
  } catch (err) {
    logger.error('Load feedback state error', { error: err.message });
    return { enabled: true };
  }
}

/**
 * Save feedback enabled state
 */
function saveFeedbackState(state) {
  try {
    ensureDirectories();
    fs.writeFileSync(FEEDBACK_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    logger.error('Save feedback state error', { error: err.message });
    throw err;
  }
}

/**
 * Check if feedback is enabled
 */
export function isFeedbackEnabled() {
  const state = loadFeedbackState();
  return state.enabled === true;
}

/**
 * Toggle feedback enabled state
 */
export function toggleFeedback() {
  try {
    const state = loadFeedbackState();
    state.enabled = !state.enabled;
    saveFeedbackState(state);
    logger.info('Feedback toggled', { enabled: state.enabled });
    return { ok: true, enabled: state.enabled };
  } catch (err) {
    logger.error('Toggle feedback error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Set feedback state explicitly
 */
export function setFeedbackEnabled(enabled) {
  try {
    const state = { enabled: !!enabled };
    saveFeedbackState(state);
    logger.info('Feedback state set', { enabled });
    return { ok: true, enabled };
  } catch (err) {
    logger.error('Set feedback state error', { error: err.message });
    return { ok: false, error: err.message };
  }
}
