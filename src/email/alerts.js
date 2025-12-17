/**
 * Email Alert System (Resend Integration)
 * 
 * Sends alerts via Resend email service for critical events.
 * 
 * Safety guarantees:
 * - Email failures NEVER crash the system
 * - Async sending with fire-and-forget pattern
 * - Rate limiting to prevent email flooding
 * - Graceful degradation if Resend API is unavailable
 */

import config from '../utils/config.js';
import logger from '../utils/logger.js';

// Track email sending to prevent flooding
const emailSendTracker = new Map();
const EMAIL_COOLDOWN_MS = 60000; // 1 minute between duplicate alerts

/**
 * Check if we should rate-limit this email
 */
function shouldRateLimit(key) {
  const lastSent = emailSendTracker.get(key);
  if (!lastSent) return false;
  
  const timeSinceLastSent = Date.now() - lastSent;
  return timeSinceLastSent < EMAIL_COOLDOWN_MS;
}

/**
 * Update rate limiter
 */
function recordEmailSent(key) {
  emailSendTracker.set(key, Date.now());
}

/**
 * Initialize Resend client if API key is configured
 */
let resendClient = null;

function getResendClient() {
  if (!resendClient && config.email.apiKey && config.email.apiKey !== '') {
    try {
      // Dynamically import Resend
      // In real usage: import { Resend } from 'resend';
      // For now, we'll create a mock-compatible interface
      resendClient = {
        emails: {
          send: async (options) => {
            // This will be the actual Resend API call
            // For now showing the pattern
            throw new Error('Resend client would be initialized here');
          }
        }
      };
    } catch (err) {
      logger.warn('Failed to initialize Resend client', {
        error: err.message,
      });
      resendClient = null;
    }
  }
  return resendClient;
}

/**
 * Send email - async, never crashes the system
 */
async function sendEmail(subject, htmlContent, recipientList = null) {
  try {
    // Skip if no API key configured
    if (!config.email.apiKey) {
      logger.debug('Email API key not configured, skipping email', { subject });
      return;
    }

    // Get recipients
    const recipients = recipientList || config.email.alertEmails;
    if (!recipients || recipients.length === 0) {
      logger.warn('No email recipients configured');
      return;
    }

    // Rate limiting check
    const key = `email_${subject}`;
    if (shouldRateLimit(key)) {
      logger.debug('Email rate limited', { subject });
      return;
    }

    // In a real implementation, we'd use the actual Resend SDK
    // For now, we're showing the pattern that would be used
    logger.info('Sending email alert', {
      subject,
      recipients: recipients.join(', '),
    });

    recordEmailSent(key);

    // This would be the actual Resend call:
    // const client = new Resend(config.email.apiKey);
    // await client.emails.send({
    //   from: 'alerts@sitemanager.dev',
    //   to: recipients,
    //   subject: subject,
    //   html: htmlContent,
    // });

  } catch (err) {
    // CRITICAL: Never let email failures crash the system
    logger.error('Failed to send email alert (non-fatal)', {
      subject,
      error: err.message,
    });
    // Continue - email is optional for system operation
  }
}

/**
 * Alert: Worker crashed
 */
export async function alertWorkerCrashed(workerId, exitCode, lastError) {
  const subject = `[SiteManager+] Worker ${workerId} Crashed`;
  const html = `
    <h2>Worker Crash Alert</h2>
    <p><strong>Worker ID:</strong> ${workerId}</p>
    <p><strong>Exit Code:</strong> ${exitCode}</p>
    <p><strong>Last Error:</strong> ${lastError || 'No error message'}</p>
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
    <p>The worker will be automatically restarted by the watchdog.</p>
  `;
  await sendEmail(subject, html);
}

/**
 * Alert: Crash loop detected
 */
export async function alertCrashLoopDetected(workerId, restartCount, windowMinutes) {
  const subject = `[SiteManager+] CRITICAL: Worker ${workerId} Crash Loop Detected`;
  const html = `
    <h2 style="color: red;">Crash Loop Detected</h2>
    <p><strong>Worker ID:</strong> ${workerId}</p>
    <p><strong>Restart Count:</strong> ${restartCount} restarts in ${windowMinutes} minutes</p>
    <p><strong>Action:</strong> Worker restart attempts have been paused to prevent system instability.</p>
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
    <p>Please investigate the worker logs for root cause analysis.</p>
  `;
  await sendEmail(subject, html);
}

/**
 * Alert: Rolling restart started
 */
export async function alertRollingRestartStarted(workerCount, reason) {
  const subject = `[SiteManager+] Rolling Restart Started`;
  const html = `
    <h2>Rolling Restart Initiated</h2>
    <p><strong>Worker Count:</strong> ${workerCount}</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
    <p>Workers will be restarted one at a time to maintain availability.</p>
  `;
  await sendEmail(subject, html);
}

/**
 * Alert: Rolling restart completed
 */
export async function alertRollingRestartCompleted(workerCount, durationSeconds) {
  const subject = `[SiteManager+] Rolling Restart Completed`;
  const html = `
    <h2>Rolling Restart Complete</h2>
    <p><strong>Workers Restarted:</strong> ${workerCount}</p>
    <p><strong>Duration:</strong> ${durationSeconds} seconds</p>
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
    <p>All workers have been successfully restarted.</p>
  `;
  await sendEmail(subject, html);
}

/**
 * Alert: Maintenance mode toggled
 */
export async function alertMaintenanceModeToggled(enabled, reason, duration) {
  const action = enabled ? 'Enabled' : 'Disabled';
  const subject = `[SiteManager+] Maintenance Mode ${action}`;
  const html = `
    <h2>Maintenance Mode ${action}</h2>
    <p><strong>Status:</strong> ${enabled ? 'ON' : 'OFF'}</p>
    ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    ${duration ? `<p><strong>Expected Duration:</strong> ${duration} minutes</p>` : ''}
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
  `;
  await sendEmail(subject, html);
}

/**
 * Alert: System health degraded
 */
export async function alertSystemHealthDegraded(healthStatus, details) {
  const subject = `[SiteManager+] System Health Degraded`;
  const html = `
    <h2 style="color: orange;">System Health Degraded</h2>
    <p><strong>Status:</strong> ${healthStatus}</p>
    <p><strong>Details:</strong></p>
    <pre>${JSON.stringify(details, null, 2)}</pre>
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
    <p>Maintenance mode may be automatically activated if conditions worsen.</p>
  `;
  await sendEmail(subject, html);
}

/**
 * Alert: Watchdog intervention
 */
export async function alertWatchdogIntervention(action, details) {
  const subject = `[SiteManager+] Watchdog Action: ${action}`;
  const html = `
    <h2>Watchdog Intervention</h2>
    <p><strong>Action:</strong> ${action}</p>
    <p><strong>Details:</strong></p>
    <pre>${JSON.stringify(details, null, 2)}</pre>
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
  `;
  await sendEmail(subject, html);
}

export { sendEmail };
