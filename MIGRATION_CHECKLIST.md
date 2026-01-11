# Huly v0.6 → v0.7 Migration Checklist

## Pre-Migration

- [ ] **Read** the full MIGRATION_GUIDE_v06_to_v07.md
- [ ] **Notify** all users of planned downtime (30-60 minutes)
- [ ] **Verify** v0.6 production instance is running at `/opt/stacks/huly-selfhost`
- [ ] **Verify** v0.7 test instance is ready at `/opt/stacks/huly-test-v07`
- [ ] **Check** available disk space (need at least 2x current data size)
- [ ] **Plan** migration window (recommend off-hours)

## Migration Process

### Phase 1: Backup (10-30 minutes)

- [ ] Create backup directory: `/opt/stacks/huly-test-v07/backup-all`
- [ ] Run backup command from v0.6 instance
- [ ] Verify backup files exist in backup directory
- [ ] Note backup size and verify completeness

**Command to run from `/opt/stacks/huly-selfhost`:**
```bash
source .env
docker run --rm \
  --network "${DOCKER_NAME}_default" \
  -e SERVER_SECRET="$SECRET" \
  -e TRANSACTOR_URL="ws://transactor:3333" \
  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \
  -e ACCOUNT_DB_URL="mongodb://mongodb:27017" \
  -e ACCOUNTS_URL="http://account:3000" \
  -e DB_URL="mongodb://mongodb:27017" \
  -v /opt/stacks/huly-test-v07/backup-all:/backup \
  -it hardcoreeng/tool:v0.6.504 \
  -- bundle.js backup-all-to-dir /backup \
  --internal true \
  --blobLimit 4096
```

### Phase 2: Prepare v0.7 Instance (5 minutes)

- [ ] Start v0.7 services: `cd /opt/stacks/huly-test-v07 && docker-compose up -d`
- [ ] Wait 30 seconds for services to initialize
- [ ] Verify all services are running: `docker-compose ps`
- [ ] Create ConfigUser account (see command in guide)
- [ ] Initialize Kafka topics (see command in guide)

### Phase 3: Data Restore (5-30 minutes)

- [ ] Run restore command (see MIGRATION_GUIDE_v06_to_v07.md Step 6)
- [ ] Monitor restoration progress in logs
- [ ] Wait for "restoration complete" message
- [ ] Check for any critical errors (ignore Kafka warnings)

**Expected Output:**
- Creating database messages
- Migrating workspace messages  
- Upgrade complete messages
- Some Kafka connection warnings (OK to ignore)

### Phase 4: Post-Migration Verification (10 minutes)

- [ ] Restart services: `docker-compose restart workspace transactor account`
- [ ] Check service health: `docker-compose ps`
- [ ] Review logs for errors: `docker-compose logs --tail=100 workspace transactor`
- [ ] Access UI at http://192.168.50.90:8201
- [ ] Login with v0.6 credentials

## Verification Tests

### Critical Tests (Must Pass)

- [ ] **User Login**: Can login with existing credentials
- [ ] **Workspace Access**: All workspaces appear in list
- [ ] **Project Visibility**: Projects are visible in each workspace
- [ ] **Issue Access**: Can open and read existing issues
- [ ] **File Attachments**: Can view existing file attachments
- [ ] **User Permissions**: User roles and permissions preserved

### Important Tests (Should Pass)

- [ ] **Create New Issue**: Can create new issues
- [ ] **Edit Issue**: Can edit existing issues  
- [ ] **Comment**: Can add comments to issues
- [ ] **Notifications**: Notifications appear correctly
- [ ] **Search**: Search functionality works
- [ ] **Activity History**: Activity logs are present

### Nice-to-Have Tests (May have minor issues)

- [ ] **File Upload**: Can upload new files
- [ ] **Settings**: Workspace settings load correctly
- [ ] **Integrations**: GitHub integration works (if used)
- [ ] **Bulk Operations**: Can perform bulk edits
- [ ] **Reports**: Reporting features work

## Known Issues (Non-Critical)

These issues are expected and don't prevent core functionality:

- ⚠️ `platform://` URL errors in browser console (file loading)
- ⚠️ Settings component "undefined key" error
- ⚠️ JSON parsing errors for some plugins
- ⚠️ "Cannot find social id ConfigUser" warnings in workspace logs

## Success Criteria

Migration is successful if:

✅ All users can login  
✅ All workspaces are accessible  
✅ All projects and issues are visible  
✅ File attachments work  
✅ Can create and edit issues  
✅ Comments and activity history preserved  

## Rollback Plan

If migration fails:

1. **Keep v0.6 instance running** - Do NOT shut it down
2. **Document failure** - Note what went wrong
3. **Point users back to v0.6** production URL
4. **Investigate v0.7 issue** separately
5. **Retry migration** after fixing issues

## Timeline Estimate

| Phase | Duration | Description |
|-------|----------|-------------|
| Backup | 10-30 min | Depends on data size |
| Prepare | 5 min | Start services, create accounts |
| Restore | 5-30 min | Depends on data size |
| Verify | 10 min | Check functionality |
| **Total** | **30-75 min** | Plus buffer time |

## Quick Commands Reference

**Check v0.7 Status:**
```bash
cd /opt/stacks/huly-test-v07
docker-compose ps
```

**View Logs:**
```bash
docker-compose logs -f workspace transactor
```

**Check Database:**
```bash
docker exec huly-test-cockroachdb-1 ./cockroach sql --insecure \
  --database=defaultdb \
  --execute="SELECT uuid, name FROM global_account.workspace;"
```

**Restart Service:**
```bash
docker-compose restart workspace
```

## Support Information

**Documentation:**
- Migration Guide: `/opt/stacks/huly-test-v07/MIGRATION_GUIDE_v06_to_v07.md`
- This Checklist: `/opt/stacks/huly-test-v07/MIGRATION_CHECKLIST.md`

**Instance Details:**
- v0.6 Production: `/opt/stacks/huly-selfhost`
- v0.7 Test: `/opt/stacks/huly-test-v07`
- v0.7 URL: http://192.168.50.90:8201

**Key Files:**
- Backup Location: `/opt/stacks/huly-test-v07/backup-all/`
- Docker Compose: `/opt/stacks/huly-test-v07/docker-compose.yml`
- Environment: `/opt/stacks/huly-test-v07/.env`

---

**Migration Date:** _______________  
**Started By:** _______________  
**Completed:** _______________  
**Status:** ⬜ Success ⬜ Failed ⬜ Partial  
**Notes:** _______________________________________________
