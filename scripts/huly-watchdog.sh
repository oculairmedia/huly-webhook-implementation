#!/bin/bash
#
# Huly Stack Watchdog
# Monitors critical services and alerts/recovers on issues
#
# Run via cron every 5 minutes:
#   */5 * * * * /opt/stacks/huly-test-v07/scripts/huly-watchdog.sh >> /var/log/huly-watchdog.log 2>&1
#

STACK_DIR="/opt/stacks/huly-test-v07"
cd "$STACK_DIR"

ALERT_FILE="/tmp/huly-watchdog-alert"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [huly-watchdog]"

log() {
    echo "$LOG_PREFIX $1"
}

alert() {
    log "ALERT: $1"
    echo "$1" >> "$ALERT_FILE"
}

# Resolve container ID for a compose service (dynamic, not hardcoded)
get_container() {
    docker compose -f "$STACK_DIR/docker-compose.yml" ps -q "$1" 2>/dev/null | head -1
}

check_disk_usage() {
    local usage=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
    if [ "$usage" -gt 80 ]; then
        alert "CRITICAL: Disk at ${usage}% - immediate cleanup required"
        return 1
    elif [ "$usage" -gt 75 ]; then
        alert "WARNING: Disk at ${usage}% - cleanup recommended"
        return 0
    fi
    log "Disk usage: ${usage}%"
    return 0
}

check_cockroach_health() {
    local container
    container=$(get_container cockroachdb)
    if [ -z "$container" ]; then
        alert "CRITICAL: CockroachDB container not found"
        return 1
    fi

    if ! docker exec "$container" cockroach node status --insecure &>/dev/null; then
        alert "CRITICAL: CockroachDB not responding"
        return 1
    fi

    local warnings=$(docker logs "$container" --since 5m 2>&1 | grep -c "disk slowness" || true)
    if [ "$warnings" -gt 0 ]; then
        alert "WARNING: CockroachDB disk slowness detected ($warnings warnings in last 5m)"
        return 1
    fi

    log "CockroachDB: healthy"
    return 0
}

check_cockroach_memory() {
    local container
    container=$(get_container cockroachdb)
    if [ -z "$container" ]; then
        return 0
    fi

    local mem_usage mem_limit pct
    mem_usage=$(docker stats "$container" --no-stream --format '{{.MemUsage}}' 2>/dev/null | awk '{print $1}')
    mem_limit=$(docker stats "$container" --no-stream --format '{{.MemUsage}}' 2>/dev/null | awk '{print $3}')

    if [ -z "$mem_usage" ] || [ -z "$mem_limit" ]; then
        return 0
    fi

    pct=$(docker stats "$container" --no-stream --format '{{.MemPerc}}' 2>/dev/null | tr -d '%')
    if [ -z "$pct" ]; then
        return 0
    fi

    # Compare as integer (strip decimal)
    local pct_int=${pct%%.*}
    if [ "$pct_int" -gt 85 ] 2>/dev/null; then
        alert "CRITICAL: CockroachDB memory at ${pct}% of limit ($mem_usage / $mem_limit) - OOM risk"
        return 1
    elif [ "$pct_int" -gt 75 ] 2>/dev/null; then
        alert "WARNING: CockroachDB memory at ${pct}% of limit ($mem_usage / $mem_limit)"
        return 1
    fi

    log "CockroachDB memory: ${pct}% ($mem_usage / $mem_limit)"
    return 0
}

check_transactor_health() {
    local unhealthy=0

    for i in 1 2 3 4 5; do
        local container
        container=$(get_container "transactor-$i")

        if [ -z "$container" ]; then
            alert "CRITICAL: Transactor-$i container not found"
            ((unhealthy++)) || true
            continue
        fi

        if ! docker ps -q --filter "id=$container" --filter "status=running" | grep -q .; then
            alert "CRITICAL: Transactor-$i container not running"
            ((unhealthy++)) || true
            continue
        fi

        local hung=$(docker logs "$container" --since 5m 2>&1 | grep "request hang found" | tail -1 | grep -oP '"total":\K[0-9]+' || echo "0")
        if [ "$hung" -gt 100 ]; then
            alert "WARNING: Transactor-$i has $hung hung requests"
            ((unhealthy++)) || true
        fi
    done

    if [ "$unhealthy" -gt 2 ]; then
        alert "CRITICAL: $unhealthy/5 transactors unhealthy - consider restart"
        return 1
    fi

    log "Transactors: $((5-unhealthy))/5 healthy"
    return 0
}

check_elastic_health() {
    local container
    container=$(get_container elastic)
    if [ -z "$container" ]; then
        alert "CRITICAL: Elasticsearch container not found"
        return 1
    fi

    local health_json
    health_json=$(docker exec "$container" curl -s http://localhost:9200/_cluster/health 2>/dev/null)
    if [ -z "$health_json" ]; then
        alert "CRITICAL: Elasticsearch not responding"
        return 1
    fi

    local status
    status=$(echo "$health_json" | grep -oP '"status"\s*:\s*"\K[^"]+' || echo "unknown")
    if [ "$status" = "red" ]; then
        alert "CRITICAL: Elasticsearch cluster status is RED"
        return 1
    elif [ "$status" = "yellow" ]; then
        alert "WARNING: Elasticsearch cluster status is YELLOW"
        return 1
    fi

    log "Elasticsearch: $status"
    return 0
}

check_kafka_health() {
    local container
    container=$(get_container kafka)
    if [ -z "$container" ]; then
        alert "CRITICAL: Kafka container not found"
        return 1
    fi

    if ! docker exec "$container" /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 &>/dev/null; then
        alert "CRITICAL: Kafka broker not responding"
        return 1
    fi

    log "Kafka: healthy"
    return 0
}

check_rest_api_health() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3458/health 2>/dev/null || echo "000")

    if [ "$response" != "200" ]; then
        alert "WARNING: REST API unhealthy (HTTP $response)"
        return 1
    fi

    log "REST API: healthy"
    return 0
}

check_mcp_health() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3457/health 2>/dev/null || echo "000")

    if [ "$response" != "200" ]; then
        alert "WARNING: MCP Server unhealthy (HTTP $response)"
        return 1
    fi

    log "MCP Server: healthy"
    return 0
}

check_docker_log_sizes() {
    local warned=0
    local max_bytes=$((50 * 1024 * 1024))  # 50MB

    for log_file in /var/lib/docker/containers/*/*-json.log; do
        [ -f "$log_file" ] || continue
        local size=$(stat -c%s "$log_file" 2>/dev/null || echo "0")
        if [ "$size" -gt "$max_bytes" ] 2>/dev/null; then
            local size_mb=$((size / 1024 / 1024))
            local container_id=$(basename "$(dirname "$log_file")")
            local name=$(docker inspect --format '{{.Name}}' "$container_id" 2>/dev/null | tr -d '/')
            alert "WARNING: Docker log for ${name:-$container_id} is ${size_mb}MB (>50MB)"
            ((warned++)) || true
        fi
    done

    if [ "$warned" -eq 0 ]; then
        log "Docker logs: all within size limits"
    fi
    return 0
}

auto_recover() {
    if [ -f "$ALERT_FILE" ]; then
        local alerts=$(cat "$ALERT_FILE")

        if echo "$alerts" | grep -q "hung requests"; then
            log "Attempting auto-recovery: restarting transactors"
            docker compose restart transactor-1 transactor-2 transactor-3 transactor-4 transactor-5
            sleep 30
            docker compose restart huly-rest-api huly-mcp
        fi

        if echo "$alerts" | grep -q "REST API unhealthy"; then
            log "Attempting auto-recovery: restarting REST API"
            docker compose restart huly-rest-api
        fi

        rm -f "$ALERT_FILE"
    fi
}

main() {
    log "========== Watchdog Check Started =========="

    rm -f "$ALERT_FILE"

    check_disk_usage || true
    check_cockroach_health || true
    check_cockroach_memory || true
    check_transactor_health || true
    check_elastic_health || true
    check_kafka_health || true
    check_rest_api_health || true
    check_mcp_health || true
    check_docker_log_sizes || true

    if [ -f "$ALERT_FILE" ]; then
        log "Issues detected:"
        cat "$ALERT_FILE"

        if [ "${AUTO_RECOVER:-false}" = "true" ]; then
            auto_recover
        fi
    else
        log "All systems healthy"
    fi

    log "========== Watchdog Check Complete =========="
}

main "$@"
