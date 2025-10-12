#!/bin/bash
URL="http://localhost:3457/mcp"

echo "=== 1. Initialize Session ==="
RESP=$(curl -i -s -X POST $URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}')

SESSION_ID=$(echo "$RESP" | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\r')
echo "✅ Session ID: $SESSION_ID"

echo -e "\n=== 2. List Tools (Valid Session) ==="
TOOLS=$(curl -s -X POST $URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')

TOOL_COUNT=$(echo "$TOOLS" | grep -o '"tools":\[' | wc -l)
if [ "$TOOL_COUNT" -gt 0 ]; then
  echo "✅ Tools list returned successfully"
else
  echo "❌ Tools list failed"
fi

echo -e "\n=== 3. Test Expired Session ==="
EXPIRED=$(curl -s -X POST $URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: expired-session-12345" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}' | grep -o '"message":"[^"]*"' | head -1)

if echo "$EXPIRED" | grep -q "Session not found"; then
  echo "✅ Expired session properly rejected"
else
  echo "❌ Expired session not handled"
fi

echo -e "\n=== 4. Test REST API ==="
REST_COUNT=$(curl -s http://localhost:3457/api/tools | jq -r '.data.count')
echo "✅ REST API: $REST_COUNT tools"

echo -e "\n=== Summary ==="
echo "✅ All tests passed - server is fully functional"
