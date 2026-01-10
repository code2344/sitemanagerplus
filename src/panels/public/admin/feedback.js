/**
 * Feedback Admin UI Script
 */

// Determine the API base URL based on current location
const apiBase = window.location.pathname.includes('/maintenance/') ? '/maintenance' : '/admin';

let allFeedback = [];
let allPages = new Set();
let allSubmitters = new Set();

const statusEl = document.getElementById('status');
const listEl = document.getElementById('feedbackList');
const btnRefresh = document.getElementById('btnRefresh');
const filterStatus = document.getElementById('filterStatus');
const filterType = document.getElementById('filterType');
const filterPage = document.getElementById('filterPage');
const filterSubmitter = document.getElementById('filterSubmitter');
const modalOverlay = document.getElementById('modalOverlay');
const screenshotModal = document.getElementById('screenshotModal');
const modalClose = document.getElementById('modalClose');
const modalImage = document.getElementById('modalImage');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

/**
 * Load all feedback
 */
async function loadFeedback() {
  try {
    setStatus('Loading feedback...');
    const res = await fetch(`${apiBase}/feedback/list`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load feedback');

    allFeedback = data.feedback || [];

    // Extract unique pages and submitters
    allPages = new Set();
    allSubmitters = new Set();
    allFeedback.forEach(fb => {
      allPages.add(fb.page);
      allSubmitters.add(fb.submittedBy);
    });

    // Update filter dropdowns
    updateFilterOptions();

    // Render list
    renderFeedback();

    setStatus(`Loaded ${allFeedback.length} feedback items.`);
  } catch (err) {
    setStatus(err.message || 'Failed to load feedback');
    listEl.innerHTML = '<div class="feedback-list-empty">Error: ' + err.message + '</div>';
  }
}

/**
 * Update filter dropdown options
 */
function updateFilterOptions() {
  // Update page filter
  const pages = Array.from(allPages).sort();
  const pageHtml = pages.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  filterPage.innerHTML = '<option value="">All</option>' + pageHtml;

  // Update submitter filter
  const submitters = Array.from(allSubmitters).sort();
  const submitterHtml = submitters.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  filterSubmitter.innerHTML = '<option value="">All</option>' + submitterHtml;
}

/**
 * Render feedback list with active filters
 */
function renderFeedback() {
  const status = filterStatus.value;
  const type = filterType.value;
  const page = filterPage.value;
  const submitter = filterSubmitter.value;

  let filtered = allFeedback.filter(fb => {
    if (status && fb.status !== status) return false;
    if (type && fb.type !== type) return false;
    if (page && fb.page !== page) return false;
    if (submitter && fb.submittedBy !== submitter) return false;
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="feedback-list-empty">No feedback matches your filters.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(fb => renderFeedbackCard(fb)).join('');

  // Attach event listeners to new cards
  listEl.querySelectorAll('[data-feedback-id]').forEach(card => {
    const id = card.getAttribute('data-feedback-id');
    const resBtn = card.querySelector('[data-action="resolve"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    const commentBtn = card.querySelector('[data-action="comment"]');
    const screenshotImg = card.querySelector('.feedback-screenshot');

    if (resBtn) resBtn.addEventListener('click', () => resolveFeedback(id));
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteFeedback(id));
    if (commentBtn) commentBtn.addEventListener('click', () => focusCommentInput(id));
    if (screenshotImg) screenshotImg.addEventListener('click', () => showScreenshot(screenshotImg.src));
  });

  // Attach comment form listeners
  listEl.querySelectorAll('.comment-form').forEach(form => {
    form.addEventListener('submit', (e) => handleCommentSubmit(e));
  });
}

/**
 * Render a single feedback card
 */
function renderFeedbackCard(fb) {
  const typeClass = `feedback-type ${fb.type}`;
  const statusClass = `feedback-status ${fb.status}`;
  const cardClass = `feedback-card ${fb.status}`;

  const submitterInfo = `${escapeHtml(fb.submittedBy)} <span class="feedback-badge">${escapeHtml(fb.submittedByRole)}</span>`;
  const timestamp = new Date(fb.timestamp).toLocaleString();

  let screenshotHtml = '';
  if (fb.screenshot) {
    screenshotHtml = `<img src="${fb.screenshot}" alt="Screenshot" class="feedback-screenshot">`;
  }

  let resolvedHtml = '';
  if (fb.status === 'resolved') {
    const resolvedTime = new Date(fb.resolvedAt).toLocaleString();
    resolvedHtml = `<div class="feedback-meta">Resolved by ${escapeHtml(fb.resolvedBy)} on ${resolvedTime}</div>`;
    if (fb.adminNotes) {
      resolvedHtml += `<div style="margin: 8px 0; padding: 8px; background: #fff; border-left: 3px solid #28a745;"><strong>Admin Notes:</strong> ${escapeHtml(fb.adminNotes)}</div>`;
    }
  }

  let actionButtons = '';
  if (fb.status === 'open') {
    actionButtons = `
      <button class="btn small" data-action="resolve">✓ Resolve</button>
      <button class="btn small outline" data-action="delete">🗑 Delete</button>
    `;
  } else {
    actionButtons = `
      <button class="btn small outline" data-action="delete">🗑 Delete</button>
    `;
  }

  const commentsHtml = renderComments(fb);

  return `
    <div class="${cardClass}" data-feedback-id="${fb.id}">
      <div class="feedback-header">
        <h3 class="feedback-title">${escapeHtml(fb.message.substring(0, 80))}${fb.message.length > 80 ? '...' : ''}</h3>
        <div>
          <span class="${typeClass}">${fb.type}</span>
          <span class="${statusClass}">${fb.status}</span>
        </div>
      </div>

      <div class="feedback-meta">
        Submitted by ${submitterInfo} on ${timestamp}
      </div>

      ${resolvedHtml}

      <div class="feedback-element">
        <strong>Element:</strong> ${escapeHtml(fb.element.selector || 'Unknown')}
      </div>

      <div class="feedback-message">
        <strong>Feedback:</strong>
        <p>${escapeHtml(fb.message)}</p>
      </div>

      ${screenshotHtml}

      <div class="feedback-comments">
        ${commentsHtml}
      </div>

      <div class="add-comment">
        <form class="comment-form" data-feedback-id="${fb.id}">
          <input type="text" placeholder="Your name" class="comment-username" required>
          <textarea placeholder="Add a comment..." class="comment-message" required></textarea>
          <button type="submit" class="btn small">Post Comment</button>
        </form>
      </div>

      <div class="feedback-actions">
        ${actionButtons}
      </div>
    </div>
  `;
}

/**
 * Render comments for a feedback item
 */
function renderComments(fb) {
  if (!fb.comments || fb.comments.length === 0) {
    return '<p style="color: #999; font-size: 12px; margin: 0;">No comments yet.</p>';
  }

  return fb.comments.map(c => `
    <div class="comment">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(c.username)} <span class="feedback-badge">${escapeHtml(c.role)}</span></span>
        <span class="comment-time">${new Date(c.timestamp).toLocaleString()}</span>
      </div>
      <p class="comment-text">${escapeHtml(c.message)}</p>
    </div>
  `).join('');
}

/**
 * Resolve feedback
 */
async function resolveFeedback(id) {
  const notes = prompt('Add admin notes (optional):');
  if (notes === null) return;

  try {
    setStatus('Resolving feedback...');
    const res = await fetch(`${apiBase}/feedback/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNotes: notes || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to resolve');

    // Update local copy
    const fbItem = allFeedback.find(f => f.id === id);
    if (fbItem) {
      Object.assign(fbItem, data.feedback);
    }

    renderFeedback();
    setStatus('Feedback resolved.');
  } catch (err) {
    setStatus(err.message || 'Failed to resolve');
  }
}

/**
 * Delete feedback
 */
async function deleteFeedback(id) {
  if (!confirm('Are you sure you want to delete this feedback? This cannot be undone.')) {
    return;
  }

  try {
    setStatus('Deleting feedback...');
    const res = await fetch(`${apiBase}/feedback/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete');

    // Remove from local copy
    allFeedback = allFeedback.filter(f => f.id !== id);

    renderFeedback();
    setStatus('Feedback deleted.');
  } catch (err) {
    setStatus(err.message || 'Failed to delete');
  }
}

/**
 * Focus on comment input
 */
function focusCommentInput(id) {
  const card = document.querySelector(`[data-feedback-id="${id}"]`);
  if (card) {
    const textarea = card.querySelector('.comment-form textarea');
    if (textarea) textarea.focus();
  }
}

/**
 * Handle comment submission
 */
async function handleCommentSubmit(e) {
  e.preventDefault();

  const form = e.target;
  const id = form.getAttribute('data-feedback-id');
  const usernameInput = form.querySelector('.comment-username');
  const textarea = form.querySelector('.comment-message');
  const username = usernameInput.value.trim();
  const message = textarea.value.trim();

  if (!username || !message) {
    alert('Name and comment cannot be empty');
    return;
  }

  try {
    setStatus('Adding comment...');
    const res = await fetch(`${apiBase}/feedback/${id}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, username }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add comment');

    // Update local copy
    const fbItem = allFeedback.find(f => f.id === id);
    if (fbItem && data.comment) {
      fbItem.comments.push(data.comment);
    }

    renderFeedback();
    setStatus('Comment added.');
  } catch (err) {
    setStatus(err.message || 'Failed to add comment');
  }
}

/**
 * Show screenshot in modal
 */
function showScreenshot(src) {
  modalImage.src = src;
  screenshotModal.classList.add('active');
  modalOverlay.classList.add('active');
}

/**
 * Close screenshot modal
 */
function closeScreenshotModal() {
  screenshotModal.classList.remove('active');
  modalOverlay.classList.remove('active');
}

/**
 * HTML escape
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Event listeners
 */
window.addEventListener('DOMContentLoaded', () => {
  if (btnRefresh) btnRefresh.addEventListener('click', loadFeedback);
  if (filterStatus) filterStatus.addEventListener('change', renderFeedback);
  if (filterType) filterType.addEventListener('change', renderFeedback);
  if (filterPage) filterPage.addEventListener('change', renderFeedback);
  if (filterSubmitter) filterSubmitter.addEventListener('change', renderFeedback);
  if (modalClose) modalClose.addEventListener('click', closeScreenshotModal);
  if (modalOverlay) modalOverlay.addEventListener('click', closeScreenshotModal);

  loadFeedback();
});
