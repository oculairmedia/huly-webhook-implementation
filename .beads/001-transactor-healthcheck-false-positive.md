# Transactor Docker Healthcheck Returns False Positive "Unhealthy"

## Summary
All 5 transactors show as "unhealthy" in Docker despite functioning correctly. This is a false positive caused by an incorrect healthcheck configuration.

## Priority
Medium - Operational visibility issue, not a functional problem

## Current Behavior
```bash
$ docker ps --format "table {{.Names}}\t{{.Status}}" | grep transactor
huly-test-transactor-1-1   Up 4 minutes (unhealthy)
huly-test-transactor-2-1   Up 4 minutes (unhealthy)
huly-test-transactor-3-1   Up 4 minutes (unhealthy)
huly-test-transactor-4-1   Up 4 minutes (unhealthy)
huly-test-transactor-5-1   Up 4 minutes (unhealthy)
```

## Root Cause
The Docker healthcheck in `docker-compose.yml` is configured to check `GET /`:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3333/"]
  interval: 30s
  timeout: 10s
  retries: 3
```

The transactor service does NOT have a root `/` endpoint. It returns 404:
```
GET / HTTP/1.1 404 139
```

Docker interprets 404 as unhealthy, even though the transactor is working perfectly.

## Evidence
Transactor logs show successful operations while marked "unhealthy":
```json
{"level":"info","message":"hello happen","source":"user","totalUsers":2}  // Users connecting
{"level":"info","message":"PUT /api/v1/broadcast... 200"}                  // API calls succeeding
{"level":"info","message":"consumer connected to queue"}                   // Kafka working
```

## Impact
1. **Monitoring confusion**: Operators see "unhealthy" and may restart working services
2. **Orchestration issues**: Docker Swarm/Kubernetes may incorrectly restart healthy containers
3. **Alert fatigue**: Monitoring systems may fire false alarms

## Proposed Solutions

### Option 1: Remove Healthcheck (Quick Fix)
Remove the healthcheck entirely since transactors don't expose HTTP health endpoints:
```yaml
transactor-1:
  # Remove healthcheck section entirely
```

### Option 2: WebSocket-Based Check (Better)
Use a script that tests WebSocket connectivity:
```yaml
healthcheck:
  test: ["CMD", "/healthcheck.sh"]
  interval: 30s
  timeout: 10s
  retries: 3
```

Where `healthcheck.sh` attempts a WebSocket handshake to `ws://localhost:3333`.

### Option 3: Add Health Endpoint to Transactor (Best, but requires upstream)
Request Huly to add a `/health` endpoint to the transactor service. This would require changes to Huly's codebase.

## Recommended Action
Implement Option 1 (remove healthcheck) immediately to stop false positives. Consider Option 2 for better operational visibility.

## Files to Modify
- `/opt/stacks/huly-test-v07/docker-compose.yml` - Remove or fix healthcheck for all 5 transactors

## Testing
After fix:
```bash
docker-compose up -d transactor-1 transactor-2 transactor-3 transactor-4 transactor-5
sleep 60
docker ps | grep transactor  # Should show "Up X minutes" without "(unhealthy)"
```

## Related Issues
- Transactor connection resilience (see bead 002)
- CockroachDB disk I/O causing cascading failures (see bead 003)
