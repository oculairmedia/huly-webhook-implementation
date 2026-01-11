# Huly v0.6 to v0.7 Migration Guide

## Overview

This guide will help you migrate your production Huly v0.6 instance (MongoDB-based) to the new v0.7 test instance (CockroachDB-based).

**IMPORTANT**: This migration is **ONE-WAY**. Do not attempt to rollback to v0.6 after migrating to v0.7.

## Prerequisites

- ✅ Production v0.6 instance running at `/opt/stacks/huly-selfhost` 
- ✅ Test v0.7 instance prepared at `/opt/stacks/huly-test-v07`
- ✅ Sufficient disk space for backup (at least 2x your current data size)
- ⚠️ **Downtime required**: Plan for 30-60 minutes of downtime

## Migration Steps

### Step 1: Create Backup Directory

```bash
# Create backup directory with absolute path
mkdir -p /opt/stacks/huly-test-v07/backup-all
chmod 755 /opt/stacks/huly-test-v07/backup-all
```

### Step 2: Backup v0.6 Data

Run this command from your **v0.6 production directory**:

```bash
cd /opt/stacks/huly-selfhost

# Load environment variables
source .env

# Create full backup (this will take some time)
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

**Expected Output:**
- Backup progress messages
- Files created in `/opt/stacks/huly-test-v07/backup-all/`
- Completion message

**Verify Backup:**
```bash
ls -lh /opt/stacks/huly-test-v07/backup-all/
# Should show multiple JSON files and blob data
```

### Step 3: Start Fresh v0.7 Instance

```bash
cd /opt/stacks/huly-test-v07

# Start all services
docker-compose up -d

# Wait for services to be healthy (about 30 seconds)
sleep 30

# Check service status
docker-compose ps
```

### Step 4: Create ConfigUser Account

```bash
cd /opt/stacks/huly-test-v07

docker run --rm \
  --network huly-test_default \
  -e SERVER_SECRET="3beb652043f165b41dd683e970f9d9ea79b397d8064277fcea516f5304c6875e" \
  -e ACCOUNTS_URL="http://account:3000" \
  -e TRANSACTOR_URL="ws://transactor:3333" \
  -e ACCOUNT_DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  hardcoreeng/tool:s0.7.306 -- bundle.js create-account \
  -p config -f Config -l User \
  config@huly.io
```

### Step 5: Initialize Kafka Topics

```bash
cd /opt/stacks/huly-test-v07

docker run --rm \
  --network huly-test_default \
  -e SERVER_SECRET="3beb652043f165b41dd683e970f9d9ea79b397d8064277fcea516f5304c6875e" \
  -e ACCOUNTS_URL="http://account:3000" \
  -e TRANSACTOR_URL="ws://transactor:3333" \
  -e ACCOUNT_DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  -e QUEUE_CONFIG="kafka:9092" \
  hardcoreeng/tool:s0.7.306 -- bundle.js queue-init-topics
```

### Step 6: Restore v0.6 Backup to v0.7

This is the critical step that imports all your data:

```bash
cd /opt/stacks/huly-test-v07

docker run --rm \
  --network huly-test_default \
  -e SERVER_SECRET="3beb652043f165b41dd683e970f9d9ea79b397d8064277fcea516f5304c6875e" \
  -e TRANSACTOR_URL="ws://transactor:3333" \
  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \
  -e ACCOUNT_DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  -e ACCOUNTS_URL="http://account:3000" \
  -e DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  -e QUEUE_CONFIG="kafka:9092" \
  -v /opt/stacks/huly-test-v07/backup-all:/backup \
  -it hardcoreeng/tool:s0.7.306 \
  -- bundle.js restore-from-v6-all /backup
```

**Expected Duration:** 5-30 minutes depending on data size

**What This Does:**
- Converts MongoDB data to CockroachDB format
- Migrates all workspaces
- Migrates all users and accounts
- Migrates all issues, projects, and documents
- Migrates all file attachments
- Migrates all activity history

**Monitor Progress:**
```bash
# In another terminal, watch the logs
cd /opt/stacks/huly-test-v07
docker-compose logs -f transactor workspace
```

### Step 7: Restart Services

After restoration completes:

```bash
cd /opt/stacks/huly-test-v07

# Restart to ensure all services pick up migrated data
docker-compose restart workspace transactor account

# Wait for services to stabilize
sleep 10
```

### Step 8: Verify Migration

```bash
# Check that services are running
docker-compose ps

# Check workspace logs for errors
docker-compose logs --tail=50 workspace

# Check transactor logs for errors
docker-compose logs --tail=50 transactor
```

**Access the UI:**
- Open browser to: `http://192.168.50.90:8201`
- Login with your existing v0.6 credentials
- Verify your workspaces appear
- Check that your projects and issues are present

## Post-Migration Checklist

- [ ] All users can login successfully
- [ ] All workspaces are accessible
- [ ] All projects and issues are visible
- [ ] File attachments are accessible
- [ ] Activity history is preserved
- [ ] Notifications are working
- [ ] Collaborator/comments working

## Troubleshooting

### Restore Fails with "Kafka Connection Error"

**Symptoms:** Errors mentioning "getaddrinfo ENOTFOUND huly.local"

**Solution:** These Kafka errors are non-critical during restore. The restore will continue and complete successfully despite these warnings.

### "Cannot find social id ConfigUser" Warnings

**Symptoms:** Workspace logs showing "Cannot find social id _id=core:account:ConfigUser"

**Solution:** Restart the workspace service:
```bash
docker-compose restart workspace
```

### Login Fails After Migration

**Solution:** Verify accounts were migrated:
```bash
docker exec huly-test-cockroachdb-1 ./cockroach sql --insecure \
  --database=defaultdb \
  --execute="SELECT uuid, first_name, last_name FROM global_account.person;"
```

### Workspace Doesn't Load

**Solution:** Check workspace upgrade status:
```bash
docker-compose logs workspace | grep -i upgrade
```

## Rollback Plan (Emergency Only)

If migration fails critically:

1. **DO NOT** delete your v0.6 backup
2. Keep v0.6 instance running at `/opt/stacks/huly-selfhost`
3. Point users back to production URL
4. Investigate v0.7 issues separately

## Performance After Migration

v0.7 uses CockroachDB which has different performance characteristics:

- **Faster** concurrent writes (Kafka queuing)
- **Better** horizontal scalability
- **More** resource usage initially (Kafka + CockroachDB)

## Next Steps After Successful Migration

1. **Monitor for 24-48 hours** on test URL
2. **Run production workload** to verify stability
3. **Plan cutover** to replace production instance
4. **Update DNS/URLs** to point to new instance
5. **Archive v0.6 backup** for compliance

## Support Resources

- Official Huly Docs: https://github.com/hcengineering/huly-selfhost
- Migration Issues: Check workspace and transactor logs
- Database Issues: Check CockroachDB logs at `http://192.168.50.90:8090`

## Environment Details

**Test Instance:**
- Location: `/opt/stacks/huly-test-v07`
- Version: `s0.7.306`
- Database: CockroachDB v23.1.11
- Queue: Apache Kafka 3.7.0
- URL: `http://192.168.50.90:8201`

**Production Instance:**
- Location: `/opt/stacks/huly-selfhost`
- Version: `v0.6.x`
- Database: MongoDB
- URL: `http://pm.oculair.ca:8101` (or similar)

---

**Created:** 2025-11-19
**Status:** Ready for migration
**Estimated Time:** 30-60 minutes total
