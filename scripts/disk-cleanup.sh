#!/bin/bash
set -e

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [disk-cleanup]"

log() {
    echo "$LOG_PREFIX $1"
}

log "Starting disk cleanup"

BEFORE=$(df / | tail -1 | awk '{print $5}')
log "Disk usage before: $BEFORE"

log "Pruning unused Docker images..."
docker image prune -f 2>&1 | tail -1

log "Pruning Docker build cache..."
docker builder prune -f 2>&1 | tail -1

log "Pruning dangling volumes..."
docker volume prune -f 2>&1 | tail -1

AFTER=$(df / | tail -1 | awk '{print $5}')
log "Disk usage after: $AFTER"

log "Cleanup complete"
