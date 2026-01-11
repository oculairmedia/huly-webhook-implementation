#!/bin/bash
#
# Huly v0.6 to v0.7 Migration Script
# This script automates the migration process
#

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
V07_DIR="/opt/stacks/huly-test-v07"
V06_DIR="/opt/stacks/huly-selfhost"
BACKUP_DIR="$V07_DIR/backup-all"
SECRET="3beb652043f165b41dd683e970f9d9ea79b397d8064277fcea516f5304c6875e"

echo -e "${GREEN}=== Huly v0.6 to v0.7 Migration ===${NC}\n"

# Step 1: Check prerequisites
echo -e "${YELLOW}Step 1: Checking prerequisites...${NC}"

if [ ! -d "$V06_DIR" ]; then
    echo -e "${RED}ERROR: v0.6 instance not found at $V06_DIR${NC}"
    exit 1
fi

if [ ! -d "$V07_DIR" ]; then
    echo -e "${RED}ERROR: v0.7 instance not found at $V07_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}\n"

# Step 2: Create backup directory
echo -e "${YELLOW}Step 2: Creating backup directory...${NC}"
mkdir -p "$BACKUP_DIR"
chmod 755 "$BACKUP_DIR"
echo -e "${GREEN}✓ Backup directory created: $BACKUP_DIR${NC}\n"

# Step 3: Prompt for backup
echo -e "${YELLOW}Step 3: Ready to backup v0.6 data${NC}"
echo "This will create a full backup of your production instance."
echo -e "${RED}IMPORTANT: This may take 10-30 minutes depending on data size.${NC}"
read -p "Continue with backup? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Migration cancelled."
    exit 0
fi

echo -e "\n${YELLOW}Creating backup from v0.6 instance...${NC}"
echo "Please run this command manually from $V06_DIR:"
echo ""
echo "cd $V06_DIR"
echo "source .env"
echo 'docker run --rm \'
echo '  --network "${DOCKER_NAME}_default" \'
echo '  -e SERVER_SECRET="$SECRET" \'
echo '  -e TRANSACTOR_URL="ws://transactor:3333" \'
echo '  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \'
echo '  -e ACCOUNT_DB_URL="mongodb://mongodb:27017" \'
echo '  -e ACCOUNTS_URL="http://account:3000" \'
echo '  -e DB_URL="mongodb://mongodb:27017" \'
echo "  -v $BACKUP_DIR:/backup \\"
echo '  -it hardcoreeng/tool:v0.6.504 \'
echo '  -- bundle.js backup-all-to-dir /backup \'
echo '  --internal true \'
echo '  --blobLimit 4096'
echo ""
read -p "Press ENTER when backup is complete..."

# Verify backup
if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A $BACKUP_DIR)" ]; then
    echo -e "${RED}ERROR: Backup directory is empty!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Backup verified${NC}\n"

# Step 4: Start v0.7 instance
echo -e "${YELLOW}Step 4: Starting v0.7 instance...${NC}"
cd "$V07_DIR"
docker-compose up -d

echo "Waiting for services to start (30 seconds)..."
sleep 30

echo -e "${GREEN}✓ v0.7 instance started${NC}\n"

# Step 5: Create ConfigUser
echo -e "${YELLOW}Step 5: Creating ConfigUser account...${NC}"

docker run --rm \
  --network huly-test_default \
  -e SERVER_SECRET="$SECRET" \
  -e ACCOUNTS_URL="http://account:3000" \
  -e TRANSACTOR_URL="ws://transactor:3333" \
  -e ACCOUNT_DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  hardcoreeng/tool:s0.7.306 -- bundle.js create-account \
  -p config -f Config -l User \
  config@huly.io

echo -e "${GREEN}✓ ConfigUser created${NC}\n"

# Step 6: Initialize Kafka topics
echo -e "${YELLOW}Step 6: Initializing Kafka topics...${NC}"

docker run --rm \
  --network huly-test_default \
  -e SERVER_SECRET="$SECRET" \
  -e ACCOUNTS_URL="http://account:3000" \
  -e TRANSACTOR_URL="ws://transactor:3333" \
  -e ACCOUNT_DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  -e QUEUE_CONFIG="kafka:9092" \
  hardcoreeng/tool:s0.7.306 -- bundle.js queue-init-topics

echo -e "${GREEN}✓ Kafka topics initialized${NC}\n"

# Step 7: Restore backup
echo -e "${YELLOW}Step 7: Restoring v0.6 backup to v0.7...${NC}"
echo -e "${RED}This will take 5-30 minutes. DO NOT INTERRUPT!${NC}\n"

docker run --rm \
  --network huly-test_default \
  -e SERVER_SECRET="$SECRET" \
  -e TRANSACTOR_URL="ws://transactor:3333" \
  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \
  -e ACCOUNT_DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  -e ACCOUNTS_URL="http://account:3000" \
  -e DB_URL="postgresql://root@cockroachdb:26257/defaultdb?sslmode=disable" \
  -e QUEUE_CONFIG="kafka:9092" \
  -v "$BACKUP_DIR:/backup" \
  -it hardcoreeng/tool:s0.7.306 \
  -- bundle.js restore-from-v6-all /backup

echo -e "${GREEN}✓ Restore completed${NC}\n"

# Step 8: Restart services
echo -e "${YELLOW}Step 8: Restarting services...${NC}"
docker-compose restart workspace transactor account

echo "Waiting for services to restart (10 seconds)..."
sleep 10

echo -e "${GREEN}✓ Services restarted${NC}\n"

# Final status
echo -e "${GREEN}=== Migration Complete! ===${NC}\n"
echo "Your migrated instance is now available at:"
echo "  http://192.168.50.90:8201"
echo ""
echo "Next steps:"
echo "  1. Login with your existing v0.6 credentials"
echo "  2. Verify all workspaces are present"
echo "  3. Check that projects and issues are intact"
echo "  4. Test core functionality"
echo ""
echo "To check service status:"
echo "  cd $V07_DIR"
echo "  docker-compose ps"
echo ""
echo "To view logs:"
echo "  docker-compose logs -f workspace transactor"
echo ""
