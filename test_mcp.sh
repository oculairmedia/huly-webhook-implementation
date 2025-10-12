#!/bin/bash
URL="http://localhost:3457/mcp"

echo "=== Initialize ==="
INIT_RESP=$(curl -s -X POST $URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}')

SESSION_ID=$(echo "$INIT_RESP" | grep -o 'id: [a-f0-9-]*' | head -1 | cut -d' ' -f2)
echo "Session ID: $SESSION_ID"

echo -e "\n=== Tools/list ==="
curl -s -X POST $URL \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq '.result.tools | length' || echo "Success (no jq)"

echo -e "\n=== Invalid session ==="
curl -s -X POST $URL \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: fake-123" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}' | jq -r '.error.message'
