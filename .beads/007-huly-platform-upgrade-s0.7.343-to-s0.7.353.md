# Huly Platform Upgrade: s0.7.343 → s0.7.353

## Summary

Upgrade all Huly platform services from s0.7.343 to s0.7.353 to pick up connection timeout fixes and align with the latest upstream selfhost release.

## Priority
**High** — Includes fix for connection drop/timeout handling (commit 2165c39)

## Current State

| Attribute | Value |
|-----------|-------|
| HULY_VERSION | `s0.7.343` |
| Config file | `/opt/stacks/huly-test-v07/.env` |
| Services using HULY_VERSION | account, collaborator, front, fulltext, github, rekoni, stats, transactor (x5), workspace |

## Target State

| Attribute | Value |
|-----------|-------|
| HULY_VERSION | `s0.7.353` |

## What Changed Between s0.7.343 and s0.7.353

Key fix: **Commit 2165c39** — "fix: correctly dropping connections in timeout"
- Directly addresses the `CONNECT_TIMEOUT` and `ConnectionClosed` errors we see
- Account service connection pool handling improved
- Transactor reconnection logic improved

Upstream selfhost bumped to s0.7.353 on 2026-01-25 (commit cba5f20).

## Differences From Upstream

Our deployment differs from upstream in these ways (must preserve during upgrade):

| Aspect | Upstream | Ours | Action |
|--------|----------|------|--------|
| Transactors | 1 | 5 | Keep 5 |
| Message queue | Redpanda | Kafka | Keep Kafka |
| CockroachDB flags | `--accept-sql-without-tls` | `--insecure --cache=1GB --max-sql-memory=1GB` | Handle in bead 006 |
| GitHub service | Not included | Included | Keep |
| huly-mcp | Not included | Included (custom) | Keep |
| huly-rest-api | Not included | Included (custom) | Keep |
| huly-change-watcher | Not included | Included (custom) | Keep |
| New: hulykvs | Included in upstream | Not present | Evaluate adding |
| Healthchecks | Minimal | Comprehensive (just added) | Keep ours |
| depends_on chain | 1 entry | Full chain with service_healthy | Keep ours |
| DB connection env vars | Not set | DB_POOL_MAX=20, etc. | Keep ours |

## Pre-Upgrade Steps

### 1. Verify Image Availability
```bash
for svc in account collaborator front fulltext github rekoni-service stats transactor workspace; do
  echo -n "$svc s0.7.353: "
  docker pull hardcoreeng/$svc:s0.7.353 --quiet 2>/dev/null && echo "OK" || echo "MISSING"
done
```

### 2. Backup Current .env
```bash
cp .env .env.backup.s0.7.343
```

### 3. Pre-Pull Images (Minimize Downtime)
```bash
for svc in account collaborator front fulltext github rekoni-service stats transactor workspace; do
  docker pull hardcoreeng/$svc:s0.7.353 &
done
wait
echo "All images pulled"
```

## Upgrade Execution

### Step 1: Update Version
```bash
# Edit .env
sed -i 's/HULY_VERSION=s0.7.343/HULY_VERSION=s0.7.353/' .env

# Verify
grep HULY_VERSION .env
# Expected: HULY_VERSION=s0.7.353
```

### Step 2: Rolling Restart
```bash
docker compose up -d
```

The dependency chain (from bead 006 healthcheck work) ensures correct startup order:
1. cockroachdb + kafka + stats become healthy
2. account starts and becomes healthy
3. transactors start and become healthy
4. huly-mcp + huly-rest-api start

### Step 3: Monitor Startup
```bash
watch -n5 'docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null'
```

Wait until all services show `(healthy)` or `Up` with no `(health: starting)`.

## Post-Upgrade Verification

```bash
# 1. All services running
docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -v "Up"
# Expected: only header line

# 2. Account service connects to CRDB without timeout
docker compose logs account --since=5m 2>&1 | grep -c "CONNECT_TIMEOUT"
# Expected: 0

# 3. Web UI accessible
curl -s -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://localhost:8101/
# Expected: HTTP 200 in <1s

# 4. MCP query works
curl -s -m 30 'http://localhost:3457/api/tools/huly_query' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"entity_type":"project","mode":"list"}}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('Success:', d.get('success'))"
# Expected: Success: True

# 5. Check version in running containers
docker exec huly-test-account-1 node -e "console.log(process.env.npm_package_version || 'no version')" 2>/dev/null
docker compose logs account --since=1m 2>&1 | head -5
```

## Rollback Plan

```bash
# Revert .env
cp .env.backup.s0.7.343 .env

# Restart with old version
docker compose up -d
```

## New Upstream Service: hulykvs

The upstream s0.7.353 compose includes a new `hulykvs` service not present in our deployment:
```yaml
hulykvs:
  image: hardcoreeng/hulykvs:${HULY_VERSION}
  depends_on:
    cockroach:
      condition: service_started
```

This is likely a key-value store cache layer in front of CockroachDB. Evaluate adding it after the base upgrade is stable — it may further reduce CockroachDB I/O pressure.

## Estimated Downtime
- Image pull (pre-pulled): 0 minutes
- `docker compose up -d`: ~2-3 minutes for rolling restart
- Healthcheck convergence: ~1-2 minutes
- **Total: ~5 minutes**

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking change in platform | Low | Upstream selfhost tested with this version |
| Custom services (MCP, REST API) incompatible | Low | They use SDK v0.6.x which talks via WebSocket, version-agnostic |
| GitHub integration breaks | Low | Same env vars, just newer image |
| DB migration required | Medium | Huly auto-migrates on startup; monitor transactor logs |

## Upgrade Order Recommendation

**Do CockroachDB upgrade (bead 006) FIRST, then Huly platform upgrade (this bead).**

Rationale: The connection timeout fix in s0.7.353 works best when the underlying database is stable. Upgrading CRDB first eliminates the I/O stalls, then the Huly upgrade adds better connection handling on top.

## Files to Modify
- `/opt/stacks/huly-test-v07/.env` — `HULY_VERSION` value

## References
- Upstream release commit: https://github.com/hcengineering/huly-selfhost/commit/cba5f20f (Update to v0.7.353)
- Connection fix: https://github.com/hcengineering/platform/commit/2165c39 (fix: correctly dropping connections in timeout)
- Docker Hub: https://hub.docker.com/r/hardcoreeng/transactor/tags
