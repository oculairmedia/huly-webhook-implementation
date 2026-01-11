# Huly Change Watcher - Test Documentation

## Test Coverage Summary

**Total Tests: 21 passed** ✅

### Test Suites

#### 1. Webhook Subscriptions (`tests/webhook-subscriptions.test.js`)
Tests the HTTP API for managing webhook subscriptions.

**Tests (8):**
- ✅ Subscribe endpoint accepts valid webhook URLs
- ✅ Subscribe endpoint rejects invalid URLs
- ✅ Subscribe endpoint rejects duplicate subscriptions
- ✅ Unsubscribe endpoint removes existing subscribers
- ✅ Unsubscribe endpoint handles non-existent subscribers gracefully
- ✅ List subscribers endpoint returns all webhook subscribers
- ✅ Subscribers persist across multiple operations
- ✅ Multiple subscribers can be managed independently

**Endpoints Tested:**
- `POST /subscribe` - Add webhook URL
- `POST /unsubscribe` - Remove webhook URL
- `GET /subscribers` - List all webhook subscribers

#### 2. Change Detection (`tests/change-detection.test.js`)
Tests the core change detection logic for both issues and projects.

**Tests (7):**
- ✅ Detects issue updates in task table
- ✅ Detects project updates in space table
- ✅ Returns combined changes from both tables
- ✅ Filters changes by timestamp correctly
- ✅ Maps issue changes to correct event type (issue.updated)
- ✅ Maps project changes to correct event type (project.updated)
- ✅ Handles empty results gracefully

**Database Tables Monitored:**
- `task` table - Issues with `_class = 'tracker:class:Issue'`
- `space` table - Projects with `_class = 'tracker:class:Project'`

**Event Types Emitted:**
- `issue.updated` - When tracker:class:Issue changes
- `task.updated` - When other task types change
- `project.updated` - When tracker:class:Project changes

#### 3. Webhook Emission (`tests/webhook-emission.test.js`)
Tests webhook delivery to subscribers.

**Tests (6):**
- ✅ Emits webhooks to all registered subscribers
- ✅ Includes correct event payload structure
- ✅ Handles webhook delivery failures gracefully
- ✅ Continues delivery to remaining subscribers on failure
- ✅ Tracks webhook send statistics correctly
- ✅ Respects timeout configuration (5 seconds)

**Webhook Payload Format:**
```json
{
  "type": "issue.updated" | "task.updated" | "project.updated",
  "timestamp": 1234567890123,
  "data": {
    "_id": "string",
    "_class": "string",
    "space": "string",
    "identifier": "PROJ-123",
    "title": "Issue title" | "name": "Project name",
    "status": "string",
    "modifiedBy": "string",
    "modifiedOn": 1234567890123
  }
}
```

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Test Suite
```bash
npm test webhook-subscriptions.test.js
npm test change-detection.test.js
npm test webhook-emission.test.js
```

### Run with Coverage
```bash
npm test -- --coverage
```

### Run in Watch Mode
```bash
npm test -- --watch
```

## Test Environment

**Test Framework:** Jest 29.7.0
**Node Options:** `--experimental-vm-modules` (for ES module support)
**Test Timeout:** 10 seconds per test
**Force Exit:** Tests use `--forceExit` to handle async cleanup

## Mock Data

Tests use mock database pools and HTTP servers to avoid external dependencies:

- **Mock Database Pool:** Simulates CockroachDB queries with predefined results
- **Mock HTTP Server:** Simulates webhook receiver endpoints
- **Mock SSE Clients:** Simulates Server-Sent Events subscribers

## Testing Best Practices

1. **Isolation:** Each test suite runs independently with its own mocks
2. **Cleanup:** All HTTP servers and database connections properly closed after tests
3. **Realistic Data:** Mock data matches actual Huly database schema
4. **Error Handling:** Tests verify both success and failure scenarios
5. **Async Safety:** Proper use of `async/await` and connection draining

## Coverage Goals

- **Statement Coverage:** 90%+
- **Branch Coverage:** 85%+
- **Function Coverage:** 90%+
- **Line Coverage:** 90%+

## Known Issues

- Tests require `--forceExit` due to Jest's async operation detection
- Consider using `--detectOpenHandles` for debugging async issues in development

## Future Test Improvements

1. Add integration tests with real CockroachDB instance
2. Add load testing for high-volume change scenarios
3. Add end-to-end tests with actual Huly transactor
4. Add performance benchmarks for polling intervals
5. Add security tests for webhook authentication
