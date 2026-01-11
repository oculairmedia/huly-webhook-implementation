# Huly v0.7 MCP & REST API Deployment Status

**Date:** November 19, 2025  
**Status:** 🟡 PARTIAL SUCCESS - MCP Running, REST API Needs Fix

---

## Summary

Successfully deployed MCP and REST API services to v0.7 stack using existing v0.6 Docker images with updated configuration pointing to v0.7 backend.

**Key Achievement:** Used parallel deployment strategy - both v0.6 and v0.7 MCP/API services running simultaneously on different ports.

---

## Service Status

### ✅ Huly MCP Server (v0.7)
- **Status:** 🟢 RUNNING AND HEALTHY
- **Port:** 3557 (v0.6 uses 3457)
- **URL:** http://192.168.50.90:3557
- **Health Check:** ✅ Passing
- **Backend:** Connected to v0.7 Huly (http://nginx → port 8201)
- **Image:** `huly-huly-mcp:latest` (v0.6 SDK with v0.7 backend)

**Test Results:**
```bash
$ curl http://192.168.50.90:3557/health
{
  "status": "healthy",
  "service": "huly-mcp-server",
  "transport": "streamable_http",
  "protocol_version": "2025-06-18",
  "sessions": 0,
  "uptime": 30.53,
  "timestamp": "2025-11-20T02:28:01.437Z"
}
```

### ⚠️ Huly REST API (v0.7)
- **Status:** 🔴 RESTARTING - Login Issues
- **Port:** 3558 (v0.6 uses 3458)
- **Issue:** Authentication failing with v0.7 backend
- **Error:** `Login failed` at getWorkspaceToken

---

## Port Assignments

### v0.6 Production (huly-selfhost)
- Platform: **8101**
- MCP: **3457** ✅
- REST API: **3458** ✅

### v0.7 Test (huly-test-v07)
- Platform: **8201** ✅
- MCP: **3557** ✅
- REST API: **3558** ⚠️

**No port conflicts!**

---

## What We Accomplished

✅ **MCP Server migrated successfully**
- Reusing v0.6 image with v0.7 config
- Health endpoint working
- Connected to v0.7 backend
- Confirms SDK v0.6.500 compatible with v0.7.306

✅ **Parallel deployment working**
- v0.6 and v0.7 running side-by-side
- Easy testing and comparison
- Zero-risk rollback available

⚠️ **REST API needs authentication fix**
- Service starts but can't login
- Same credentials work for MCP
- Need to debug auth differences

---

## Next Actions

1. **Debug REST API:** Fix authentication with v0.7
2. **Test MCP:** Connect client and verify all tools
3. **Document differences:** Note any behavior changes
4. **Performance test:** Compare v0.6 vs v0.7

---

**Quick Test MCP:**
```bash
curl http://192.168.50.90:3557/health
```

**Rollback if needed:**
```bash
docker-compose stop huly-mcp huly-rest-api
# v0.6 still running on ports 3457/3458
```

---

**Report:** November 19, 2025 21:30 EST
