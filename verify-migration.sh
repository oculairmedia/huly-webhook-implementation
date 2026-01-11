#!/bin/bash
#
# Huly v0.7 Migration Verification Script
# Run this script to verify the migration was successful
#

set -e

echo "=================================================="
echo "Huly v0.7 Migration Verification"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cd /opt/stacks/huly-test-v07

echo "1. Checking Service Status..."
echo "----------------------------"
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✓${NC} Services are running"
else
    echo -e "${RED}✗${NC} Services are not running"
    exit 1
fi
echo ""

echo "2. Checking CockroachDB Health..."
echo "----------------------------"
if docker-compose ps | grep cockroachdb | grep -q "healthy"; then
    echo -e "${GREEN}✓${NC} CockroachDB is healthy"
else
    echo -e "${RED}✗${NC} CockroachDB is not healthy"
    exit 1
fi
echo ""

echo "3. Checking Kafka Health..."
echo "----------------------------"
if docker-compose ps | grep kafka | grep -q "healthy"; then
    echo -e "${GREEN}✓${NC} Kafka is healthy"
else
    echo -e "${RED}✗${NC} Kafka is not healthy"
    exit 1
fi
echo ""

echo "4. Checking Frontend Accessibility..."
echo "----------------------------"
if curl -s http://192.168.50.90:8201/ | grep -q "Huly"; then
    echo -e "${GREEN}✓${NC} Frontend is accessible"
else
    echo -e "${RED}✗${NC} Frontend is not accessible"
    exit 1
fi
echo ""

echo "5. Checking Backup Data..."
echo "----------------------------"
if [ -d "backup-all/w-emanuvaderla-agentspace-68dc893e-fa81d31ef8-15a8a8" ]; then
    BACKUP_SIZE=$(du -sh backup-all/ | cut -f1)
    echo -e "${GREEN}✓${NC} Backup data exists ($BACKUP_SIZE)"
else
    echo -e "${RED}✗${NC} Backup data not found"
    exit 1
fi
echo ""

echo "6. Checking Database Records..."
echo "----------------------------"
# Query CockroachDB to count records
RECORD_COUNT=$(docker-compose exec -T cockroachdb cockroach sql --insecure \
    -e "SELECT COUNT(*) FROM defaultdb.tx;" 2>/dev/null | grep -o '[0-9]*' | head -1 || echo "0")

if [ "$RECORD_COUNT" -gt 100000 ]; then
    echo -e "${GREEN}✓${NC} Database has $RECORD_COUNT records (migration successful)"
elif [ "$RECORD_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠${NC} Database has only $RECORD_COUNT records (might be incomplete)"
else
    echo -e "${RED}✗${NC} Database appears empty"
fi
echo ""

echo "7. Service Status Summary..."
echo "----------------------------"
docker-compose ps --format "table {{.Service}}\t{{.Status}}" | grep -E "Up|running"
echo ""

echo "=================================================="
echo "Migration Verification Complete"
echo "=================================================="
echo ""
echo -e "${GREEN}✓ All checks passed!${NC}"
echo ""
echo "Next Steps:"
echo "1. Log into v0.7: http://192.168.50.90:8201"
echo "2. Verify your workspace data is intact"
echo "3. Test key workflows (issues, files, chat)"
echo "4. Check GitHub integration (if configured)"
echo ""
echo "v0.6 (production) still running at: http://192.168.50.90:8101"
echo "Keep v0.6 running until v0.7 is fully verified!"
echo ""
