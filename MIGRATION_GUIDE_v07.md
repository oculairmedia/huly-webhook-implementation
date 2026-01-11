# Huly v0.6 → v0.7 Migration Guide

## Overview

This guide provides a safe, step-by-step process for migrating your Huly instance from **v0.6.501** to **v0.7.306** using a parallel test stack approach.

## Current Status

- **Production Version**: v0.6.501
- **Target Version**: v0.7.306 (s0.7.306)
- **Migration Strategy**: Parallel test stack with full validation before cutover

## Pre-Migration Checklist

- [x] Full backup created: `/opt/backups/huly-migration-20251119/`
- [x] Migration script created: `setup-test-stack.sh`
- [ ] Test stack deployed and validated
- [ ] MCP server compatibility verified
- [ ] Production cutover planned

## Key Changes in v0.7

### Breaking Changes

1. **SES Service Removal**
   - The `ses` service for web push has been replaced with `notification` service
   - Environment variables no longer required: `SECRET_KEY`, `PUSH_PUBLIC_KEY`, `PUSH_PRIVATE_KEY`
   - **Impact**: Low (we're not using SES/mail services)

2. **Mail Service Separation**
   - Email functionality now in separate `mail` service
   - **Impact**: None (we're not using mail service)

3. **Transactor Changes**
   - Standard `hardcoreeng/transactor` image instead of custom webhook version
   - **Impact**: Medium (need to verify webhook functionality)

### Version Updates

All services updated from `v0.6.501` to `s0.7.306`:
- front
- account
- transactor
- collaborator
- workspace
- github
- fulltext
- stats
- rekoni

## Migration Process

### Phase 1: Test Stack Deployment (Current Phase)

#### Step 1: Run Setup Script

```bash
cd /opt/stacks/huly-selfhost
sudo ./setup-test-stack.sh
```

This script will:
1. ✅ Create test directory at `/opt/stacks/huly-test-v07`
2. ✅ Copy production configuration
3. ✅ Update to v0.7.306
4. ✅ Modify ports (8201 for HTTP, 3557 for MCP)
5. ✅ Restore production data to test stack

#### Step 2: Start Test Stack

```bash
cd /opt/stacks/huly-test-v07
docker-compose up -d
```

#### Step 3: Monitor Startup

```bash
# Watch all services start
docker-compose logs -f

# Check service health
docker-compose ps

# Specific service logs
docker-compose logs -f transactor
docker-compose logs -f front
docker-compose logs -f huly-mcp
```

### Phase 2: Validation Testing

#### Test 1: Web Interface
- [ ] Access test UI at `http://localhost:8201`
- [ ] Login with existing credentials
- [ ] Verify workspace loads correctly
- [ ] Check issue tracker functionality
- [ ] Verify GitHub integration panel

#### Test 2: Core Functionality
- [ ] Create a new issue
- [ ] Update an existing issue
- [ ] Add comments
- [ ] Search functionality
- [ ] Check project boards
- [ ] Verify task management

#### Test 3: GitHub Integration
- [ ] Verify GitHub OAuth login works
- [ ] Check GitHub repositories are linked
- [ ] Test sync between GitHub and Huly
- [ ] Verify GitHub issue links

#### Test 4: MCP Server
```bash
# Test MCP health
curl http://localhost:3557/health

# Test MCP functionality
curl -X POST http://localhost:3557/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1
  }'
```

#### Test 5: Data Integrity
- [ ] Verify all projects present
- [ ] Check issue counts match production
- [ ] Verify user accounts
- [ ] Check GitHub integration data
- [ ] Verify attachments/files accessible

### Phase 3: Performance Testing

Monitor test stack for at least 24-48 hours:

```bash
# Resource usage
docker stats

# Response times
time curl -I http://localhost:8201

# Database performance
docker exec huly-test-mongodb-1 mongostat

# Log monitoring for errors
docker-compose logs -f | grep -i error
```

### Phase 4: Production Cutover

⚠️ **Do not proceed until all tests pass!**

#### Pre-Cutover Checklist
- [ ] All validation tests passed
- [ ] 24+ hours of stable operation
- [ ] No errors in logs
- [ ] Performance meets expectations
- [ ] Backup verified and tested
- [ ] Rollback procedure documented
- [ ] Downtime window scheduled

#### Cutover Steps

1. **Announce Maintenance Window**
   ```
   Planned downtime: [DATE] [TIME]
   Expected duration: 30-60 minutes
   ```

2. **Final Production Backup**
   ```bash
   cd /opt/stacks/huly-selfhost
   
   # Stop production to ensure consistent backup
   docker-compose stop
   
   # Create final backup
   FINAL_BACKUP="/opt/backups/huly-final-$(date +%Y%m%d-%H%M%S)"
   mkdir -p $FINAL_BACKUP
   
   docker-compose start mongodb
   sleep 5
   docker exec huly-mongodb-1 mongodump --out /backup/final
   docker cp huly-mongodb-1:/backup/final $FINAL_BACKUP/mongodb/
   docker-compose stop
   ```

3. **Update Production Stack**
   ```bash
   cd /opt/stacks/huly-selfhost
   
   # Backup current config
   cp .env .env.v06501.backup
   cp docker-compose.yml docker-compose.yml.v06501.backup
   
   # Copy tested configuration from test stack
   cp /opt/stacks/huly-test-v07/docker-compose.yml ./docker-compose.yml
   
   # Update .env for production (keep production ports)
   sed -i 's/HTTP_PORT=8201/HTTP_PORT=8101/' .env
   sed -i 's/HOST_ADDRESS=localhost/HOST_ADDRESS=pm.oculair.ca/' .env
   sed -i 's/SECURE=false/SECURE=true/' .env
   sed -i 's/DOCKER_NAME=huly-test/DOCKER_NAME=huly/' .env
   sed -i 's/HULY_VERSION=s0.7.306/HULY_VERSION=s0.7.306/' .env
   
   # Update MCP port back to 3457
   sed -i 's/"3557:3000"/"3457:3000"/' docker-compose.yml
   ```

4. **Start Production v0.7**
   ```bash
   docker-compose up -d
   
   # Monitor startup
   docker-compose logs -f
   ```

5. **Post-Cutover Validation**
   ```bash
   # Check all services running
   docker-compose ps
   
   # Test web access
   curl -I https://pm.oculair.ca
   
   # Test MCP
   curl http://localhost:3457/health
   
   # Check for errors
   docker-compose logs --tail=100 | grep -i error
   ```

### Phase 5: Rollback (If Needed)

If issues occur during cutover:

```bash
cd /opt/stacks/huly-selfhost

# Stop v0.7 services
docker-compose down -v

# Restore v0.6 configuration
cp .env.v06501.backup .env
cp docker-compose.yml.v06501.backup docker-compose.yml

# Restore final backup if needed
docker-compose up -d mongodb
sleep 10
docker exec huly-mongodb-1 mongorestore /backup/final/

# Start production v0.6
docker-compose up -d

# Verify rollback successful
docker-compose ps
curl -I https://pm.oculair.ca
```

## Port Mapping Reference

### Production Ports (v0.6 & v0.7)
- HTTP/HTTPS: 8101
- MCP Server: 3457
- REST API: 3458

### Test Stack Ports (v0.7)
- HTTP: 8201
- MCP Server: 3557

## Important Notes

### Custom Components
1. **MCP Server**: Uses Huly SDK v0.6.500 - needs testing with v0.7 platform
2. **Webhook Integration**: Removed custom transactor image - verify webhook functionality
3. **REST API**: Needs compatibility testing with v0.7

### Data Preservation
- All MongoDB data preserved
- MinIO files/attachments intact
- User accounts and permissions maintained
- GitHub integration configurations preserved

### Known Limitations
- Test stack runs on HTTP (not HTTPS) for simplicity
- Test stack uses `localhost` address instead of public domain
- GitHub webhooks point to production, not test stack

## Troubleshooting

### Test Stack Won't Start
```bash
cd /opt/stacks/huly-test-v07

# Check for port conflicts
netstat -tulpn | grep -E '8201|3557'

# Check Docker logs
docker-compose logs

# Verify volumes
docker volume ls | grep huly-test
```

### Database Restore Issues
```bash
# Check MongoDB logs
docker-compose logs mongodb

# Verify backup integrity
ls -lh /opt/backups/huly-migration-*/mongodb/

# Manual restore
docker exec -it huly-test-mongodb-1 bash
mongorestore /backup/migration-*/
```

### MCP Server Compatibility Issues
```bash
# Check MCP logs
docker-compose logs huly-mcp

# Rebuild MCP container
docker-compose build huly-mcp
docker-compose up -d huly-mcp

# Check SDK version compatibility
docker exec huly-test-huly-mcp-1 npm list @hcengineering/core
```

## Success Criteria

Before considering migration complete:

- [x] Backup successfully created
- [ ] Test stack runs stable for 24+ hours
- [ ] All validation tests pass
- [ ] No errors in logs
- [ ] Performance acceptable
- [ ] MCP server functional
- [ ] GitHub integration working
- [ ] Data integrity verified
- [ ] Production cutover successful
- [ ] 24 hours of stable production operation

## Timeline

- **Phase 1** (Test Deployment): 2-4 hours
- **Phase 2** (Validation): 24-48 hours
- **Phase 3** (Performance Testing): 24-48 hours
- **Phase 4** (Cutover): 1-2 hours
- **Total**: 3-5 days

## Support & References

- **Backup Location**: `/opt/backups/huly-migration-20251119/`
- **Test Stack**: `/opt/stacks/huly-test-v07/`
- **Production Stack**: `/opt/stacks/huly-selfhost/`
- **Official Migration Docs**: `/opt/stacks/huly-selfhost/hully source/selfhost/MIGRATION.md`
- **Docker Hub**: https://hub.docker.com/u/hardcoreeng

## Next Steps

1. Run `./setup-test-stack.sh` to create test environment
2. Start test stack and begin validation
3. Monitor for 24-48 hours
4. Plan production cutover when ready

---

**Document Version**: 1.0  
**Created**: 2025-11-19  
**Last Updated**: 2025-11-19
