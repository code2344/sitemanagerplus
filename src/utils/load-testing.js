/**
 * Load Testing Utilities
 * 
 * Endpoints for load testing and chaos engineering:
 * - Synthetic load generation
 * - Response time simulation
 * - Memory pressure testing
 * - Error injection
 * 
 * IMPORTANT: Only enabled in development mode for safety
 */

import logger from './logger.js';
import config from './config.js';

/**
 * Load test simulation
 */
export async function simulateLoad(duration = 5000, concurrency = 10) {
  if (config.nodeEnv !== 'development') {
    throw new Error('Load testing only available in development mode');
  }

  const results = {
    duration,
    concurrency,
    startTime: Date.now(),
    requestsCompleted: 0,
    requestsFailed: 0,
    responseTimes: [],
  };

  logger.info('Load test started', { duration, concurrency });

  const startTime = Date.now();
  while (Date.now() - startTime < duration) {
    // Simulate processing
    const taskStart = Date.now();
    
    // CPU work
    for (let i = 0; i < 100000; i++) {
      Math.sqrt(i);
    }

    const taskDuration = Date.now() - taskStart;
    results.responseTimes.push(taskDuration);
    results.requestsCompleted++;

    // Control concurrency with small delays
    if (results.requestsCompleted % concurrency === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  results.endTime = Date.now();
  results.avgResponseTime = results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length;
  results.maxResponseTime = Math.max(...results.responseTimes);
  results.minResponseTime = Math.min(...results.responseTimes);

  logger.info('Load test completed', results);

  return results;
}

/**
 * Simulate high memory usage
 */
export async function simulateHighMemory(sizeGB = 0.5, durationMs = 10000) {
  if (config.nodeEnv !== 'development') {
    throw new Error('Memory simulation only available in development mode');
  }

  logger.warn('Starting memory simulation', { sizeGB, durationMs });

  const arrays = [];
  const bytes = sizeGB * 1024 * 1024 * 1024;
  const chunkSize = 1024 * 1024; // 1MB chunks

  try {
    for (let i = 0; i < bytes / chunkSize; i++) {
      arrays.push(new Buffer(chunkSize));
    }

    logger.warn('Memory allocated', { usedGB: sizeGB });

    // Hold for duration
    await new Promise(resolve => setTimeout(resolve, durationMs));

    logger.info('Memory simulation ended, freeing memory...');
  } catch (err) {
    logger.error('Memory simulation error', { error: err.message });
    throw err;
  } finally {
    // Clear memory
    arrays.length = 0;
  }
}

/**
 * Simulate event loop lag
 */
export function simulateEventLoopLag(durationMs = 5000) {
  if (config.nodeEnv !== 'development') {
    throw new Error('Event loop lag simulation only available in development mode');
  }

  logger.warn('Starting event loop lag simulation', { durationMs });

  const startTime = Date.now();
  while (Date.now() - startTime < durationMs) {
    // Block event loop with CPU work
    for (let i = 0; i < 1000000; i++) {
      Math.sqrt(i);
    }
  }

  logger.info('Event loop lag simulation ended');
}

/**
 * Simulate crash
 */
export function simulateCrash() {
  if (config.nodeEnv !== 'development') {
    throw new Error('Crash simulation only available in development mode');
  }

  logger.warn('Simulating worker crash...');
  
  // Exit after short delay to allow response to be sent
  setTimeout(() => {
    process.exit(1);
  }, 100);
}

/**
 * Get load test results summary
 */
export function getLoadTestSummary(results) {
  return {
    totalRequests: results.requestsCompleted,
    failedRequests: results.requestsFailed,
    duration: results.endTime - results.startTime,
    avgResponseTime: Math.round(results.avgResponseTime),
    minResponseTime: results.minResponseTime,
    maxResponseTime: results.maxResponseTime,
    requestsPerSecond: (results.requestsCompleted / ((results.endTime - results.startTime) / 1000)).toFixed(2),
  };
}
