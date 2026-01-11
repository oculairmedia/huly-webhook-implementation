# REST API Authentication Debug Summary

**Date:** November 19, 2025  
**Issue:** REST API unable to authenticate with v0.7 Huly platform  
**Status:** 🔴 UNRESOLVED - Credentials work for MCP but not REST API

---

## Problem

The Huly REST API service continuously fails to authenticate:

```
[Huly REST] ❌ Failed to connect to Huly: Login failed
Error: Login failed
  at getWorkspaceToken (/app/node_modules/@hcengineering/api-client/lib/client.js:175:11)
  at async connect (/app/node_modules/@hcengineering/api-client/lib/client.js:44:44)
```

---

## What We Tried

### Attempt 1: Internal nginx URL
```yaml
HULY_URL=http://nginx
```
**Result:** ❌ Login failed  
**Account Service Error:** `BadRequest` with source `🤦‍♂️user`

### Attempt 2: Direct account service
```yaml
HULY_URL=http://account:3000
```
**Result:** ❌ Failed to fetch config  
**Error:** Config endpoint not available at `http://account:3000/config`

### Attempt 3: Public URL through nginx
```yaml
HULY_URL=http://192.168.50.90:8201
```
**Result:** ❌ Login failed (same as Attempt 1)

---

## Working Configuration (MCP Server)

The MCP server successfully connects with:
```yaml
HULY_URL=http://nginx
HULY_PUBLIC_URL=http://192.168.50.90:8201
HULY_EMAIL=emanuvaderland@gmail.com
HULY_PASSWORD=k2a8yy7sFWVZ6eL
HULY_WORKSPACE=agentspace
```

**Status:** ✅ HEALTHY and operational

---

## Key Differences

| Aspect | MCP (Works) | REST API (Fails) |
|--------|-------------|------------------|
| SDK Usage | Unknown initialization | `connect(url, {email, password, workspace})` |
| Port | 3557 | 3558 |
| Image | `huly-huly-mcp:latest` | `huly-huly-rest-api:latest` |
| Health | ✅ Passing | ❌ Never starts |

---

## Account Service Logs

```json
{
  "level": "error",
  "message": "Error while processing account method",
  "method": "login",
  "source": "🤦‍♂️user",
  "status": {
    "code": "platform:status:BadRequest",
    "params": {},
    "severity": "ERROR"
  }
}
```

The emoji `🤦‍♂️user` (facepalm) suggests:
- Invalid user format
- Missing required fields
- Protocol mismatch

---

## Hypothesis

### Most Likely Cause
**The SDK `connect()` function used by REST API may be incompatible with v0.7's authentication flow.**

Evidence:
1. Same credentials work for MCP
2. MCP uses different connection method
3. Account service rejects REST API login as "BadRequest"
4. Error occurs at `getWorkspaceToken` stage

### Possible Solutions

1. **Update REST API connection code** to match MCP's approach
2. **Use a different SDK method** for v0.7 compatibility
3. **Add additional config parameters** that v0.7 expects
4. **Upgrade SDK to v0.7 packages** (requires build fix)

---

## SDK Version Info

Both services use:
```json
{
  "@hcengineering/core": "0.6.500",
  "@hcengineering/api-client": "0.6.500",
  "@hcengineering/tracker": "0.6.500"
}
```

Platform version: `s0.7.306`

---

## Next Steps to Fix

### Option A: Study MCP Connection Code
1. Examine how MCP initializes the Huly client
2. Compare with REST API's `connect()` call
3. Adopt MCP's working approach

### Option B: SDK Update
1. Fix GitHub token permissions
2. Build with v0.7 SDK packages
3. Test if newer SDK works

### Option C: Alternative Authentication
1. Use token-based auth instead of password
2. Pre-authenticate and pass token to REST API
3. Bypass `connect()` function

---

## Workaround

For now, **use the MCP server** which is working correctly:

```bash
# MCP Server (v0.7) - WORKS
curl http://192.168.50.90:3557/health
# {"status":"healthy"...}

# Direct REST API - NOT AVAILABLE
curl http://192.168.50.90:3558/health
# Connection refused (service restarting)
```

---

## Files Involved

- `/opt/stacks/huly-test-v07/docker-compose.yml` - Service definitions
- `/opt/stacks/huly-test-v07/huly-rest-api/server.js:48` - Connection code
- `@hcengineering/api-client/lib/client.js:175` - SDK login logic
- `@hcengineering/api-client/lib/config.js:32` - Config loading

---

## Recommendation

**PAUSE REST API migration** until:
1. We understand MCP's connection approach
2. We can replicate it in REST API
3. OR we upgrade to v0.7 SDK packages

**PROCEED with MCP only** for now since it's working.

---

**Debug Session:** November 19, 2025 21:42 EST  
**Duration:** 15 minutes  
**Outcome:** Issue identified but not resolved  
**Action:** Use MCP, defer REST API
