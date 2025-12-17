/**
 * Multi-Channel Alert System
 * 
 * Send alerts through multiple channels:
 * - Email (Resend)
 * - Slack
 * - Discord
 * - PagerDuty
 * - Custom webhooks
 */

import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Alert severity levels
 */
export const ALERT_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

/**
 * Slack alert handler
 */
export async function sendSlackAlert(title, message, severity = ALERT_SEVERITY.WARNING) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.debug('Slack webhook not configured, skipping');
    return;
  }

  try {
    const color = {
      [ALERT_SEVERITY.INFO]: '#36a64f',
      [ALERT_SEVERITY.WARNING]: '#ff9900',
      [ALERT_SEVERITY.CRITICAL]: '#ff0000',
    }[severity];

    const payload = {
      text: title,
      attachments: [{
        color,
        title,
        text: message,
        footer: 'SiteManager+',
        ts: Math.floor(Date.now() / 1000),
      }],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    logger.info('Slack alert sent', { title, severity });
  } catch (err) {
    logger.error('Failed to send Slack alert', {
      error: err.message,
      title,
    });
  }
}

/**
 * Discord alert handler
 */
export async function sendDiscordAlert(title, message, severity = ALERT_SEVERITY.WARNING) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.debug('Discord webhook not configured, skipping');
    return;
  }

  try {
    const color = {
      [ALERT_SEVERITY.INFO]: 0x36a64f,
      [ALERT_SEVERITY.WARNING]: 0xff9900,
      [ALERT_SEVERITY.CRITICAL]: 0xff0000,
    }[severity];

    const payload = {
      embeds: [{
        title,
        description: message,
        color,
        footer: { text: 'SiteManager+' },
        timestamp: new Date().toISOString(),
      }],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    logger.info('Discord alert sent', { title, severity });
  } catch (err) {
    logger.error('Failed to send Discord alert', {
      error: err.message,
      title,
    });
  }
}

/**
 * PagerDuty alert handler
 */
export async function sendPagerDutyAlert(title, message, severity = ALERT_SEVERITY.WARNING) {
  const integrationKey = process.env.PAGERDUTY_INTEGRATION_KEY;
  if (!integrationKey) {
    logger.debug('PagerDuty integration key not configured, skipping');
    return;
  }

  try {
    const pdSeverity = severity === ALERT_SEVERITY.CRITICAL ? 'critical' : 'warning';

    const payload = {
      routing_key: integrationKey,
      event_action: 'trigger',
      dedup_key: `sitemanager-${Date.now()}`,
      payload: {
        summary: title,
        severity: pdSeverity,
        source: 'SiteManager+',
        custom_details: { message },
      },
    };

    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    logger.info('PagerDuty alert sent', { title, severity });
  } catch (err) {
    logger.error('Failed to send PagerDuty alert', {
      error: err.message,
      title,
    });
  }
}

/**
 * Custom webhook alert handler
 */
export async function sendCustomWebhook(title, message, severity = ALERT_SEVERITY.WARNING) {
  const webhookUrl = process.env.CUSTOM_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.debug('Custom webhook not configured, skipping');
    return;
  }

  try {
    const payload = {
      title,
      message,
      severity,
      timestamp: new Date().toISOString(),
      source: 'SiteManager+',
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    logger.info('Custom webhook alert sent', { title, severity });
  } catch (err) {
    logger.error('Failed to send custom webhook alert', {
      error: err.message,
      title,
    });
  }
}

/**
 * Send alert through all configured channels
 */
export async function broadcastAlert(title, message, severity = ALERT_SEVERITY.WARNING) {
  // Skip if within quiet hours
  if (isQuietHours()) {
    logger.debug('Alert suppressed (quiet hours)', { title });
    return;
  }

  logger.info('Broadcasting alert', { title, severity });

  // Send to all channels (fire and forget)
  Promise.all([
    sendSlackAlert(title, message, severity),
    sendDiscordAlert(title, message, severity),
    sendPagerDutyAlert(title, message, severity),
    sendCustomWebhook(title, message, severity),
  ]).catch((err) => {
    logger.error('Error broadcasting alerts', { error: err.message });
  });
}

/**
 * Check if currently in quiet hours
 */
function isQuietHours() {
  const quietHours = process.env.ALERT_QUIET_HOURS;
  if (!quietHours) return false;

  // Format: "22:00-08:00" (10 PM to 8 AM)
  const [startStr, endStr] = quietHours.split('-');
  const [startHour, startMin] = startStr.split(':').map(Number);
  const [endHour, endMin] = endStr.split(':').map(Number);

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  if (startTime < endTime) {
    return currentTime >= startTime && currentTime < endTime;
  } else {
    // Range spans midnight
    return currentTime >= startTime || currentTime < endTime;
  }
}
