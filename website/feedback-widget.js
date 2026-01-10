/**
 * Feedback Widget
 * 
 * Injected into website pages when feedback is enabled.
 * Shows a floating button to submit feedback.
 */

(function() {
  'use strict';

  const config = {
    apiBaseUrl: '/admin',
  };

  let selectedElement = null;
  let feedbackVisible = false;
  let highlightedElement = null;

  /**
   * Initialize the feedback widget
   */
  function init() {
    // Prevent double-initialization
    if (document.getElementById('feedback-widget-container')) return;

    // Surface that the widget script actually ran
    try {
      console.info('[feedback-widget] initializing');
    } catch (_) {}

    createWidgetUI();
    attachEventListeners();
    
    // Add a global click listener to catch any clicks on the submit button
    document.addEventListener('click', (e) => {
      const target = e.target || e.srcElement;
      if (target && target.id === 'feedback-submit-btn') {
        console.log('[feedback-widget] submit button global click captured, target:', target);
        e.preventDefault();
        e.stopPropagation();
        submitFeedback(e);
      }
    }, true);
  }

  /**
   * Create the feedback widget UI (hidden by default)
   */
  function createWidgetUI() {
    const container = document.createElement('div');
    container.id = 'feedback-widget-container';
    container.innerHTML = `
      <button id="feedback-toggle-btn" class="feedback-toggle" title="Send Feedback">
        💬
      </button>

      <div id="feedback-modal" class="feedback-modal" style="display: none;">
        <div class="feedback-modal-content">
          <div class="feedback-modal-header">
            <h2>Send Feedback</h2>
            <button id="feedback-close-btn" class="feedback-close">&times;</button>
          </div>
          
          <div class="feedback-modal-body">
            <div class="feedback-step" id="feedback-step-select">
              <p>Click an element on the page to provide feedback about it.</p>
              <button id="feedback-select-btn" class="feedback-btn primary">Select Element</button>
              <button id="feedback-cancel-select-btn" class="feedback-btn" style="display: none;">Cancel Selection</button>
              <div id="feedback-selected-preview" style="display: none; margin-top: 12px; padding: 8px; background: #f0f0f0; border-radius: 4px; font-size: 12px;">
                <strong>Selected:</strong> <code id="feedback-selected-text"></code>
              </div>
            </div>

            <div class="feedback-step" id="feedback-step-form" style="display: none;">
              <div id="feedback-selected-preview-form" style="margin-bottom: 12px; padding: 8px; background: #f0f0f0; border-radius: 4px; font-size: 11px; border-left: 3px solid #007bff;">
                <strong>Selected:</strong> <code id="feedback-selected-text-form" style="word-break: break-all;"></code>
              </div>
              <form id="feedback-form">
                <div class="feedback-form-group">
                  <label for="feedback-username">Your Name:</label>
                  <input type="text" id="feedback-username" name="username" placeholder="Enter your name" required>
                </div>

                <div class="feedback-form-group">
                  <label for="feedback-type">Feedback Type:</label>
                  <select id="feedback-type" name="type" required>
                    <option value="">-- Select Type --</option>
                    <option value="bug">🐛 Bug</option>
                    <option value="suggestion">💡 Suggestion</option>
                    <option value="question">❓ Question</option>
                    <option value="typo">✏️ Typo</option>
                  </select>
                </div>

                <div class="feedback-form-group">
                  <label for="feedback-message">Your Feedback:</label>
                  <textarea id="feedback-message" name="message" placeholder="Describe the issue or suggestion..." required></textarea>
                </div>

                <div class="feedback-form-group">
                  <label>
                    <input type="checkbox" id="feedback-screenshot" name="screenshot" checked>
                    Include Screenshot
                  </label>
                </div>

                <div class="feedback-form-actions">
                  <button type="button" id="feedback-back-btn" class="feedback-btn">Back</button>
                  <button type="button" id="feedback-submit-btn" class="feedback-btn primary">Submit Feedback</button>
                </div>
              </form>
            </div>

            <div class="feedback-step" id="feedback-step-success" style="display: none;">
              <div class="feedback-success-message">
                <div class="feedback-success-icon">✓</div>
                <p>Thank you! Your feedback has been submitted.</p>
              </div>
              <button id="feedback-new-btn" class="feedback-btn primary">Send Another</button>
            </div>
          </div>
        </div>
      </div>

      <div id="feedback-overlay" class="feedback-overlay" style="display: none;"></div>
    `;

    document.body.appendChild(container);
    injectStyles();
  }

  /**
   * Inject CSS styles
   */
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #feedback-widget-container {
        --feedback-primary: #007bff;
        --feedback-text: #333;
        --feedback-border: #ddd;
        --feedback-bg: #fff;
        --feedback-muted: #6b7280;
      }

      .feedback-toggle {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: var(--feedback-primary);
        color: white;
        border: none;
        font-size: 28px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 2147483647;
        pointer-events: auto;
        transition: transform 0.2s, box-shadow 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .feedback-toggle:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      }

      .feedback-toggle:active {
        transform: scale(0.95);
      }

      .feedback-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 2147483645;
        pointer-events: auto;
      }

      .feedback-overlay.highlight {
        cursor: crosshair !important;
      }

      .feedback-modal {
        position: fixed;
        bottom: 92px; /* above toggle button */
        right: 20px;
        left: auto;
        top: auto;
        transform: none;
        z-index: 2147483646;
        max-width: 420px;
        width: calc(100% - 40px);
        max-height: 60vh;
        overflow: hidden;
        pointer-events: auto;
      }

      .feedback-modal-content {
        background: var(--feedback-bg);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.20);
        border: 1px solid var(--feedback-border);
        overflow: hidden;
        border-left: 4px solid var(--feedback-primary);
        pointer-events: auto;
      }

      .feedback-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        border-bottom: 1px solid var(--feedback-border);
        background: #f8f9fa;
      }

      .feedback-modal-header h2 {
        margin: 0;
        font-size: 15px;
        color: var(--feedback-text);
      }

      .feedback-close {
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .feedback-close:hover {
        color: var(--feedback-text);
      }

      .feedback-modal-body {
        padding: 14px 16px 16px 16px;
        max-height: 50vh;
        overflow-y: auto;
      }

      .feedback-step {
        display: none !important;
        min-height: 150px;
      }

      .feedback-step.active {
        display: block !important;
      }

      .feedback-form-group {
        margin-bottom: 12px;
      }

      .feedback-form-group label {
        display: block;
        margin-bottom: 6px;
        font-weight: 600;
        color: var(--feedback-text);
        font-size: 12px;
      }

      .feedback-form-group input[type="text"],
      .feedback-form-group select,
      .feedback-form-group textarea {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid var(--feedback-border);
        border-radius: 4px;
        font-size: 12px;
        font-family: inherit;
        resize: vertical;
        box-sizing: border-box;
        background: #fff;
      }

      .feedback-form-group input[type="text"]::placeholder,
      .feedback-form-group textarea::placeholder {
        color: var(--feedback-muted);
      }

      .feedback-form-group textarea {
        min-height: 90px;
      }

      .feedback-form-group select:focus,
      .feedback-form-group textarea:focus {
        outline: none;
        border-color: var(--feedback-primary);
        box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
      }

      .feedback-form-group input[type="checkbox"] {
        margin-right: 6px;
        cursor: pointer;
      }

      .feedback-form-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        justify-content: flex-end;
      }

      .feedback-btn {
        padding: 8px 12px;
        border: 1px solid var(--feedback-border);
        background: white;
        color: var(--feedback-text);
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        pointer-events: auto;
      }

      .feedback-btn:hover {
        background: #f0f0f0;
      }

      .feedback-btn.primary {
        background: var(--feedback-primary);
        color: white;
        border-color: var(--feedback-primary);
      }

      .feedback-btn.primary:hover {
        background: #0056b3;
        border-color: #0056b3;
      }

      .feedback-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .feedback-success-message {
        text-align: center;
        padding: 16px;
      }

      .feedback-success-icon {
        font-size: 42px;
        margin-bottom: 8px;
      }

      .feedback-success-message p {
        margin: 0;
        color: var(--feedback-text);
        font-size: 14px;
      }

      .feedback-overlay.highlight {
        cursor: crosshair !important;
      }

      @media (prefers-color-scheme: dark) {
        #feedback-widget-container {
          --feedback-bg: #2d2d2d;
          --feedback-text: #f0f0f0;
          --feedback-border: #444;
          --feedback-muted: #9aa0a6;
        }

        .feedback-modal-header {
          background: #1f1f1f;
        }

        .feedback-form-group input[type="text"],
        .feedback-form-group select,
        .feedback-form-group textarea {
          background: #1f1f1f;
          color: #f0f0f0;
        }

        .feedback-btn {
          background: #444;
          color: #f0f0f0;
        }

        .feedback-btn:hover {
          background: #555;
        }
      }

      /* Small screens: keep it tidy */
      @media (max-width: 480px) {
        .feedback-modal {
          right: 10px;
          bottom: 90px;
          width: calc(100% - 20px);
          max-width: none;
        }

        .feedback-modal-header h2 {
          font-size: 14px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    const toggleBtn = document.getElementById('feedback-toggle-btn');
    const closeBtn = document.getElementById('feedback-close-btn');
    const modal = document.getElementById('feedback-modal');
    const overlay = document.getElementById('feedback-overlay');
    const selectBtn = document.getElementById('feedback-select-btn');
    const cancelSelectBtn = document.getElementById('feedback-cancel-select-btn');
    const backBtn = document.getElementById('feedback-back-btn');
    const form = document.getElementById('feedback-form');
    const submitBtn = document.getElementById('feedback-submit-btn');
    const newBtn = document.getElementById('feedback-new-btn');

    console.log('[feedback-widget] attaching listeners, form found:', !!form, 'submitBtn found:', !!submitBtn);
    if (submitBtn) {
      console.log('[feedback-widget] submitBtn type:', submitBtn.type, 'tagName:', submitBtn.tagName, 'disabled:', submitBtn.disabled);
    }

    toggleBtn.addEventListener('click', () => {
      if (feedbackVisible) {
        closeModal();
      } else {
        openModal();
      }
    });
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
    selectBtn.addEventListener('click', startElementSelection);
    cancelSelectBtn.addEventListener('click', cancelElementSelection);
    backBtn.addEventListener('click', backToSelection);
    
    if (form) {
      form.addEventListener('submit', submitFeedback);
      console.log('[feedback-widget] form submit listener attached');
    } else {
      console.error('[feedback-widget] form element not found!');
    }

    // Direct listeners on submit button with capture and multi-input support
    if (submitBtn) {
      const invokeSubmit = (ev) => {
        console.log('[feedback-widget] direct submit trigger');
        ev.preventDefault();
        ev.stopPropagation();
        submitFeedback(ev);
      };
      submitBtn.addEventListener('click', invokeSubmit, true);
      submitBtn.addEventListener('pointerdown', invokeSubmit, true);
      submitBtn.addEventListener('touchstart', invokeSubmit, { passive: false, capture: true });
      console.log('[feedback-widget] direct submit listeners attached');
    }

    // Use event delegation on the modal instead - click on anything with id feedback-submit-btn
    const container = document.getElementById('feedback-widget-container');
    if (container) {
      container.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'feedback-submit-btn') {
          console.log('[feedback-widget] submit button clicked via delegation');
          e.preventDefault();
          submitFeedback(e);
        }
      }, true); // use capture phase to catch before other handlers
      console.log('[feedback-widget] submit button delegation listener attached');
    }
    
    newBtn.addEventListener('click', resetForm);
  }

  /**
   * Open the feedback modal
   */
  function openModal() {
    const modal = document.getElementById('feedback-modal');
    const overlay = document.getElementById('feedback-overlay');
    modal.style.display = 'block';
    overlay.style.display = 'block';
    feedbackVisible = true;
    showStep('select');
  }

  /**
   * Close the feedback modal
   */
  function closeModal() {
    const modal = document.getElementById('feedback-modal');
    const overlay = document.getElementById('feedback-overlay');
    modal.style.display = 'none';
    overlay.style.display = 'none';
    feedbackVisible = false;
    selectedElement = null;
  }

  /**
   * Start element selection mode
   */
  function startElementSelection() {
    selectedElement = null;
    document.body.style.cursor = 'crosshair';
    const overlay = document.getElementById('feedback-overlay');
    const modal = document.getElementById('feedback-modal');
    overlay.classList.add('highlight');
    overlay.style.pointerEvents = 'none'; // Let clicks reach the page under the modal overlay
    // Make the modal non-interactive during selection so it does not block the page
    if (modal) {
      modal.style.pointerEvents = 'none';
      modal.style.opacity = '0.65';
    }

    const handleMouseMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el.id === 'feedback-widget-container' || el.closest('#feedback-widget-container')) {
        return;
      }

      // Clear previous highlight
      if (highlightedElement && highlightedElement !== el) {
        highlightedElement.style.outline = '';
        highlightedElement.style.outlineOffset = '';
      }

      highlightedElement = el;
      highlightedElement.style.outline = '2px solid #007bff';
      highlightedElement.style.outlineOffset = '-2px';
    };

    const handleMouseLeave = () => {
      if (highlightedElement) {
        highlightedElement.style.outline = '';
        highlightedElement.style.outlineOffset = '';
        highlightedElement = null;
      }
    };

    const handleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.id !== 'feedback-widget-container' && !el.closest('#feedback-widget-container')) {
        selectedElement = el;
        updateSelectedPreview();
        showStep('form');
      }

      cleanup();
    };

    const cleanup = () => {
      document.body.style.cursor = '';
      overlay.classList.remove('highlight');
      overlay.style.pointerEvents = '';
      if (modal) {
        modal.style.pointerEvents = '';
        modal.style.opacity = '';
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('click', handleClick);
      if (highlightedElement) {
        highlightedElement.style.outline = '';
        highlightedElement.style.outlineOffset = '';
        highlightedElement = null;
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('click', handleClick, true);

    // Show cancel button
    document.getElementById('feedback-cancel-select-btn').style.display = 'inline-block';
    document.getElementById('feedback-select-btn').style.display = 'none';

    // Store cleanup for cancel
    window._feedbackSelectionCleanup = cleanup;
  }

  /**
   * Cancel element selection
   */
  function cancelElementSelection() {
    if (window._feedbackSelectionCleanup) {
      window._feedbackSelectionCleanup();
      delete window._feedbackSelectionCleanup;
    }
    const overlay = document.getElementById('feedback-overlay');
    const modal = document.getElementById('feedback-modal');
    overlay.style.pointerEvents = ''; // Restore overlay click handling
    if (modal) {
      modal.style.pointerEvents = '';
      modal.style.opacity = '';
    }
    document.getElementById('feedback-cancel-select-btn').style.display = 'none';
    document.getElementById('feedback-select-btn').style.display = 'inline-block';
    selectedElement = null;
  }

  /**
   * Update the selected element preview
   */
  function updateSelectedPreview() {
    if (!selectedElement) return;

    let displayText = selectedElement.tagName.toLowerCase();
    if (selectedElement.id) {
      displayText += `#${selectedElement.id}`;
    }
    if (selectedElement.className) {
      displayText += `.${selectedElement.className.split(' ').join('.')}`;
    }

    // Update both the select-step preview and form-step preview
    const selectPreview = document.getElementById('feedback-selected-preview');
    const selectText = document.getElementById('feedback-selected-text');
    const formText = document.getElementById('feedback-selected-text-form');

    if (selectPreview && selectText) {
      selectText.textContent = displayText;
      selectPreview.style.display = 'block';
    }

    if (formText) {
      formText.textContent = displayText;
    }
  }

  /**
   * Show a specific step
   */
  function showStep(step) {
    const steps = document.querySelectorAll('.feedback-step');
    steps.forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });

    if (step === 'select') {
      const selectStep = document.getElementById('feedback-step-select');
      if (selectStep) {
        selectStep.classList.add('active');
        selectStep.style.display = 'block';
      }
    } else if (step === 'form') {
      const formStep = document.getElementById('feedback-step-form');
      if (formStep) {
        formStep.classList.add('active');
        formStep.style.display = 'block';
      }
    } else if (step === 'success') {
      const successStep = document.getElementById('feedback-step-success');
      if (successStep) {
        successStep.classList.add('active');
        successStep.style.display = 'block';
      }
    }
  }

  /**
   * Go back to selection
   */
  function backToSelection() {
    document.getElementById('feedback-form').reset();
    selectedElement = null;
    document.getElementById('feedback-selected-preview').style.display = 'none';
    showStep('select');
  }

  /**
   * Submit feedback
   */
  async function submitFeedback(e) {
    console.log('[feedback-widget] submitFeedback called, e:', e);
    e.preventDefault();
    e.stopPropagation();

    if (!selectedElement) {
      alert('Please select an element first');
      return;
    }

    const username = document.getElementById('feedback-username').value.trim();
    const type = document.getElementById('feedback-type').value;
    const message = document.getElementById('feedback-message').value;
    const includeScreenshot = document.getElementById('feedback-screenshot').checked;

    if (!username || !type || !message) {
      alert('Please fill in all required fields');
      return;
    }

    // Get element info - simplified to avoid issues with selectors
    const element = {
      tag: selectedElement.tagName.toLowerCase(),
      id: selectedElement.id || null,
      class: selectedElement.className || null,
      text: selectedElement.textContent.substring(0, 100),
    };

    // Capture screenshot if requested
    let screenshot = null;
    if (includeScreenshot) {
      try {
        screenshot = await captureScreenshot();
      } catch (err) {
        console.warn('Screenshot failed:', err);
      }
    }

    // Submit feedback
    const payload = {
      page: window.location.pathname,
      element,
      type,
      message,
      username,
      screenshot,
    };

    const btn = document.getElementById('feedback-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      console.log('[feedback-widget] submitting:', payload);
      const response = await fetch(`${config.apiBaseUrl}/feedback/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log('[feedback-widget] response:', response.status, data);

      if (!response.ok) {
        throw new Error(data.error || `Failed to submit feedback (${response.status})`);
      }

      showStep('success');
      btn.disabled = false;
      btn.textContent = 'Submit Feedback';
    } catch (err) {
      console.error('[feedback-widget] submit error:', err);
      alert('Error submitting feedback: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Submit Feedback';
    }
  }

  /**
   * Reset form and start over
   */
  function resetForm() {
    document.getElementById('feedback-form').reset();
    selectedElement = null;
    document.getElementById('feedback-selected-preview').style.display = 'none';
    showStep('select');
  }

  /**
   * Get CSS selector for an element
   */
  function getElementSelector(el) {
    const names = [];
    while (el.parentElement) {
      if (el.id) {
        names.unshift('#' + el.id);
        break;
      } else {
        if (el === el.ownerDocument.documentElement) {
          names.unshift(el.tagName.toLowerCase());
        } else {
          let c = 1;
          let e = el;
          while (e.previousElementSibling) {
            e = e.previousElementSibling;
            if (e.tagName.toLowerCase() === el.tagName.toLowerCase()) c++;
          }
          if (c > 1) {
            names.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + c + ')');
          } else {
            names.unshift(el.tagName.toLowerCase());
          }
        }
        el = el.parentElement;
      }
    }
    return names.join(' > ');
  }

  /**
   * Get XPath for an element
   */
  function getElementXPath(el) {
    if (el.id !== '')
      return "//*[@id='" + el.id + "']";
    if (el === document.body)
      return el.tagName.toLowerCase();

    const ix = Array.from(el.parentNode.childNodes).indexOf(el) + 1;
    return getElementXPath(el.parentNode) + '/' + el.tagName.toLowerCase() + '[' + ix + ']';
  }

  /**
   * Capture a screenshot of the page
   */
  async function captureScreenshot() {
    try {
      const canvas = await html2canvas(document.body, {
        allowTaint: true,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.warn('Screenshot capture failed:', err);
      return null;
    }
  }

  // Initialize after DOM is ready so the button renders on every page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
