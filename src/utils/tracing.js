/**
 * Request Tracing System
 * 
 * Adds unique request IDs and tracing:
 * - Unique ID per request
 * - Correlation across workers
 * - Distributed tracing support
 * - Performance tracking
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Request context for tracing
 */
export class RequestContext {
  constructor(requestId = null, parentId = null) {
    this.requestId = requestId || `req_${uuidv4()}`;
    this.parentId = parentId;
    this.startTime = Date.now();
    this.events = [];
    this.metadata = {};
  }

  /**
   * Record a trace event
   */
  addEvent(eventName, data = {}) {
    this.events.push({
      timestamp: Date.now(),
      name: eventName,
      duration: Date.now() - this.startTime,
      data,
    });
  }

  /**
   * Get total duration
   */
  getDuration() {
    return Date.now() - this.startTime;
  }

  /**
   * Get trace summary
   */
  getSummary() {
    return {
      requestId: this.requestId,
      parentId: this.parentId,
      duration: this.getDuration(),
      eventCount: this.events.length,
      events: this.events,
    };
  }
}

/**
 * Middleware: Add request tracing
 */
export function tracing(req, res, next) {
  // Check for existing trace ID from headers (for distributed tracing)
  const traceId = req.headers['x-trace-id'] || req.headers['x-request-id'];
  const parentId = req.headers['x-parent-id'];

  const context = new RequestContext(traceId, parentId);
  req.traceContext = context;

  // Add trace ID to response headers
  res.setHeader('X-Trace-ID', context.requestId);
  res.setHeader('X-Response-Time', '0'); // Will be updated

  // Record request start
  context.addEvent('request_start', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  // Wrap res.json and res.send to track completion
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function (data) {
    context.addEvent('response_json', { statusCode: res.statusCode });
    res.setHeader('X-Response-Time', context.getDuration() + 'ms');
    return originalJson.call(this, data);
  };

  res.send = function (data) {
    context.addEvent('response_send', { statusCode: res.statusCode });
    res.setHeader('X-Response-Time', context.getDuration() + 'ms');
    return originalSend.call(this, data);
  };

  res.on('finish', () => {
    context.addEvent('response_finish', {
      statusCode: res.statusCode,
      contentLength: res.getHeader('content-length'),
    });
  });

  next();
}

/**
 * Helper to add trace context to logs
 */
export function getTraceHeaders(req) {
  if (!req.traceContext) {
    return {};
  }

  return {
    traceId: req.traceContext.requestId,
    parentId: req.traceContext.parentId,
  };
}
