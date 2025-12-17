/**
 * Metrics Collection System
 * 
 * Tracks application metrics for Prometheus and monitoring systems:
 * - Request counts and response times
 * - Error rates
 * - Worker health and uptime
 * - Memory and CPU usage
 * - Cache hit/miss rates
 * 
 * Exports metrics in Prometheus format
 */

/**
 * Metrics collector
 */
export class MetricsCollector {
  constructor() {
    // Request metrics
    this.requestCount = 0;
    this.requestErrorCount = 0;
    this.requestTotalDurationMs = 0;
    this.requestDurations = []; // For percentiles

    // Per-method metrics
    this.methodMetrics = new Map();

    // Status code metrics
    this.statusCodeMetrics = new Map();

    // Cache metrics
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // Worker metrics
    this.workerMetrics = new Map();

    // Startup time
    this.startTime = Date.now();
  }

  /**
   * Record HTTP request
   */
  recordRequest(method, statusCode, durationMs, error = false) {
    this.requestCount++;
    if (error) {
      this.requestErrorCount++;
    }
    this.requestTotalDurationMs += durationMs;
    this.requestDurations.push(durationMs);

    // Keep only last 1000 durations for percentile calculation
    if (this.requestDurations.length > 1000) {
      this.requestDurations.shift();
    }

    // Track by method
    if (!this.methodMetrics.has(method)) {
      this.methodMetrics.set(method, { count: 0, errors: 0, totalDuration: 0 });
    }
    const methodStats = this.methodMetrics.get(method);
    methodStats.count++;
    methodStats.totalDuration += durationMs;
    if (error) methodStats.errors++;

    // Track by status code
    const code = Math.floor(statusCode / 100) * 100; // 200, 300, 400, 500
    if (!this.statusCodeMetrics.has(code)) {
      this.statusCodeMetrics.set(code, 0);
    }
    this.statusCodeMetrics.set(code, this.statusCodeMetrics.get(code) + 1);
  }

  /**
   * Record worker metrics
   */
  recordWorkerMetrics(workerId, memoryMB, uptime, errorCount, requestCount) {
    this.workerMetrics.set(workerId, {
      memoryMB,
      uptime,
      errorCount,
      requestCount,
    });
  }

  /**
   * Get percentile from recorded durations
   */
  getPercentile(percentile) {
    if (this.requestDurations.length === 0) return 0;
    const sorted = [...this.requestDurations].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get metrics in Prometheus format
   */
  getPrometheusMetrics() {
    const lines = [];

    // HELP and TYPE comments
    lines.push('# HELP requests_total Total number of HTTP requests');
    lines.push('# TYPE requests_total counter');
    lines.push(`requests_total ${this.requestCount}`);

    lines.push('# HELP requests_errors_total Total number of request errors');
    lines.push('# TYPE requests_errors_total counter');
    lines.push(`requests_errors_total ${this.requestErrorCount}`);

    lines.push('# HELP request_duration_ms_sum Total request duration in milliseconds');
    lines.push('# TYPE request_duration_ms_sum counter');
    lines.push(`request_duration_ms_sum ${this.requestTotalDurationMs}`);

    lines.push('# HELP request_duration_ms Average request duration in milliseconds');
    lines.push('# TYPE request_duration_ms gauge');
    const avgDuration = this.requestCount > 0 
      ? Math.round(this.requestTotalDurationMs / this.requestCount)
      : 0;
    lines.push(`request_duration_ms ${avgDuration}`);

    lines.push('# HELP request_duration_p50 50th percentile request duration');
    lines.push('# TYPE request_duration_p50 gauge');
    lines.push(`request_duration_p50 ${this.getPercentile(50)}`);

    lines.push('# HELP request_duration_p95 95th percentile request duration');
    lines.push('# TYPE request_duration_p95 gauge');
    lines.push(`request_duration_p95 ${this.getPercentile(95)}`);

    lines.push('# HELP request_duration_p99 99th percentile request duration');
    lines.push('# TYPE request_duration_p99 gauge');
    lines.push(`request_duration_p99 ${this.getPercentile(99)}`);

    // Per-method metrics
    lines.push('# HELP method_request_count Number of requests by method');
    lines.push('# TYPE method_request_count gauge');
    for (const [method, stats] of this.methodMetrics.entries()) {
      lines.push(`method_request_count{method="${method}"} ${stats.count}`);
    }

    // Status code metrics
    lines.push('# HELP status_code_count Number of responses by status code');
    lines.push('# TYPE status_code_count gauge');
    for (const [code, count] of this.statusCodeMetrics.entries()) {
      lines.push(`status_code_count{code="${code}"} ${count}`);
    }

    // Cache metrics
    lines.push('# HELP cache_hits_total Total cache hits');
    lines.push('# TYPE cache_hits_total counter');
    lines.push(`cache_hits_total ${this.cacheHits}`);

    lines.push('# HELP cache_misses_total Total cache misses');
    lines.push('# TYPE cache_misses_total counter');
    lines.push(`cache_misses_total ${this.cacheMisses}`);

    // Worker metrics
    lines.push('# HELP worker_memory_mb Worker memory usage in MB');
    lines.push('# TYPE worker_memory_mb gauge');
    for (const [workerId, metrics] of this.workerMetrics.entries()) {
      lines.push(`worker_memory_mb{worker_id="${workerId}"} ${metrics.memoryMB}`);
    }

    lines.push('# HELP worker_uptime_seconds Worker uptime in seconds');
    lines.push('# TYPE worker_uptime_seconds gauge');
    for (const [workerId, metrics] of this.workerMetrics.entries()) {
      lines.push(`worker_uptime_seconds{worker_id="${workerId}"} ${Math.round(metrics.uptime / 1000)}`);
    }

    // System uptime
    lines.push('# HELP uptime_seconds System uptime in seconds');
    lines.push('# TYPE uptime_seconds gauge');
    const uptimeSeconds = Math.round((Date.now() - this.startTime) / 1000);
    lines.push(`uptime_seconds ${uptimeSeconds}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Get metrics summary
   */
  getSummary() {
    return {
      totalRequests: this.requestCount,
      totalErrors: this.requestErrorCount,
      errorRate: this.requestCount > 0
        ? (this.requestErrorCount / this.requestCount * 100).toFixed(2) + '%'
        : '0%',
      avgResponseTime: this.requestCount > 0
        ? Math.round(this.requestTotalDurationMs / this.requestCount) + 'ms'
        : '0ms',
      p95ResponseTime: this.getPercentile(95) + 'ms',
      p99ResponseTime: this.getPercentile(99) + 'ms',
      cacheHitRate: (this.cacheHits + this.cacheMisses) > 0
        ? (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(2) + '%'
        : '0%',
      workers: this.workerMetrics.size,
      uptime: Math.round((Date.now() - this.startTime) / 1000) + 's',
    };
  }
}

// Singleton instance
let metricsCollector = null;

/**
 * Get or create metrics collector
 */
export function getMetricsCollector() {
  if (!metricsCollector) {
    metricsCollector = new MetricsCollector();
  }
  return metricsCollector;
}
