#!/bin/bash
#
# Compare Production and Test Stack Status
#

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=========================================="
echo "Huly Stack Comparison"
echo -e "==========================================${NC}"
echo ""

echo -e "${YELLOW}PRODUCTION STACK (v0.6.501)${NC}"
echo "Location: /opt/stacks/huly-selfhost"
echo "Web UI: https://pm.oculair.ca:8101"
echo "MCP: http://localhost:3457"
echo ""

cd /opt/stacks/huly-selfhost
echo "Running containers:"
docker-compose ps --format "table {{.Name}}\t{{.State}}\t{{.Status}}" 2>/dev/null || echo "Not running or error"
echo ""

echo "Health check:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://pm.oculair.ca:8101 2>/dev/null)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    echo -e "${GREEN}✓ Web UI: Responding (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}✗ Web UI: Not responding (HTTP $HTTP_CODE)${NC}"
fi

MCP_STATUS=$(curl -s http://localhost:3457/health 2>/dev/null | jq -r '.status' 2>/dev/null)
if [ "$MCP_STATUS" = "healthy" ]; then
    echo -e "${GREEN}✓ MCP: Healthy${NC}"
else
    echo -e "${RED}✗ MCP: Not healthy${NC}"
fi
echo ""

echo "---"
echo ""

echo -e "${YELLOW}TEST STACK (v0.7.306)${NC}"
echo "Location: /opt/stacks/huly-test-v07"
echo "Web UI: http://localhost:8201"
echo "MCP: http://localhost:3557"
echo ""

if [ -d "/opt/stacks/huly-test-v07" ]; then
    cd /opt/stacks/huly-test-v07
    echo "Running containers:"
    docker-compose ps --format "table {{.Name}}\t{{.State}}\t{{.Status}}" 2>/dev/null || echo "Not running"
    echo ""
    
    echo "Health check:"
    TEST_HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8201 2>/dev/null)
    if [ "$TEST_HTTP" = "200" ] || [ "$TEST_HTTP" = "301" ] || [ "$TEST_HTTP" = "302" ]; then
        echo -e "${GREEN}✓ Web UI: Responding (HTTP $TEST_HTTP)${NC}"
    else
        echo -e "${RED}✗ Web UI: Not responding (HTTP $TEST_HTTP)${NC}"
    fi
    
    TEST_MCP=$(curl -s http://localhost:3557/health 2>/dev/null | jq -r '.status' 2>/dev/null)
    if [ "$TEST_MCP" = "healthy" ]; then
        echo -e "${GREEN}✓ MCP: Healthy${NC}"
    else
        echo -e "${RED}✗ MCP: Not healthy${NC}"
    fi
else
    echo -e "${YELLOW}Not deployed yet${NC}"
    echo "Run ./setup-test-stack.sh to create test environment"
fi
echo ""

echo "---"
echo ""

echo -e "${BLUE}RESOURCE USAGE${NC}"
echo ""
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" | grep -E "(NAME|huly-|huly-test-)" | head -20
echo ""

echo -e "${BLUE}RECENT ERRORS (Last 10 minutes)${NC}"
echo ""
echo "Production errors:"
cd /opt/stacks/huly-selfhost
docker-compose logs --since=10m 2>/dev/null | grep -i error | tail -5 || echo "None"
echo ""

if [ -d "/opt/stacks/huly-test-v07" ]; then
    echo "Test stack errors:"
    cd /opt/stacks/huly-test-v07
    docker-compose logs --since=10m 2>/dev/null | grep -i error | tail -5 || echo "None"
fi
echo ""

echo -e "${BLUE}==========================================${NC}"
