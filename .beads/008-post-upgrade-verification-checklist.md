# Post-Upgrade Verification Checklist

## Summary

Runbook to verify full stack health after completing bead 006 (CockroachDB upgrade) and bead 007 (Huly platform upgrade). Execute this checklist after each upgrade step and again after the full upgrade is complete.

## Priority
**Medium** — Required companion to beads 006 and 007

## Execution Order

```
1. Backup everything (pre-upgrade)
2. Execute bead 006: CockroachDB v23.1 → v24.2 (3 version hops)
3. Run this checklist ← CHECKPOINT
4. Execute bead 007: Huly s0.7.343 → s0.7.353
5. Run this checklist ← CHECKPOINT
6. Monitor for 24 hours
7. Run this checklist one final time ← SIGN-OFF
```

## Checklist

### Phase 1: Infrastructure Health

```bash
# 1.1 All containers running
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null
```
- [ ] All services show `Up`
- [ ] cockroachdb shows `(healthy)`
- [ ] kafka shows `(healthy)`
- [ ] account shows `(healthy)`
- [ ] stats shows `(healthy)`
- [ ] All 5 transactors show `(healthy)`
- [ ] huly-mcp shows `(healthy)`
- [ ] huly-rest-api shows `(healthy)`

```bash
# 1.2 No restart loops
docker compose ps --format "{{.Name}} {{.Status}}" 2>/dev/null | grep -i restart
```
- [ ] No containers restarting

### Phase 2: CockroachDB Health

```bash
# 2.1 Version check
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT version();"
```
- [ ] After bead 006: Reports v24.2.x
- [ ] After bead 007: Still v24.2.x (unchanged)

```bash
# 2.2 Cluster version finalized
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SHOW CLUSTER SETTING version;"
```
- [ ] Reports `24.2`

```bash
# 2.3 Node liveness
docker exec huly-test-cockroachdb-1 /cockroach/cockroach node status --insecure
```
- [ ] `is_available: true`
- [ ] `is_live: true`

```bash
# 2.4 Table count preserved
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_extension', 'crdb_internal');"
```
- [ ] Count is 78 (or more if Huly migrations add tables)

```bash
# 2.5 No disk stall warnings (THE KEY METRIC)
docker compose logs cockroachdb --since=10m 2>&1 | grep -i 'disk slowness'
```
- [ ] No output (disk stalls resolved)

```bash
# 2.6 No slow raft commits
docker compose logs cockroachdb --since=10m 2>&1 | grep -i 'slow.*raft'
```
- [ ] No output

### Phase 3: Service Connectivity

```bash
# 3.1 Account → CockroachDB
docker exec huly-test-account-1 node -e "
const net = require('net');
const s = net.createConnection(26257, 'cockroachdb', () => { console.log('OK'); s.end(); });
s.on('error', (e) => console.log('FAIL', e.message));
s.setTimeout(5000, () => { console.log('TIMEOUT'); s.destroy(); });
"
```
- [ ] Prints `OK`

```bash
# 3.2 No CONNECT_TIMEOUT errors
docker compose logs account --since=10m 2>&1 | grep -c "CONNECT_TIMEOUT"
```
- [ ] Returns `0`

```bash
# 3.3 No ConnectionClosed errors
docker compose logs account --since=10m 2>&1 | grep -c "ConnectionClosed"
```
- [ ] Returns `0`

```bash
# 3.4 Transactor → Kafka connectivity
docker compose logs transactor-1 --since=5m 2>&1 | grep -c "EAI_AGAIN"
```
- [ ] Returns `0` (no DNS failures)

### Phase 4: Application Health

```bash
# 4.1 Web UI responds
curl -s -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://localhost:8101/
```
- [ ] HTTP 200 in <1s

```bash
# 4.2 MCP server healthy
curl -s http://localhost:3457/health | python3 -m json.tool
```
- [ ] `status: healthy`
- [ ] `sessions >= 0`

```bash
# 4.3 MCP query functional (end-to-end test)
curl -s -m 30 'http://localhost:3457/api/tools/huly_query' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"entity_type":"project","mode":"list"}}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('Success:', d.get('success')); print('Projects:', len(d.get('data',{}).get('result',{}).get('content',[{}])[0].get('text','').split('---')))"
```
- [ ] `Success: True`
- [ ] Projects count > 0

```bash
# 4.4 REST API healthy
curl -s http://localhost:3458/health
```
- [ ] Returns 200

```bash
# 4.5 MCP tool can create and query (write test)
curl -s -m 30 'http://localhost:3457/api/tools/huly_query' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"entity_type":"issue","mode":"search","query":"test","project":"HULLY"}}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('Search works:', d.get('success'))"
```
- [ ] `Search works: True`

### Phase 5: Performance Baseline

```bash
# 5.1 MCP query response time
time curl -s -m 30 'http://localhost:3457/api/tools/huly_query' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"entity_type":"project","mode":"list"}}' > /dev/null
```
- [ ] Under 5 seconds (was 1.7s before issues, 48s during)

```bash
# 5.2 Account service response time
time curl -s -m 10 http://localhost:8101/_accounts -X POST \
  -H 'Content-Type: application/json' \
  -d '{"method":"getStatistics","params":[]}' > /dev/null
```
- [ ] Under 2 seconds

```bash
# 5.3 Container resource usage
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null | \
  grep huly-test | sort
```
- [ ] CockroachDB: CPU < 30%, Memory < 2GB
- [ ] Transactors: CPU < 20% each, Memory < 500MB each
- [ ] Account: CPU < 10%, Memory < 300MB

### Phase 6: 24-Hour Stability Check

Run these after 24 hours of operation:

```bash
# 6.1 No disk stall warnings in 24h
docker compose logs cockroachdb --since=24h 2>&1 | grep -c 'disk slowness'
```
- [ ] Returns `0`

```bash
# 6.2 No CONNECT_TIMEOUT in 24h
docker compose logs account --since=24h 2>&1 | grep -c 'CONNECT_TIMEOUT'
```
- [ ] Returns `0`

```bash
# 6.3 No container restarts in 24h
docker compose ps --format "{{.Name}} {{.Status}}" 2>/dev/null | grep -v "Up [0-9]* hour"
```
- [ ] All containers up for 24+ hours

```bash
# 6.4 MCP pool connections stable
docker compose logs huly-mcp --since=24h 2>&1 | grep -c "No Huly client connections available"
```
- [ ] Returns `0`

## Sign-Off

| Check | After CRDB Upgrade | After Huly Upgrade | 24h Stability |
|-------|-------|-------|-------|
| All containers healthy | ☐ | ☐ | ☐ |
| No disk stall warnings | ☐ | ☐ | ☐ |
| No CONNECT_TIMEOUT | ☐ | ☐ | ☐ |
| MCP query works | ☐ | ☐ | ☐ |
| Web UI responds | ☐ | ☐ | ☐ |
| Performance baseline met | ☐ | ☐ | ☐ |

## Failure Response

If any check fails after the CockroachDB upgrade:
1. Check CockroachDB logs: `docker compose logs cockroachdb --since=10m`
2. If data corruption suspected → STOP, execute rollback from bead 006
3. If connection issues only → restart dependent services: `docker compose restart account transactor-1 transactor-2 transactor-3 transactor-4 transactor-5 huly-mcp`

If any check fails after the Huly platform upgrade:
1. Check if the failure existed before this upgrade (was it the CRDB step?)
2. If regression → rollback .env to s0.7.343, `docker compose up -d`
3. If new behavior → check Docker Hub for s0.7.354/355 which may have additional fixes

## References
- Bead 006: CockroachDB upgrade guide
- Bead 007: Huly platform upgrade guide
- Bead 003: Disk I/O slowness cascading failures (original diagnosis)
- Bead 004: Operational runbook for CockroachDB restart
