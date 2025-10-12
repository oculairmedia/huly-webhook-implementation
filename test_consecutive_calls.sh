#!/bin/bash

# Test consecutive MCP calls to reproduce the timeout issue

MCP_URL="http://localhost:3457/mcp"

echo "=========================================="
echo "Testing Consecutive MCP Calls"
echo "=========================================="

# Step 1: Initialize session
echo ""
echo "Step 1: Initializing session..."
INIT_RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    },
    "id": 1
  }')

echo "Init Response: $INIT_RESPONSE"

# Extract session ID from response headers
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i "mcp-session-id" | cut -d':' -f2 | tr -d ' \r\n')

# If session ID is in the JSON response, extract it
if [ -z "$SESSION_ID" ]; then
  # Try to extract from response body or headers using a different approach
  # For now, make another call to get session properly
  SESSION_ID=$(curl -s -i -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "method": "initialize",
      "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {
          "name": "test-client",
          "version": "1.0.0"
        }
      },
      "id": 1
    }' | grep -i "mcp-session-id:" | cut -d':' -f2 | tr -d ' \r\n')
fi

echo "Session ID: $SESSION_ID"

if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Could not get session ID"
  exit 1
fi

# Step 2: First call - list projects (huly_query)
echo ""
echo "Step 2: First call - listing projects..."
CALL1_START=$(date +%s)
CALL1_RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "huly_query",
      "arguments": {
        "entity_type": "project",
        "mode": "list"
      }
    },
    "id": 2
  }')
CALL1_END=$(date +%s)
CALL1_DURATION=$((CALL1_END - CALL1_START))

echo "Call 1 completed in ${CALL1_DURATION}s"
echo "Response: $CALL1_RESPONSE" | head -c 500
echo ""

# Step 3: Second call immediately after - create issue (huly_issue_ops)
echo ""
echo "Step 3: Second call (consecutive) - creating issue..."
CALL2_START=$(date +%s)
CALL2_RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "huly_issue_ops",
      "arguments": {
        "operation": "create",
        "project_identifier": "HULLY",
        "data": {
          "title": "Test: Consecutive Calls Script",
          "description": "Testing consecutive tool calls from bash script",
          "priority": "low"
        }
      }
    },
    "id": 3
  }')
CALL2_END=$(date +%s)
CALL2_DURATION=$((CALL2_END - CALL2_START))

echo "Call 2 completed in ${CALL2_DURATION}s"
echo "Response: $CALL2_RESPONSE"

# Check for timeout error
if echo "$CALL2_RESPONSE" | grep -q "timed out"; then
  echo ""
  echo "❌ TIMEOUT ERROR DETECTED!"
else
  echo ""
  echo "✅ Both calls completed successfully"
fi

echo ""
echo "=========================================="
echo "Total time: $((CALL1_DURATION + CALL2_DURATION))s"
echo "=========================================="
