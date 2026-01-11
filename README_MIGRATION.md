# Huly v0.7 Migration - Ready to Execute

## Status: ✅ Ready for Migration

All test accounts and workspaces have been removed. The v0.7 instance is now ready for production data migration.

## Quick Start

You have **three options** to perform the migration:

### Option 1: Automated Script (Recommended)
```bash
cd /opt/stacks/huly-test-v07
./migrate.sh
```

### Option 2: Step-by-Step Checklist
Follow the detailed checklist:
```bash
cat /opt/stacks/huly-test-v07/MIGRATION_CHECKLIST.md
```

### Option 3: Manual Commands
Follow the full guide:
```bash
cat /opt/stacks/huly-test-v07/MIGRATION_GUIDE_v06_to_v07.md
```

## Critical Information

**⏱️ Estimated Time:** 30-60 minutes  
**⚠️ Downtime Required:** Yes (notify users)  
**🔄 Rollback:** Keep v0.6 running until verified  
**💾 Backup Location:** `/opt/stacks/huly-test-v07/backup-all/`  

## Key Steps Summary

1. **Backup** v0.6 data (from `/opt/stacks/huly-selfhost`)
2. **Start** v0.7 services
3. **Create** system accounts
4. **Restore** v0.6 backup to v0.7
5. **Verify** migration success
6. **Test** functionality

## After Migration

Access your migrated instance at:
- **URL:** http://192.168.50.90:8201
- **Login:** Use your existing v0.6 credentials
- **Workspaces:** All should appear automatically

## What Gets Migrated

✅ All user accounts and passwords  
✅ All workspaces and settings  
✅ All projects and issues  
✅ All comments and activity history  
✅ All file attachments  
✅ All labels, tags, and metadata  
✅ All user permissions and roles  

## What Changes

🔄 Database: MongoDB → CockroachDB  
🔄 Queue: None → Kafka  
🔄 URL: Port 8101 → Port 8201 (test)  
🔄 Version: v0.6.x → s0.7.306  

## Files in This Directory

| File | Purpose |
|------|---------|
| `README_MIGRATION.md` | This file - quick overview |
| `MIGRATION_GUIDE_v06_to_v07.md` | Detailed step-by-step guide |
| `MIGRATION_CHECKLIST.md` | Printable checklist |
| `migrate.sh` | Automated migration script |
| `docker-compose.yml` | v0.7 service configuration |
| `.env` | Environment variables |
| `.huly.nginx` | Nginx proxy configuration |
| `backup-all/` | Will contain v0.6 backup data |

## Pre-Migration Verification

Before you begin, verify:

```bash
# 1. Check v0.6 is running
docker ps | grep huly-selfhost

# 2. Check v0.7 is ready
cd /opt/stacks/huly-test-v07
docker-compose ps  # Should show all containers stopped

# 3. Check disk space (need at least 10GB free)
df -h /opt/stacks

# 4. Verify backup directory exists
ls -ld /opt/stacks/huly-test-v07/backup-all
```

## Common Issues & Solutions

### Issue: Backup takes very long
**Solution:** This is normal for large instances. Monitor progress and wait.

### Issue: Kafka connection errors during restore
**Solution:** These warnings are expected and can be ignored. Restore will complete successfully.

### Issue: "Cannot find ConfigUser" warnings
**Solution:** Restart workspace service: `docker-compose restart workspace`

### Issue: Login fails after migration
**Solution:** Check that accounts were migrated:
```bash
docker exec huly-test-cockroachdb-1 ./cockroach sql --insecure \
  --database=defaultdb \
  --execute="SELECT first_name, last_name FROM global_account.person;"
```

## Getting Help

1. **Check Logs:**
   ```bash
   cd /opt/stacks/huly-test-v07
   docker-compose logs -f workspace transactor account
   ```

2. **Check Service Health:**
   ```bash
   docker-compose ps
   ```

3. **Review Documentation:**
   - MIGRATION_GUIDE_v06_to_v07.md (detailed steps)
   - MIGRATION_CHECKLIST.md (verification tests)

## Next Steps

Once migration is complete and verified:

1. **Monitor** for 24-48 hours on test URL
2. **Gather feedback** from test users  
3. **Plan cutover** to replace production instance
4. **Update DNS/URLs** to point to new v0.7 instance
5. **Archive v0.6** backup for compliance

## Environment Details

### Production (v0.6)
- **Location:** `/opt/stacks/huly-selfhost`
- **Version:** v0.6.504 (or similar)
- **Database:** MongoDB
- **URL:** http://pm.oculair.ca:8101 (approx)

### Test/Target (v0.7)
- **Location:** `/opt/stacks/huly-test-v07`
- **Version:** s0.7.306
- **Database:** CockroachDB v23.1.11
- **Queue:** Apache Kafka 3.7.0
- **URL:** http://192.168.50.90:8201

## Important Notes

⚠️ **ONE-WAY MIGRATION** - Cannot rollback after completion  
⚠️ **KEEP v0.6 RUNNING** - Until v0.7 fully verified  
⚠️ **BACKUP IS CRITICAL** - Verify backup before restore  
⚠️ **NOTIFY USERS** - Schedule downtime appropriately  

## Support

For issues during migration:
1. Preserve all log output
2. Do NOT delete v0.6 instance or backup
3. Document exact error messages
4. Check CockroachDB admin UI: http://192.168.50.90:8090

---

**Ready to Migrate?**

Choose your preferred method above and begin!

**Created:** 2025-11-19  
**Status:** ✅ Test instance clean and ready  
**Next Action:** Run migration backup from v0.6
