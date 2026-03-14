#!/bin/bash
#
# Huly Stack Watchdog
# Monitors critical services and alerts/recovers on issues
#
# Run via cron every 5 minutes:
#   */5 * * * * /opt/stacks/huly-test-v07/scripts/huly-watchdog.sh >> /var/log/huly-watchdog.log 2>&1
#

STACK_DIR="${STACK_DIR:-/opt/stacks/huly-test-v07}"
cd "$STACK_DIR"

ALERT_FILE="/tmp/huly-watchdog-alert"
AUTH_PROBE_STATE_DIR="/tmp/huly-watchdog-auth-probe"
RESTART_STATE_DIR="/tmp/huly-watchdog-restarts"
AUTH_PROBE_FAILURE_THRESHOLD="${TRANSACTOR_AUTH_FAILURE_THRESHOLD:-3}"
TRANSACTOR_RESTART_COOLDOWN_SECONDS="${TRANSACTOR_RESTART_COOLDOWN_SECONDS:-300}"
PROBE_RUNNER_IMAGE="${TRANSACTOR_PROBE_IMAGE:-huly-huly-mcp:latest}"
PROBE_SCRIPT_PATH="$STACK_DIR/scripts/transactor-auth-healthcheck.js"
PROBE_ACCOUNTS_URL="${TRANSACTOR_PROBE_ACCOUNTS_URL:-http://account:3000}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-huly-test}"
REST_HEALTH_URL="${REST_HEALTH_URL:-http://localhost:3458/health}"
MCP_HEALTH_URL="${MCP_HEALTH_URL:-http://localhost:3457/health}"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [huly-watchdog]"

mkdir -p "$AUTH_PROBE_STATE_DIR"
mkdir -p "$RESTART_STATE_DIR"

log() {
    echo "$LOG_PREFIX $1"
}

alert() {
    log "ALERT: $1"
    echo "$1" >> "$ALERT_FILE"
}

# Resolve container ID for a compose service (dynamic, not hardcoded)
get_container() {
    docker ps -aq \
        --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
        --filter "label=com.docker.compose.service=$1" \
        | head -1
}

get_container_env() {
    local service="$1"
    local key="$2"
    local fallback="$3"
    local container value

    container=$(get_container "$service")
    if [ -n "$container" ]; then
        value=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep "^${key}=" | tail -1 | cut -d= -f2-)
    fi

    echo "${value:-$fallback}"
}

get_stack_network() {
    local container
    container=$(get_container account)
    if [ -z "$container" ]; then
        return 1
    fi

    docker inspect "$container" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' 2>/dev/null | head -1
}

read_restart_timestamp() {
    local service="$1"
    local state_file="$RESTART_STATE_DIR/${service}.last_restart"

    if [ -f "$state_file" ]; then
        cat "$state_file"
    else
        echo "0"
    fi
}

write_restart_timestamp() {
    local service="$1"
    local ts="$2"
    local state_file="$RESTART_STATE_DIR/${service}.last_restart"

    printf '%s\n' "$ts" > "$state_file"
}

restart_in_cooldown() {
    local service="$1"
    local now last

    now=$(date +%s)
    last=$(read_restart_timestamp "$service")

    if ! [[ "$last" =~ ^[0-9]+$ ]]; then
        last=0
    fi

    [ $((now - last)) -lt "$TRANSACTOR_RESTART_COOLDOWN_SECONDS" ]
}

restart_container() {
    local service="$1"
    local container

    container=$(get_container "$service")
    if [ -z "$container" ]; then
        alert "CRITICAL: $service container not found for restart"
        return 1
    fi

    if docker restart "$container" >/dev/null 2>&1; then
        write_restart_timestamp "$service" "$(date +%s)"
        log "Restarted $service container $container"
        return 0
    fi

    alert "CRITICAL: Failed to restart $service container $container"
    return 1
}

read_auth_probe_failures() {
    local service="$1"
    local state_file="$AUTH_PROBE_STATE_DIR/${service}.count"

    if [ -f "$state_file" ]; then
        cat "$state_file"
    else
        echo "0"
    fi
}

write_auth_probe_failures() {
    local service="$1"
    local count="$2"
    local state_file="$AUTH_PROBE_STATE_DIR/${service}.count"

    printf '%s\n' "$count" > "$state_file"
}

run_transactor_auth_probe() {
    local service="$1"
    local candidate_url="$2"
    local network email password workspace prior_count next_count output status

    network=$(get_stack_network)
    if [ -z "$network" ]; then
        alert "CRITICAL: Unable to determine Huly Docker network for authenticated transactor probe"
        return 1
    fi

    email=$(get_container_env huly-mcp HULY_EMAIL "emanuvaderland@gmail.com")
    password=$(get_container_env huly-mcp HULY_PASSWORD "k2a8yy7sFWVZ6eL")
    workspace=$(get_container_env huly-mcp HULY_WORKSPACE "agentspace")
    prior_count=$(read_auth_probe_failures "$service")
    if ! [[ "$prior_count" =~ ^[0-9]+$ ]]; then
        prior_count=0
    fi
    next_count=$((prior_count + 1))

    output=$(docker run --rm \
        --network "$network" \
        -v "$PROBE_SCRIPT_PATH:/app/transactor-auth-healthcheck.js:ro" \
        -e ACCOUNTS_URL="$PROBE_ACCOUNTS_URL" \
        -e HULY_EMAIL="$email" \
        -e HULY_PASSWORD="$password" \
        -e HULY_WORKSPACE="$workspace" \
        -e TRANSACTOR_NODE_IDENTITY="$service" \
        -e TRANSACTOR_AUTH_FAILURE_COUNT="$next_count" \
        "$PROBE_RUNNER_IMAGE" \
        node /app/transactor-auth-healthcheck.js --candidate-url "$candidate_url" 2>&1)
    status=$?

    if [ "$status" -eq 0 ]; then
        if [ "$prior_count" -gt 0 ] 2>/dev/null; then
            log "$service authenticated probe recovered after $prior_count consecutive failures"
        fi
        write_auth_probe_failures "$service" "0"
        log "$service authenticated probe: healthy"
        return 0
    fi

    write_auth_probe_failures "$service" "$next_count"
    log "$service authenticated probe output: $output"
    alert "WARNING: $service failed authenticated probe (${next_count}/${AUTH_PROBE_FAILURE_THRESHOLD})"

    if [ "$next_count" -ge "$AUTH_PROBE_FAILURE_THRESHOLD" ] 2>/dev/null; then
        alert "CRITICAL: $service failed ${next_count} consecutive authenticated probes"
    fi

    return 1
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

        if ! run_transactor_auth_probe "transactor-$i" "ws://transactor-$i:3333"; then
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
    local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$REST_HEALTH_URL" 2>/dev/null || echo "000")

    if [ "$response" != "200" ]; then
        alert "WARNING: REST API unhealthy (HTTP $response)"
        return 1
    fi

    log "REST API: healthy"
    return 0
}

check_mcp_health() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$MCP_HEALTH_URL" 2>/dev/null || echo "000")

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

    if [ ! -d /var/lib/docker/containers ]; then
        log "Docker logs: host container log directory not mounted; skipping size check"
        return 0
    fi

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
            for service in transactor-1 transactor-2 transactor-3 transactor-4 transactor-5; do
                restart_container "$service" || true
                sleep 10
            done
            sleep 30
            restart_container huly-rest-api || true
            restart_container huly-mcp || true
        fi

        if echo "$alerts" | grep -q "REST API unhealthy"; then
            log "Attempting auto-recovery: restarting REST API"
            restart_container huly-rest-api || true
        fi

        if echo "$alerts" | grep -q "consecutive authenticated probes"; then
            local services restarted=0
            services=$(echo "$alerts" | grep "consecutive authenticated probes" | grep -oE 'transactor-[0-9]+' | sort -u)

            if ! check_cockroach_health >/dev/null 2>&1; then
                alert "WARNING: Skipping transactor auto-recovery while CockroachDB is unhealthy"
                rm -f "$ALERT_FILE"
                return
            fi

            for service in $services; do
                if restart_in_cooldown "$service"; then
                    log "Skipping $service restart; still in cooldown window"
                    continue
                fi

                log "Attempting auto-recovery: restarting $service after authenticated probe failures"
                if restart_container "$service"; then
                    write_auth_probe_failures "$service" "0"
                    restarted=1
                    break
                fi
            done

            if [ "$restarted" -eq 0 ]; then
                log "No transactor restart performed; all failing services were in cooldown or restart failed"
            fi
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
