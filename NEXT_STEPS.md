# Next Steps: Huly v0.7 REST API Deployment

## Current Status ✅

1. **v0.7 Platform**: Running and validated
   - All services healthy
   - Data migrated successfully (241k+ transactions)
   - Login working at http://192.168.50.90:8201

2. **MCP Server**: Working with v0.7
   - Image exists: `huly-huly-mcp:latest`
   - Accessible at http://192.168.50.90:8201/mcp/health
   - All tools functional

3. **Build Solution Created**:
   - Multistage Dockerfiles for MCP and REST API
   - Automated build script (`build-v07-stack.sh`)
   - Comprehensive documentation
   - Git branch pushed: `feature/v0.7-migration`

## What You Need to Do

### Step 1: Build the Images (15-20 minutes)

```bash
cd /opt/stacks/huly-test-v07
./build-v07-stack.sh
```

This will:
- Build MCP server v0.7 from Huly source
- Build REST API v0.7 from Huly source
- Tag both as `latest`
- Show build summary

### Step 2: Deploy the Services (1 minute)

```bash
cd /opt/stacks/huly-test-v07

# Stop old containers
docker-compose stop huly-mcp huly-rest-api

# Start with new images
docker-compose up -d huly-mcp huly-rest-api

# Check status
docker-compose ps huly-mcp huly-rest-api
```

### Step 3: Verify Everything Works (2 minutes)

```bash
# Test MCP Server
curl http://192.168.50.90:8201/mcp/health
# Should return: {"status":"healthy",...}

# Test REST API (direct port)
curl http://192.168.50.90:3558/health
# Should return: {"status":"ok","connected":true,...}

# Test REST API functionality
curl http://192.168.50.90:3558/api/projects
# Should return: {"projects":[...],"count":...}
```

### Step 4: Enable REST API in Nginx (30 seconds)

Edit `.huly.nginx` and uncomment the REST API section:

```nginx
# Uncomment these lines:
location /api {
    proxy_set_header Host $host;
    ...
    proxy_pass http://huly-rest-api:3458/api/;
}
```

Then reload nginx:
```bash
docker-compose exec nginx nginx -s reload
```

### Step 5: Test Public REST API Access (1 minute)

```bash
# Test through nginx
curl http://192.168.50.90:8201/api/projects

# Test from external service
curl http://192.168.50.90:8201/api/issues/HULLY-1
```

### Step 6: Update External Services

Update any services that use the Huly API to point to v0.7:

**Old URLs (v0.6)**:
- http://192.168.50.90:8101 → Platform
- http://192.168.50.90:3458/api → REST API

**New URLs (v0.7)**:
- http://192.168.50.90:8201 → Platform
- http://192.168.50.90:8201/api → REST API (same contract!)

## Troubleshooting

### If Build Fails

Check build logs:
```bash
docker build -t huly-huly-rest-api:v0.7 \
  -f huly-rest-api/Dockerfile.v0.7 \
  huly-rest-api/ 2>&1 | tee build.log
```

Common issues:
- **Out of memory**: Increase Docker memory to 4GB+
- **Huly source missing**: Verify `/opt/stacks/huly-test-v07/hully source/` exists
- **Rush build fails**: Check Huly source integrity

### If REST API Won't Connect

Check container logs:
```bash
docker-compose logs --tail=50 huly-rest-api
```

Look for:
- `✅ Successfully connected to Huly platform` (good!)
- `❌ Failed to connect to Huly: Login failed` (still broken)

If still failing:
1. Verify environment variables: `docker-compose exec huly-rest-api env | grep HULY`
2. Ensure `HULY_URL=http://nginx` (not external IP)
3. Check nginx is routing correctly
4. Rebuild with verbose logging

### If Performance is Slow

Monitor resource usage:
```bash
docker stats huly-rest-api huly-mcp
```

If memory usage high:
- Increase container memory limits
- Check for memory leaks in logs
- Restart containers

## Expected Timeline

- **Build**: 15-20 minutes (first time), 2-5 minutes (cached)
- **Deploy**: 1 minute
- **Test**: 2-3 minutes
- **Configure**: 30 seconds
- **Total**: ~25 minutes to fully operational REST API

## Success Indicators

✅ Build completes without errors  
✅ Containers start and stay healthy  
✅ `/health` returns `{"connected":true}`  
✅ `/api/projects` returns project list  
✅ Can create/update issues via REST API  
✅ External services can access API  
✅ Performance matches v0.6 benchmarks  

## Files Reference

- **Build Script**: `/opt/stacks/huly-test-v07/build-v07-stack.sh`
- **MCP Dockerfile**: `/opt/stacks/huly-test-v07/huly-mcp-server/Dockerfile.v0.7`
- **REST Dockerfile**: `/opt/stacks/huly-test-v07/huly-rest-api/Dockerfile.v0.7`
- **Migration Guide**: `/opt/stacks/huly-test-v07/huly-mcp-server/V0.7_MIGRATION_GUIDE.md`
- **Full Solution**: `/opt/stacks/huly-test-v07/V0.7_REST_API_SOLUTION.md`

## Get Help

If you encounter issues:
1. Check logs: `docker-compose logs -f huly-rest-api`
2. Review migration guide for troubleshooting section
3. Verify all prerequisites are met
4. Check GitHub issues: https://github.com/oculairmedia/huly-mcp-server/issues

---

**Ready to proceed? Run the build script!**

```bash
cd /opt/stacks/huly-test-v07
./build-v07-stack.sh
```
