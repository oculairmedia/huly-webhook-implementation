# Disk I/O Slowness Causes Cascading Service Failures

## Summary
The host system experiences periodic disk I/O slowness that causes CockroachDB to stall, which cascades into transactor failures and service degradation. This is an infrastructure-level issue affecting the entire Huly stack.

## Priority
High - Root cause of multiple service incidents

## Evidence
CockroachDB logs show repeated disk sync warnings:
```
WARNING: disk slowness detected: unable to sync log files within 10s
WARNING: disk slowness detected: unable to sync log files within 10s
WARNING: disk slowness detected: unable to sync log files within 10s
```

## Environment Analysis

### Storage Configuration
```bash
$ df -h /var/lib/docker
Filesystem                    Size  Used Avail Use% Mounted on
rpool/data/subvol-109-disk-0  360G  278G   83G  77% /
```

- **ZFS pool** at 77% capacity
- ZFS performance degrades significantly above 80% capacity
- Shared storage may have "noisy neighbor" issues

### Docker Disk Usage
```
Images:        154.5GB (95GB reclaimable)
Containers:    4.8GB
Local Volumes: 109GB (17GB reclaimable)
Build Cache:   3.5GB (all reclaimable)
```

**Total reclaimable: ~115GB** - significant cleanup possible

## Cascade Failure Pattern
```
Disk I/O Slowness
    |
    v
CockroachDB stalls (unable to sync WAL)
    |
    v
DB queries hang/timeout
    |
    v
Transactor connections become stale
    |
    v
Transactor request queue grows unbounded
    |
    v
REST API/MCP connections timeout
    |
    v
User-facing service degradation
```

## Impact
- CockroachDB restarts or hangs under I/O pressure
- All dependent services (transactors, REST API, MCP) affected
- Recovery requires manual restart of multiple services
- Data integrity risk if CockroachDB cannot sync WAL

## Proposed Solutions

### Immediate: Disk Cleanup
```bash
# Clean up reclaimable Docker resources
docker system prune -a --volumes

# Or selectively:
docker image prune -a          # Remove unused images (~95GB)
docker builder prune -a        # Remove build cache (~3.5GB)
docker volume prune            # Remove unused volumes (~17GB)
```

### Short-term: Monitoring
1. Add disk I/O monitoring (iowait, disk latency)
2. Alert when ZFS pool exceeds 75% capacity
3. Monitor CockroachDB logs for "disk slowness" warnings

### Medium-term: Storage Optimization
1. Move CockroachDB data to dedicated fast storage (SSD/NVMe)
2. Separate Docker volumes from system storage
3. Configure ZFS with appropriate recordsize for database workload

### Long-term: Infrastructure
1. Evaluate dedicated database hosting
2. Implement proper storage tiering (fast storage for DB, standard for files)
3. Add redundancy for critical data volumes

## Monitoring Commands
```bash
# Check ZFS pool status
zpool status
zpool list

# Check I/O wait (if available)
top -bn1 | grep "Cpu(s)" | awk '{print "I/O wait: " $10 "%"}'

# Check CockroachDB disk warnings
docker logs huly-test-cockroachdb-1 2>&1 | grep -c "disk slowness"

# Check disk latency (requires sysstat)
iostat -x 1 5
```

## Immediate Action Items
1. [ ] Run `docker system prune` to reclaim ~115GB
2. [ ] Set up ZFS capacity alerting at 75%
3. [ ] Document CockroachDB restart procedure (must include transactor restarts)
4. [ ] Consider moving CockroachDB volume to faster storage

## Related Issues
- Transactor healthcheck false positive (see bead 001)
- Transactor DB connection resilience (see bead 002)
