# Huly Stack Reliability Improvement Plan

## Executive Summary

The Huly stack has experienced recurring failures due to:
1. **Disk I/O bottlenecks** causing CockroachDB stalls
2. **Missing service recovery** when dependencies restart
3. **No proactive monitoring** - issues discovered only when users report problems
4. **Single points of failure** in the architecture

This plan addresses each with concrete, prioritized improvements.

---

## Current Architecture Weaknesses

```
                    ┌─────────────────────────────────────────┐
                    │           SINGLE POINTS OF FAILURE       │
                    └─────────────────────────────────────────┘
                    
User Request → nginx → front → transactor-1..5 → CockroachDB (SINGLE)
                                    ↓                   ↓
                              Kafka (SINGLE)      ZFS Disk (SHARED)
```

**Critical Issues:**
- CockroachDB: Single node, no replication
- Kafka: Single broker, no redundancy  
- Storage: All services share same ZFS pool (noisy neighbor problem)
- Transactors: No automatic recovery from DB connection loss

---

## Priority 1: Immediate (This Week)

### 1.1 Automated Health Monitoring Script

Create a watchdog that monitors key services and auto-recovers:

```bash
#!/bin/bash
# /opt/stacks/huly-test-v07/scripts/huly-watchdog.sh

check_cockroach_disk_warnings() {
    warnings=$(docker logs huly-test-cockroachdb-1 --since 5m 2>&1 | grep -c "disk slowness")
    if [ "$warnings" -gt 0 ]; then
        echo "ALERT: CockroachDB disk slowness detected ($warnings warnings)"
        return 1
    fi
    return 0
}

check_transactor_hung_requests() {
    for i in 1 2 3 4 5; do
        hung=$(docker logs huly-test-transactor-$i-1 --since 5m 2>&1 | grep "request hang found" | tail -1 | jq -r '.total // 0')
        if [ "$hung" -gt 100 ]; then
            echo "ALERT: Transactor-$i has $hung hung requests"
            return 1
        fi
    done
    return 0
}

check_rest_api_health() {
    response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3458/health)
    if [ "$response" != "200" ]; then
        echo "ALERT: REST API unhealthy (HTTP $response)"
        return 1
    fi
    return 0
}
```

### 1.2 Cron-Based Disk Cleanup

Add automatic weekly cleanup:

```bash
# /etc/cron.d/huly-maintenance
0 3 * * 0 root docker image prune -f && docker builder prune -f >> /var/log/huly-maintenance.log 2>&1
```

### 1.3 ZFS Monitoring Alert

```bash
# Alert when ZFS pool exceeds 75%
USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$USAGE" -gt 75 ]; then
    echo "CRITICAL: Disk at ${USAGE}% - cleanup required"
fi
```

---

## Priority 2: Short-Term (Next 2 Weeks)

### 2.1 Add Proper Healthchecks to Transactors

Since transactors don't have HTTP health endpoints, create a sidecar healthcheck:

```yaml
# docker-compose.yml addition
transactor-healthcheck:
  image: alpine:latest
  command: |
    while true; do
      for i in 1 2 3 4 5; do
        # Check WebSocket connectivity
        if ! nc -z transactor-$i 3333; then
          echo "Transactor-$i WebSocket down"
        fi
      done
      sleep 30
    done
  depends_on:
    - transactor-1
    - transactor-2
    - transactor-3
    - transactor-4
    - transactor-5
```

### 2.2 Connection Pool Keepalive

Add to all transactors to prevent stale connections:

```yaml
environment:
  - DB_POOL_KEEPALIVE_INTERVAL=30000
  - DB_CONNECTION_TIMEOUT=10000
  - SERVER_WEBSOCKET_PING_INTERVAL=30000
```

### 2.3 Automatic Transactor Recovery

Modify REST API to detect and report transactor issues:

```javascript
// Add to huly-rest-api/server.js
setInterval(async () => {
  const unhealthyCount = transactorPool.filter(t => !t.healthy).length;
  if (unhealthyCount > 2) {
    console.error(`CRITICAL: ${unhealthyCount}/5 transactors unhealthy`);
    // Trigger recovery or alert
  }
}, 60000);
```

---

## Priority 3: Medium-Term (Next Month)

### 3.1 Dedicated Storage for CockroachDB

Move CockroachDB data to faster/dedicated storage:

```yaml
# docker-compose.yml
cockroachdb:
  volumes:
    - /mnt/fast-ssd/cockroach:/cockroach/cockroach-data  # Dedicated SSD
```

**Why:** The main failure mode is disk I/O contention. Isolating CockroachDB storage eliminates noisy neighbor issues.

### 3.2 Add Redis for Caching

Reduce database load with a caching layer:

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
  volumes:
    - redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
```

### 3.3 Prometheus + Grafana Monitoring

Add proper observability:

```yaml
prometheus:
  image: prom/prometheus
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  ports:
    - "9090:9090"

grafana:
  image: grafana/grafana
  ports:
    - "3000:3000"
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
```

**Metrics to track:**
- CockroachDB query latency (p50, p95, p99)
- Transactor request queue depth
- Disk I/O wait time
- Memory usage per service

---

## Priority 4: Long-Term (Next Quarter)

### 4.1 CockroachDB Cluster (3 Nodes)

Convert single-node to 3-node cluster for HA:

```yaml
cockroachdb-1:
  command: start --insecure --join=cockroachdb-1,cockroachdb-2,cockroachdb-3
  
cockroachdb-2:
  command: start --insecure --join=cockroachdb-1,cockroachdb-2,cockroachdb-3
  
cockroachdb-3:
  command: start --insecure --join=cockroachdb-1,cockroachdb-2,cockroachdb-3
```

**Benefits:**
- Automatic failover if one node dies
- No single point of failure
- Better read performance (load distribution)

### 4.2 Kafka Cluster (3 Brokers)

```yaml
kafka-1:
  environment:
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093
```

### 4.3 Load Balancer for Transactors

Currently REST API manages its own pool. Add proper LB:

```yaml
traefik:
  image: traefik:v2.10
  command:
    - --providers.docker
    - --entrypoints.transactor.address=:3333
  labels:
    - "traefik.tcp.routers.transactor.rule=HostSNI(`*`)"
    - "traefik.tcp.services.transactor.loadbalancer.server.port=3333"
```

---

## Quick Wins (Can Do Today)

| Action | Effort | Impact |
|--------|--------|--------|
| Run `docker system prune -a` | 5 min | High - reclaim ~70GB |
| Add disk usage cron alert | 10 min | Medium - early warning |
| Create watchdog script | 30 min | High - auto-detection |
| Add restart-db-stack.sh to docs | 5 min | High - faster recovery |

---

## Cost-Benefit Analysis

| Improvement | Effort | Reliability Gain | Recommended |
|-------------|--------|------------------|-------------|
| Watchdog script | Low | High | ✅ Now |
| Disk cleanup cron | Low | Medium | ✅ Now |
| Dedicated CockroachDB storage | Medium | Very High | ✅ Soon |
| Prometheus monitoring | Medium | High | ✅ Soon |
| CockroachDB cluster | High | Very High | Consider |
| Kafka cluster | High | Medium | Later |

---

## Implementation Order

1. **Today**: Watchdog script + disk cleanup cron
2. **This week**: Prometheus/Grafana basics
3. **Next week**: Dedicated storage for CockroachDB  
4. **This month**: Full monitoring dashboard
5. **Next quarter**: Evaluate clustering needs based on monitoring data
