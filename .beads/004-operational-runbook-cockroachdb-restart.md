# Operational Runbook: CockroachDB Restart Procedure

## Summary
When CockroachDB is restarted (manually or due to crash), dependent services MUST also be restarted to avoid hung request accumulation and stale connections.

## Priority
Critical - Operational procedure to prevent incidents

## The Problem
CockroachDB restart does NOT automatically recover transactor connections. Transactors will:
1. Hold stale connection pool references
2. Accumulate hung requests (observed: 6,909 requests, 3+ hours wait time)
3. Continue accepting WebSocket connections while unable to query DB
4. Require manual restart to recover

## Restart Procedure

### Step 1: Restart CockroachDB (if needed)
```bash
cd /opt/stacks/huly-test-v07
docker-compose restart cockroachdb
```

### Step 2: Wait for CockroachDB to be healthy
```bash
# Wait for healthy status
watch -n 5 'docker ps | grep cockroachdb'

# Verify node is ready
docker exec huly-test-cockroachdb-1 cockroach node status --insecure
```

### Step 3: ALWAYS Restart All Transactors
```bash
docker-compose restart transactor-1 transactor-2 transactor-3 transactor-4 transactor-5
```

### Step 4: Restart Dependent Services
```bash
docker-compose restart huly-rest-api huly-mcp
```

### Step 5: Verify Recovery
```bash
# Check REST API health
curl -s http://localhost:3458/health | jq .

# Check for hung requests (should be 0 after restart)
docker logs huly-test-transactor-1-1 --tail 100 2>&1 | grep -c "request hang found"

# Verify user connections
docker logs huly-test-transactor-1-1 --tail 50 2>&1 | grep "hello happen"
```

## Quick Recovery Script
Save as `/opt/stacks/huly-test-v07/scripts/restart-db-stack.sh`:

```bash
#!/bin/bash
set -e

cd /opt/stacks/huly-test-v07

echo "=== Restarting CockroachDB ==="
docker-compose restart cockroachdb
sleep 10

echo "=== Waiting for CockroachDB health ==="
for i in {1..30}; do
    if docker exec huly-test-cockroachdb-1 cockroach node status --insecure &>/dev/null; then
        echo "CockroachDB is ready"
        break
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

echo "=== Restarting Transactors ==="
docker-compose restart transactor-1 transactor-2 transactor-3 transactor-4 transactor-5
sleep 15

echo "=== Restarting API Services ==="
docker-compose restart huly-rest-api huly-mcp
sleep 10

echo "=== Verifying Health ==="
curl -s http://localhost:3458/health | jq .

echo "=== Done ==="
```

## Signs of Hung Request Accumulation
Monitor for these warning signs:

```bash
# Check transactor logs for hung requests
docker logs huly-test-transactor-1-1 2>&1 | grep "request hang found" | tail -5

# Example output indicating problem:
# {"level":"warn","message":"request hang found","sec":750,"total":1234}
```

If `total` is growing and `sec` is high (>60), restart transactors immediately.

## Monitoring Integration
Add to monitoring system:
```bash
# Prometheus/alerting query
docker logs huly-test-transactor-1-1 2>&1 | grep "request hang found" | tail -1 | jq -r '.total'
# Alert if > 100
```

## Related Beads
- 001: Transactor healthcheck false positive
- 002: Transactor DB connection resilience
- 003: Disk I/O slowness root cause
