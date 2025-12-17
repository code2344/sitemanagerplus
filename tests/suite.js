/**
 * Test Suite for SiteManager+
 * 
 * Unit and integration tests for core functionality
 */

/**
 * Test runner
 */
class TestRunner {
  constructor() {
    this.tests = [];
    this.results = {
      passed: 0,
      failed: 0,
      errors: [],
    };
  }

  /**
   * Add a test
   */
  test(name, fn) {
    this.tests.push({ name, fn });
  }

  /**
   * Assert condition
   */
  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  /**
   * Assert equal
   */
  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`Expected ${expected} but got ${actual}: ${message}`);
    }
  }

  /**
   * Run all tests
   */
  async run() {
    console.log('🧪 Running SiteManager+ Test Suite\n');

    for (const test of this.tests) {
      try {
        await test.fn(this);
        this.results.passed++;
        console.log(`✓ ${test.name}`);
      } catch (err) {
        this.results.failed++;
        this.results.errors.push({
          test: test.name,
          error: err.message,
        });
        console.error(`✗ ${test.name}: ${err.message}`);
      }
    }

    console.log('\n📊 Test Results:');
    console.log(`Passed: ${this.results.passed}`);
    console.log(`Failed: ${this.results.failed}`);
    console.log(`Total: ${this.tests.length}`);

    return this.results.failed === 0;
  }
}

// Export test runner and examples
export { TestRunner };

/**
 * Create test suite
 */
export function createTestSuite() {
  const runner = new TestRunner();

  // Configuration tests
  runner.test('Config loads correctly', async (assert) => {
    const config = await import('../utils/config.js');
    assert.assert(config.default.port > 0, 'Port should be positive');
    assert.assert(config.default.staticSiteDir, 'Static site dir should be set');
  });

  // Health monitor tests
  runner.test('Health monitor tracks metrics', async (assert) => {
    const { WorkerHealth } = await import('../health/monitor.js');
    const health = new WorkerHealth(1);
    
    health.recordHeartbeat({ memoryUsageMB: 100, errorCount: 0, requestCount: 0 });
    assert.assert(health.memoryUsageMB === 100, 'Memory should be tracked');
  });

  // Maintenance manager tests
  runner.test('Maintenance mode state persistence', async (assert) => {
    const { MaintenanceManager } = await import('../maintenance/manager.js');
    const maintenance = new MaintenanceManager();
    
    maintenance.enable('test', null, 'test');
    assert.assert(maintenance.getState().enabled === true, 'Should be enabled');
    
    maintenance.disable();
    assert.assert(maintenance.getState().enabled === false, 'Should be disabled');
  });

  // Metrics tests
  runner.test('Metrics collector records requests', async (assert) => {
    const { MetricsCollector } = await import('../utils/metrics.js');
    const metrics = new MetricsCollector();
    
    metrics.recordRequest('GET', 200, 100, false);
    metrics.recordRequest('GET', 200, 150, false);
    assert.assert(metrics.requestCount === 2, 'Should record 2 requests');
    assert.assert(metrics.requestErrorCount === 0, 'Should have no errors');
  });

  // API Keys tests
  runner.test('API key generation and validation', async (assert) => {
    const { APIKeyManager } = await import('../utils/api-keys.js');
    const manager = new APIKeyManager();
    
    const keyResult = manager.generateKey('test-key');
    assert.assert(keyResult.key.startsWith('sm_'), 'Key should have correct prefix');
    
    const validated = manager.validateKey(keyResult.key);
    assert.assert(validated !== null, 'Key should validate');
  });

  return runner;
}
