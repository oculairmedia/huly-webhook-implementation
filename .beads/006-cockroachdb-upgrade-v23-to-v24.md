# CockroachDB Upgrade: v23.1.11 → v24.2

## Summary

Upgrade CockroachDB from v23.1.11 to v24.2 (latest-v24.2) to resolve recurring disk I/O stalls, slow raft commits, and connection timeout cascades. This aligns with the upstream huly-selfhost recommended version.

## Priority
**Critical** — Root cause of recurring platform degradation

## Current State

| Attribute | Value |
|-----------|-------|
| Image | `cockroachdb/cockroach:v23.1.11` |
| Cluster version | `23.1` |
| Data size | 739 MB |
| Tables | 78 |
| Volume | `huly-test_cockroach_data` → `/var/lib/docker/volumes/huly-test_cockroach_data/_data` |
| Mode | Single-node, `--insecure` |
| Command | `start-single-node --insecure --cache=1GB --max-sql-memory=1GB` |

## Target State

| Attribute | Value |
|-----------|-------|
| Image | `cockroachdb/cockroach:latest-v24.2` |
| Command | `start-single-node --accept-sql-without-tls --cache=1GB --max-sql-memory=1GB` |

## Why This Upgrade

CockroachDB v23.1.11 exhibits three symptoms under shared-disk I/O pressure:

1. **Disk I/O stalls**: `WARNING: disk slowness detected: unable to sync log files within 10s`
2. **Slow raft commits**: `slow non-blocking raft commit: commit-wait 5-6 seconds` (should be <100ms)
3. **Connection timeout cascade**: Account service gets `CONNECT_TIMEOUT cockroachdb:26257`, causing platform-wide degradation

CockroachDB v24.2 includes:
- Improved fsync timeout handling and disk stall detection
- Better connection pool management under I/O pressure
- New metrics: `storage.write-stalls`, `storage.disk-stalled` for monitoring
- Performance improvements for single-node deployments

## Upgrade Path

CockroachDB requires sequential major version upgrades. From v23.1 → v24.2:
- v23.1 → v23.2 (intermediate step)
- v23.2 → v24.1 (intermediate step)
- v24.1 → v24.2 (target)

Each step requires the cluster version to be finalized before proceeding to the next major version.

## Pre-Upgrade Steps

### 1. Backup Database
```bash
# Stop all services that write to CockroachDB
docker compose stop account transactor-1 transactor-2 transactor-3 transactor-4 transactor-5 \
  workspace collaborator fulltext huly-mcp huly-rest-api huly-change-watcher github

# Create volume backup
sudo cp -a /var/lib/docker/volumes/huly-test_cockroach_data/_data \
  /var/lib/docker/volumes/huly-test_cockroach_data/_data.backup.v23.1

# Verify backup
sudo du -sh /var/lib/docker/volumes/huly-test_cockroach_data/_data.backup.v23.1
# Expected: ~739 MB
```

### 2. Verify Current State
```bash
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT version(); SHOW CLUSTER SETTING version;"
# Expected: v23.1.11, cluster version 23.1

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_extension', 'crdb_internal');"
# Expected: 78 tables
```

## Upgrade Execution

### Step 1: v23.1 → v23.2

```bash
# Update image in docker-compose.yml
# cockroachdb image: cockroachdb/cockroach:latest-v23.2

docker compose up -d cockroachdb
docker compose logs -f cockroachdb  # Watch for "node starting" message

# Verify upgrade
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT version();"
# Expected: v23.2.x

# Finalize cluster version
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SET CLUSTER SETTING version = crdb_internal.node_executable_version();"

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SHOW CLUSTER SETTING version;"
# Expected: 23.2
```

### Step 2: v23.2 → v24.1

```bash
# Update image in docker-compose.yml
# cockroachdb image: cockroachdb/cockroach:latest-v24.1

docker compose up -d cockroachdb
docker compose logs -f cockroachdb  # Watch for "node starting"

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT version();"

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SET CLUSTER SETTING version = crdb_internal.node_executable_version();"

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SHOW CLUSTER SETTING version;"
# Expected: 24.1
```

### Step 3: v24.1 → v24.2

```bash
# Update image in docker-compose.yml to final target
# cockroachdb image: cockroachdb/cockroach:latest-v24.2

docker compose up -d cockroachdb
docker compose logs -f cockroachdb

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT version();"

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SET CLUSTER SETTING version = crdb_internal.node_executable_version();"

docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SHOW CLUSTER SETTING version;"
# Expected: 24.2
```

### Step 4: Update Command Flags

The upstream uses `--accept-sql-without-tls` instead of `--insecure`. Update `docker-compose.yml`:

```yaml
cockroachdb:
  image: cockroachdb/cockroach:latest-v24.2
  command: start-single-node --accept-sql-without-tls --cache=1GB --max-sql-memory=1GB
```

Note: `--accept-sql-without-tls` is the v24.2 replacement for `--insecure` for SQL connections. Verify compatibility before switching — if Huly services use the CockroachDB RPC port (26257) for anything beyond SQL, `--insecure` may still be needed.

## Post-Upgrade Verification

```bash
# 1. Verify version
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT version(); SHOW CLUSTER SETTING version;"

# 2. Verify table count unchanged
docker exec huly-test-cockroachdb-1 /cockroach/cockroach sql --insecure \
  -e "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_extension', 'crdb_internal');"
# Expected: 78

# 3. Restart all dependent services
docker compose up -d

# 4. Wait for healthchecks
sleep 60
docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -E 'cockroach|account|transactor'
# All should show (healthy)

# 5. Test account→CRDB connectivity
docker exec huly-test-account-1 node -e "
const net = require('net');
const s = net.createConnection(26257, 'cockroachdb', () => { console.log('OK'); s.end(); });
s.on('error', (e) => console.log('FAIL', e.message));
s.setTimeout(5000, () => { console.log('TIMEOUT'); s.destroy(); });
"

# 6. Test MCP end-to-end
curl -s -m 30 'http://localhost:3457/api/tools/huly_query' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"entity_type":"project","mode":"list"}}' | python3 -c "
import sys,json; d=json.load(sys.stdin); print('Success:', d.get('success'))
"

# 7. Monitor for disk stall warnings (should be gone)
docker compose logs cockroachdb --since=5m 2>&1 | grep -i 'disk slowness'
# Expected: no output
```

## Rollback Plan

```bash
# Stop everything
docker compose down

# Restore backup
sudo rm -rf /var/lib/docker/volumes/huly-test_cockroach_data/_data
sudo mv /var/lib/docker/volumes/huly-test_cockroach_data/_data.backup.v23.1 \
  /var/lib/docker/volumes/huly-test_cockroach_data/_data

# Revert docker-compose.yml cockroachdb image to v23.1.11
# Then restart
docker compose up -d
```

## Estimated Downtime
- Each version hop: ~2-3 minutes (CRDB restart + migration)
- Total for 3 hops: ~10-15 minutes
- Full stack restart after: ~2 minutes
- **Total: ~15-20 minutes**

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Schema incompatibility | Low | Huly upstream uses v24.2 successfully |
| Data migration failure | Low | Full backup before each step |
| `--insecure` → `--accept-sql-without-tls` breaks RPC | Medium | Test with `--insecure` first, switch flag separately |
| Intermediate version has bugs | Low | Using latest patch of each major (latest-vXX.Y) |

## Files to Modify
- `/opt/stacks/huly-test-v07/docker-compose.yml` — cockroachdb `image` and `command`

## References
- Upstream compose.yml: https://github.com/hcengineering/huly-selfhost/blob/cba5f20/compose.yml#L14
- CockroachDB upgrade docs: https://www.cockroachlabs.com/docs/v24.2/upgrade-cockroach-version
- CockroachDB v24.2 release: https://github.com/cockroachdb/cockroach/releases/tag/v24.2.10
- Related bead: 003-disk-io-slowness-cascading-failures.md
