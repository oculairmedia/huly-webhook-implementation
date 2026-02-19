#!/bin/bash
set -e

cd /opt/stacks/huly-test-v07

echo "=== Huly Database Stack Recovery Script ==="
echo "This script restarts CockroachDB and all dependent services"
echo ""

echo "[1/5] Restarting CockroachDB..."
docker-compose restart cockroachdb
sleep 10

echo "[2/5] Waiting for CockroachDB health..."
for i in {1..30}; do
    if docker exec huly-test-cockroachdb-1 cockroach node status --insecure &>/dev/null; then
        echo "  ✅ CockroachDB is ready"
        break
    fi
    echo "  Waiting... ($i/30)"
    sleep 2
done

echo "[3/5] Restarting Transactors..."
docker-compose restart transactor-1 transactor-2 transactor-3 transactor-4 transactor-5
sleep 15

echo "[4/5] Restarting API Services..."
docker-compose restart huly-rest-api huly-mcp
sleep 10

echo "[5/5] Verifying Health..."
echo ""
echo "REST API Health:"
curl -s http://localhost:3458/health | jq . 2>/dev/null || echo "REST API not responding"
echo ""
echo "Service Status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "(transactor|cockroach|rest-api|mcp)" | head -10

echo ""
echo "=== Recovery Complete ==="
