# Transactors Lack Database Connection Resilience

## Summary
Transactors do not recover gracefully when CockroachDB experiences connectivity issues. After a DB restart or timeout, transactors accumulate thousands of hung requests on stale connections, requiring manual restart to recover.

## Priority
High - Causes service degradation requiring manual intervention

## Incident Details (Jan 24-25, 2026)
- **6,909 hung requests** accumulated in transactor-1
- Requests waiting up to **10,470 seconds** (nearly 3 hours)
- All queries for GRAPH-* issues from workspace `67b37b17-c4f0-4c4c-b5d2-aa60f065d80a`
- Required manual restart of all 5 transactors to recover

## Root Cause Chain
1. **Disk I/O slowness** on host system (CockroachDB logged: "disk slowness detected: unable to sync log files within 10s")
2. **CockroachDB queries hung** due to slow disk syncs
3. **CockroachDB restarted** (either manually or crashed) ~14 hours before incident
4. **Transactors NOT restarted** - they were up for 46 hours with stale connection pools
5. **Stale connections returned errors**: `CONNECTION_ENDED`, `CONNECT_TIMEOUT`
6. **Transactors kept accepting WebSocket requests** but internal DB connections were dead
7. **Request queue grew unbounded** - no timeout/cleanup mechanism

## Observed Errors
```json
{"err":{"code":"CONNECTION_ENDED","message":"write CONNECTION_ENDED cockroachdb:26257"}}
{"level":"warn","message":"request hang found","sec":10470,"total":6909}
```

## Missing Resilience Features
The transactor service lacks:

1. **Connection Health Checks**: No periodic validation of DB connection liveness
2. **Request Timeouts**: No mechanism to abort queries that hang too long
3. **Connection Pool Recovery**: No automatic reconnection when DB comes back
4. **Circuit Breaker**: No protection against cascading failures
5. **Graceful Degradation**: No way to reject new requests when DB is unavailable

## Impact
- **User-facing degradation**: API calls hang indefinitely
- **Memory pressure**: Hung requests accumulate in memory
- **Manual intervention required**: Must restart transactors to recover
- **No visibility**: No alerts or metrics for hung request count

## Proposed Solutions

### Immediate Mitigation (Operational)
Create a runbook for transactor recovery:
```bash
# When CockroachDB is restarted, ALWAYS restart transactors:
docker-compose restart transactor-1 transactor-2 transactor-3 transactor-4 transactor-5

# Monitor for hung requests:
docker logs huly-test-transactor-1-1 2>&1 | grep "request hang found"
```

### Short-term (Infrastructure)
Add a sidecar or cron job that:
1. Monitors transactor logs for "request hang found" warnings
2. Automatically restarts transactor if hung request count exceeds threshold
3. Alerts operations team

### Long-term (Upstream Request)
Request Huly to add:
1. Configurable query timeouts (e.g., `DB_QUERY_TIMEOUT=30000`)
2. Connection pool health checks with automatic reconnection
3. Prometheus metrics for hung request count
4. Circuit breaker pattern for DB connectivity

## Workaround Implemented
We added connection resilience to the **REST API** (`huly-rest-api/server.js`):
- 30-second connection timeout per transactor
- Automatic retry with 2 attempts
- Background recovery scheduler (checks every 60 seconds)
- Graceful startup with partial transactor pool

This protects the REST API layer but does NOT fix the underlying transactor issue.

## Files Modified
- `/opt/stacks/huly-test-v07/huly-rest-api/server.js` - Added `CONNECTION_CONFIG`, `connectToTransactor()`, `scheduleTransactorRecovery()`

## Monitoring Commands
```bash
# Check for hung requests
docker logs huly-test-transactor-1-1 2>&1 | grep -c "request hang found"

# Check transactor memory (high memory = possible hung request buildup)
docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}" | grep transactor

# Check CockroachDB health
docker exec huly-test-cockroachdb-1 cockroach node status --insecure
```

## Related Issues
- Transactor healthcheck false positive (see bead 001)
- Disk I/O slowness causing DB issues (see bead 003)
