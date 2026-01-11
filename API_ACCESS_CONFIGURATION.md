# Huly v0.7 API Access Configuration

## Overview

This document describes the API access setup for the Huly v0.7 platform to enable external infrastructure integration.

## Current Status

### ✅ MCP Server (Working)
- **Direct Access**: `http://192.168.50.90:3557`
- **Through Nginx**: `http://192.168.50.90:8201/mcp`
- **Protocol**: Model Context Protocol (MCP) over HTTP
- **Status**: ✅ Operational

### ❌ REST API (Authentication Issue)
- **Direct Access**: `http://192.168.50.90:3558` (❌ Login failed)
- **Through Nginx**: Not exposed (commented out)
- **Protocol**: REST HTTP API
- **Status**: ❌ Broken - SDK v0.6.500 cannot authenticate with Platform v0.7.306

## MCP Server Configuration

### Endpoints

**Health Check:**
```bash
curl http://192.168.50.90:8201/mcp/health
```

**JSON-RPC Endpoint:**
```bash
curl -X POST http://192.168.50.90:8201/mcp/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"METHOD","params":{},"id":1}'
```

### Available MCP Tools

The MCP server provides comprehensive Huly operations:

- **Projects**: `huly_list_projects`, `huly_create_project`, `huly_get_project`
- **Issues**: `huly_list_issues`, `huly_create_issue`, `huly_update_issue`, `huly_get_issue`
- **Sub-issues**: `huly_create_subissue`
- **Components**: `huly_list_components`, `huly_create_component`, `huly_delete_component`
- **Milestones**: `huly_list_milestones`, `huly_create_milestone`, `huly_delete_milestone`
- **Comments**: `huly_list_comments`, `huly_create_comment`
- **Templates**: `huly_list_templates`, `huly_create_template`, `huly_instantiate_template`
- **Search**: `huly_search_issues`
- **Bulk Operations**: `huly_bulk_update_issues`
- **Project Setup**: `huly_setup_project`

### MCP Protocol Usage

The MCP server uses session-based authentication. Here's how to use it:

1. **Initialize Session** (first call):
```bash
curl -X POST http://192.168.50.90:8201/mcp/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "huly_list_projects",
      "arguments": {}
    },
    "id": 1
  }'
```

2. **List Available Tools**:
```bash
curl -X POST http://192.168.50.90:8201/mcp/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1
  }'
```

### Authentication

The MCP server authenticates internally using:
- **Email**: emanuvaderland@gmail.com
- **Password**: k2a8yy7sFWVZ6eL
- **Workspace**: agentspace

External clients don't need to provide these credentials - the MCP server handles authentication automatically.

## Nginx Configuration

### Current Routes

```nginx
# MCP Server endpoint for external infrastructure
location /mcp {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Enable CORS for external services
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
    
    if ($request_method = 'OPTIONS') {
        return 204;
    }
    
    rewrite ^/mcp(.*)$ $1 break;
    proxy_pass http://huly-mcp:3000;
}
```

### CORS Support

CORS is enabled for all origins (`*`) to allow external infrastructure services to access the MCP API.

## REST API Issue

### Problem

The REST API service cannot authenticate with the v0.7 platform:

```
[Huly REST] ❌ Failed to connect to Huly: Login failed
Error at getWorkspaceToken (/app/node_modules/@hcengineering/api-client/lib/client.js:175:11)
```

### Root Cause

- REST API uses SDK version: `@hcengineering/api-client@0.6.500`
- Platform version: `v0.7.306`
- The SDK's `connect()` function is incompatible with v0.7 authentication

### MCP Server Works Because

- MCP server uses same SDK version (`0.6.500`)
- But MCP server connects successfully
- This suggests a configuration or implementation difference

### Potential Solutions (Not Yet Implemented)

1. **Upgrade SDK**: Try using v0.7 SDK packages (if available)
2. **Use MCP Instead**: Configure all infrastructure to use MCP protocol
3. **Fix Authentication**: Debug SDK authentication flow for v0.7
4. **Direct Database Access**: Bypass SDK and use CockroachDB directly (not recommended)

## External Infrastructure Integration

### For Services Needing Huly API Access

**Recommended Approach**: Use the MCP server

**Base URL**: `http://192.168.50.90:8201/mcp/mcp`

**Protocol**: JSON-RPC 2.0 over HTTP

**Example Integration**:
```javascript
const response = await fetch('http://192.168.50.90:8201/mcp/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'huly_list_projects',
      arguments: {}
    },
    id: 1
  })
});

const data = await response.json();
console.log(data.result);
```

### Services That May Need Updating

Based on the project structure, these services might need Huly API access:

- **Letta Services**: AI/ML agent platform
- **MCP Servers**: vibe, postiz, photoprism, komodo
- **Matrix Synapse**: Chat/collaboration platform
- **Custom Scripts**: Any automation or integration scripts

### Migration Steps for Services

1. Update API endpoint from v0.6 to v0.7:
   - Old: `http://192.168.50.90:8101` (v0.6)
   - New: `http://192.168.50.90:8201/mcp/mcp` (v0.7 MCP)

2. Change protocol from REST to JSON-RPC 2.0:
   - REST: `GET /api/projects`
   - MCP: `POST /mcp/mcp` with `{"method":"tools/call","params":{"name":"huly_list_projects"}}`

3. Update authentication:
   - REST: Direct credentials in request
   - MCP: No credentials needed (server handles auth)

## Testing

### Quick Tests

```bash
# Test platform is running
curl http://192.168.50.90:8201

# Test MCP health
curl http://192.168.50.90:8201/mcp/health

# Test MCP tools list (requires session)
curl -X POST http://192.168.50.90:8201/mcp/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
```

### Direct Access (Bypassing Nginx)

```bash
# MCP server direct
curl http://192.168.50.90:3557/health

# REST API (broken)
curl http://192.168.50.90:3558/health
```

## Next Steps

1. ✅ Nginx routing configured for MCP access
2. ⏳ Identify which external services use Huly API
3. ⏳ Update those services to use MCP protocol
4. ⏳ Test end-to-end integration
5. ⏳ Consider fixing REST API authentication (optional)

## References

- **MCP Server Source**: `/opt/stacks/huly-test-v07/huly-mcp-server`
- **REST API Source**: `/opt/stacks/huly-test-v07/huly-rest-api`
- **Nginx Config**: `/opt/stacks/huly-test-v07/.huly.nginx`
- **Docker Compose**: `/opt/stacks/huly-test-v07/docker-compose.yml`
- **Environment**: `/opt/stacks/huly-test-v07/.env`

## Credentials

**Huly Platform:**
- Email: emanuvaderland@gmail.com
- Password: k2a8yy7sFWVZ6eL
- Workspace: agentspace

**Note**: MCP server uses these credentials internally. External clients don't need them.
