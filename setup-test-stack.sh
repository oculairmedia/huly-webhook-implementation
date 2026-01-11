#!/bin/bash
#
# Huly v0.7 Test Stack Setup Script
# This script creates a parallel test environment for migrating to v0.7.306
#

set -e

echo "=========================================="
echo "Huly v0.7 Test Stack Setup"
echo "=========================================="
echo ""

# Configuration
TEST_DIR="/opt/stacks/huly-test-v07"
PROD_DIR="/opt/stacks/huly-selfhost"
BACKUP_DIR="/opt/backups/huly-migration-$(date +%Y%m%d)"
NEW_VERSION="s0.7.306"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Creating test stack directory${NC}"
if [ -d "$TEST_DIR" ]; then
    echo -e "${RED}Warning: Test directory already exists at $TEST_DIR${NC}"
    read -p "Do you want to remove it and start fresh? (yes/no): " -r
    if [[ $REPLY =~ ^[Yy]es$ ]]; then
        echo "Removing existing test directory..."
        rm -rf "$TEST_DIR"
    else
        echo "Aborting. Please remove or rename the existing directory first."
        exit 1
    fi
fi

echo "Copying production stack to test directory..."
cp -r "$PROD_DIR" "$TEST_DIR"
echo -e "${GREEN}✓ Test directory created${NC}"
echo ""

echo -e "${YELLOW}Step 2: Modifying configuration for test environment${NC}"
cd "$TEST_DIR"

# Update .env file for test stack
cp .env .env.test
cat > .env << EOF
HULY_VERSION=$NEW_VERSION
DOCKER_NAME=huly-test

# Test stack uses different address
HOST_ADDRESS=localhost
SECURE=false
HTTP_PORT=8201
HTTP_BIND=

# Huly specific variables
TITLE=Huly Test (v0.7)
DEFAULT_LANGUAGE=en
LAST_NAME_FIRST=true

# Use the same secret for compatibility
SECRET=$(grep "^SECRET=" "$PROD_DIR/.env" | cut -d= -f2)

# GitHub OAuth Configuration (same as production)
GITHUB_CLIENT_ID=$(grep "^GITHUB_CLIENT_ID=" "$PROD_DIR/.env" | cut -d= -f2)
GITHUB_CLIENT_SECRET=$(grep "^GITHUB_CLIENT_SECRET=" "$PROD_DIR/.env" | cut -d= -f2)

# GitHub App Configuration (same as production)
GITHUB_APP=$(grep "^GITHUB_APP=" "$PROD_DIR/.env" | cut -d= -f2)
GITHUB_APP_ID=$(grep "^GITHUB_APP_ID=" "$PROD_DIR/.env" | cut -d= -f2)
GITHUB_APP_CLIENT_ID=$(grep "^GITHUB_APP_CLIENT_ID=" "$PROD_DIR/.env" | cut -d= -f2)
GITHUB_APP_CLIENT_SECRET=$(grep "^GITHUB_APP_CLIENT_SECRET=" "$PROD_DIR/.env" | cut -d= -f2)
GITHUB_APP_PRIVATE_KEY=$(grep "^GITHUB_APP_PRIVATE_KEY=" "$PROD_DIR/.env" | cut -d= -f2)
GITHUB_WEBHOOK_SECRET=$(grep "^GITHUB_WEBHOOK_SECRET=" "$PROD_DIR/.env" | cut -d= -f2)
GITHUB_BOT_NAME=$(grep "^GITHUB_BOT_NAME=" "$PROD_DIR/.env" | cut -d= -f2)

# Huly MCP Server Configuration (different ports)
HULY_MCP_EMAIL=$(grep "^HULY_MCP_EMAIL=" "$PROD_DIR/.env" | cut -d= -f2)
HULY_MCP_PASSWORD=$(grep "^HULY_MCP_PASSWORD=" "$PROD_DIR/.env" | cut -d= -f2)
HULY_MCP_WORKSPACE=$(grep "^HULY_MCP_WORKSPACE=" "$PROD_DIR/.env" | cut -d= -f2)

# GitHub token for @hcengineering packages
GITHUB_TOKEN=$(grep "^GITHUB_TOKEN=" "$PROD_DIR/.env" | cut -d= -f2)
EOF

echo -e "${GREEN}✓ .env file created for test stack${NC}"
echo ""

echo -e "${YELLOW}Step 3: Updating docker-compose.yml${NC}"

# Backup original
cp docker-compose.yml docker-compose.yml.original

# Create updated docker-compose.yml for v0.7 with different ports
cat > docker-compose.yml << 'COMPOSE_EOF'
name: ${DOCKER_NAME}
version: "3"
services:
  nginx:
    image: nginx:1.21.3
    ports:
      - ${HTTP_BIND}:${HTTP_PORT}:80
    volumes:
      - ./.huly.nginx:/etc/nginx/conf.d/default.conf
    restart: unless-stopped
  mongodb:
    image: mongo:7-jammy
    environment:
      - PUID=1000
      - PGID=1000
    volumes:
      - db:/data/db
    restart: unless-stopped
  minio:
    image: minio/minio
    command: server /data --address ":9000" --console-address ":9001"
    volumes:
      - files:/data
    restart: unless-stopped
  elastic:
    image: elasticsearch:7.14.2
    command: >
      /bin/sh -c "./bin/elasticsearch-plugin list | grep -q ingest-attachment ||
      yes | ./bin/elasticsearch-plugin install --silent ingest-attachment;

      /usr/local/bin/docker-entrypoint.sh eswrapper"
    volumes:
      - elastic:/usr/share/elasticsearch/data
    environment:
      - ELASTICSEARCH_PORT_NUMBER=9200
      - BITNAMI_DEBUG=true
      - discovery.type=single-node
      - ES_JAVA_OPTS=-Xms1024m -Xmx1024m
      - http.cors.enabled=true
      - http.cors.allow-origin=http://localhost:8082
    healthcheck:
      interval: 20s
      retries: 10
      test: curl -s http://localhost:9200/_cluster/health | grep -vq '"status":"red"'
    restart: unless-stopped
  rekoni:
    image: hardcoreeng/rekoni-service:${HULY_VERSION}
    environment:
      - SECRET=${SECRET}
    deploy:
      resources:
        limits:
          memory: 500M
    restart: unless-stopped
  transactor:
    image: hardcoreeng/transactor:${HULY_VERSION}
    environment:
      - SERVER_PORT=3333
      - SERVER_SECRET=${SECRET}
      - SERVER_CURSOR_MAXTIMEMS=30000
      - DB_URL=mongodb://mongodb:27017
      - MONGO_URL=mongodb://mongodb:27017
      - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
      - FRONT_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}
      - ACCOUNTS_URL=http://account:3000
      - FULLTEXT_URL=http://fulltext:4700
      - STATS_URL=http://stats:4900
      - LAST_NAME_FIRST=${LAST_NAME_FIRST:-true}
    restart: unless-stopped
  collaborator:
    image: hardcoreeng/collaborator:${HULY_VERSION}
    environment:
      - COLLABORATOR_PORT=3078
      - SECRET=${SECRET}
      - ACCOUNTS_URL=http://account:3000
      - DB_URL=mongodb://mongodb:27017
      - STATS_URL=http://stats:4900
      - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
    restart: unless-stopped
  account:
    image: hardcoreeng/account:${HULY_VERSION}
    environment:
      - SERVER_PORT=3000
      - SERVER_SECRET=${SECRET}
      - DB_URL=mongodb://mongodb:27017
      - MONGO_URL=mongodb://mongodb:27017
      - TRANSACTOR_URL=ws://transactor:3333;ws${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_transactor
      - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
      - FRONT_URL=http://front:8080
      - STATS_URL=http://stats:4900
      - MODEL_ENABLED=*
      - ACCOUNTS_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_accounts
      - ACCOUNT_PORT=3000
      - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
      - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
    restart: unless-stopped
  workspace:
    image: hardcoreeng/workspace:${HULY_VERSION}
    environment:
      - SERVER_SECRET=${SECRET}
      - DB_URL=mongodb://mongodb:27017
      - MONGO_URL=mongodb://mongodb:27017
      - TRANSACTOR_URL=ws://transactor:3333;ws${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_transactor
      - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
      - MODEL_ENABLED=*
      - ACCOUNTS_URL=http://account:3000
      - STATS_URL=http://stats:4900
    restart: unless-stopped
  front:
    image: hardcoreeng/front:${HULY_VERSION}
    environment:
      - SERVER_PORT=8080
      - SERVER_SECRET=${SECRET}
      - LOVE_ENDPOINT=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_love
      - ACCOUNTS_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_accounts
      - REKONI_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_rekoni
      - CALENDAR_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_calendar
      - GMAIL_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_gmail
      - TELEGRAM_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_telegram
      - STATS_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_stats
      - UPLOAD_URL=/files
      - ELASTIC_URL=http://elastic:9200
      - COLLABORATOR_URL=ws${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_collaborator
      - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
      - DB_URL=mongodb://mongodb:27017
      - MONGO_URL=mongodb://mongodb:27017
      - TITLE=${TITLE:-Huly Test}
      - DEFAULT_LANGUAGE=${DEFAULT_LANGUAGE:-en}
      - LAST_NAME_FIRST=${LAST_NAME_FIRST:-true}
      - DESKTOP_UPDATES_CHANNEL=selfhost
      - GITHUB_APP=${GITHUB_APP}
      - GITHUB_CLIENTID=${GITHUB_APP_CLIENT_ID}
      - GITHUB_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_github
    restart: unless-stopped
  fulltext:
    image: hardcoreeng/fulltext:${HULY_VERSION}
    environment:
      - SERVER_SECRET=${SECRET}
      - DB_URL=mongodb://mongodb:27017
      - FULLTEXT_DB_URL=http://elastic:9200
      - ELASTIC_INDEX_NAME=huly_storage_index
      - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
      - REKONI_URL=http://rekoni:4004
      - ACCOUNTS_URL=http://account:3000
      - STATS_URL=http://stats:4900
    restart: unless-stopped
  stats:
    image: hardcoreeng/stats:${HULY_VERSION}
    environment:
      - PORT=4900
      - SERVER_SECRET=${SECRET}
    restart: unless-stopped
  github:
    image: hardcoreeng/github:${HULY_VERSION}
    environment:
      - PORT=3500
      - ACCOUNTS_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_accounts
      - SERVER_SECRET=${SECRET}
      - SERVICE_ID=github-service
      - FRONT_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}
      - APP_ID=${GITHUB_APP_ID}
      - CLIENT_ID=${GITHUB_APP_CLIENT_ID}
      - CLIENT_SECRET=${GITHUB_APP_CLIENT_SECRET}
      - PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY}
      - WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - BOT_NAME=${GITHUB_BOT_NAME}
      - COLLABORATOR_URL=ws${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}/_collaborator
      - MONGO_URL=mongodb://mongodb:27017
      - DB_URL=mongodb://mongodb:27017
      - MINIO_ENDPOINT=minio
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
      - ELASTIC_URL=http://elastic:9200
      - REKONI_URL=http://rekoni:4004
      - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
    restart: unless-stopped
  huly-mcp:
    build:
      context: ./huly-mcp-server
      args:
        GITHUB_TOKEN: ${GITHUB_TOKEN}
    environment:
      - NODE_ENV=production
      - PORT=3000
      - LOG_LEVEL=debug
      - HULY_URL=http://nginx
      - HULY_PUBLIC_URL=http${SECURE:+s}://${HOST_ADDRESS}:${HTTP_PORT}
      - HULY_EMAIL=${HULY_MCP_EMAIL}
      - HULY_PASSWORD=${HULY_MCP_PASSWORD}
      - HULY_WORKSPACE=${HULY_MCP_WORKSPACE}
      - HULY_MCP_REQUEST_TIMEOUT_MS=60000
      - HULY_HTTP_KEEPALIVE_MS=120000
      - HULY_HTTP_HEADERS_TIMEOUT_MS=130000
      - HULY_HTTP_REQUEST_TIMEOUT_MS=0
      - HULY_ALLOWED_ORIGINS=*
    ports:
      - "3557:3000"
    volumes:
      - ./huly-mcp-server/index.js:/app/index.js:ro
      - ./huly-mcp-server/src:/app/src:ro
    depends_on:
      - nginx
      - front
      - account
      - transactor
    restart: unless-stopped
volumes:
  db: null
  elastic: null
  files: null
networks: {}
COMPOSE_EOF

echo -e "${GREEN}✓ docker-compose.yml updated for v0.7${NC}"
echo ""

echo -e "${YELLOW}Step 4: Restoring production data to test stack${NC}"
echo "Stopping any running test containers..."
docker-compose down -v 2>/dev/null || true

echo "Starting MongoDB in test stack..."
docker-compose up -d mongodb

echo "Waiting for MongoDB to be ready..."
sleep 10

echo "Restoring backup to test MongoDB..."
docker cp "$BACKUP_DIR/mongodb/migration-"* huly-test-mongodb-1:/backup/
docker exec huly-test-mongodb-1 mongorestore /backup/migration-*/

echo -e "${GREEN}✓ Production data restored to test stack${NC}"
echo ""

echo -e "${GREEN}=========================================="
echo "Test Stack Setup Complete!"
echo "==========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Start the test stack:"
echo "   cd $TEST_DIR"
echo "   docker-compose up -d"
echo ""
echo "2. Access the test stack at:"
echo "   http://localhost:8201"
echo ""
echo "3. MCP Server will be available at:"
echo "   http://localhost:3557"
echo ""
echo "4. Monitor logs:"
echo "   docker-compose logs -f"
echo ""
echo -e "${YELLOW}Note: This test stack runs on different ports${NC}"
echo -e "${YELLOW}Production stack remains running on port 8101${NC}"
echo ""
