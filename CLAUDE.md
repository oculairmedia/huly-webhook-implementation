# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a self-hosted Huly deployment repository containing:
- **Huly Platform**: A robust business application framework (CRM, Project Management, Chat, HRM, ATS)
- **Docker Compose Setup**: Complete containerized deployment configuration
- **Huly MCP Server**: Model Context Protocol server for AI integration
- **Nginx Proxy**: Reverse proxy configuration for all services

## Architecture

### Service Architecture (docker-compose.yml)

The deployment consists of 15+ containerized services orchestrated through Docker Compose:

**Core Infrastructure:**
- `nginx`: Reverse proxy and load balancer (port 8101)
- `mongodb`: Database storage for all platform data
- `minio`: Object storage for files and attachments
- `elastic`: Full-text search indexing with Elasticsearch 7.14.2

**Core Huly Services:**
- `transactor`: Core business logic and data transactions (port 3333)
- `account`: User authentication and account management (port 3000)
- `workspace`: Workspace management and configuration
- `front`: Frontend web application (port 8080)
- `collaborator`: Real-time collaboration features (port 3078)
- `stats`: Analytics and statistics collection (port 4900)

**Supporting Services:**
- `rekoni`: Document processing and OCR service (port 4004)
- `fulltext`: Full-text search service (port 4700)
- `github`: GitHub integration service (port 3500)
- `huly-mcp`: MCP server for AI integration (port 3457)

### Key Configuration Files

- `docker-compose.yml`: Main service orchestration
- `.env`: Environment variables and secrets
- `.huly.nginx`: Nginx reverse proxy configuration
- `huly-mcp-server/`: MCP server implementation for AI integration

## Common Operations

### Deployment Commands

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs for specific service
docker-compose logs -f <service_name>

# Restart specific service
docker-compose restart <service_name>

# Build and update MCP server
docker-compose up -d --build huly-mcp

# Check service status
docker-compose ps
```

### Service Management

```bash
# Health checks
curl http://localhost:8101/  # Main application
curl http://localhost:3457/health  # MCP server

# Database operations
docker-compose exec mongodb mongo  # MongoDB shell
docker-compose exec mongodb mongodump  # Database backup

# File storage access
docker-compose exec minio mc ls  # MinIO storage
```

### Development and Troubleshooting

```bash
# View service logs
docker-compose logs -f transactor
docker-compose logs -f nginx
docker-compose logs -f huly-mcp

# Check service connectivity
docker-compose exec transactor ping mongodb
docker-compose exec nginx ping front

# Rebuild services after changes
docker-compose build <service_name>
docker-compose up -d --no-deps <service_name>
```

## Environment Configuration

### Key Environment Variables (.env)

**Core Configuration:**
- `HULY_VERSION`: Platform version (currently v0.6.501)
- `HOST_ADDRESS`: External host address (pm.oculair.ca)
- `SECURE`: SSL/TLS enablement (true/false)
- `HTTP_PORT`: External HTTP port (8101)
- `SECRET`: Internal service communication secret

**GitHub Integration:**
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`: OAuth authentication
- `GITHUB_APP_ID` / `GITHUB_APP_CLIENT_ID`: GitHub App integration
- `GITHUB_APP_PRIVATE_KEY`: GitHub App private key (RSA format)
- `GITHUB_WEBHOOK_SECRET`: Webhook security token

**MCP Server Configuration:**
- `HULY_MCP_EMAIL`: MCP server authentication email
- `HULY_MCP_PASSWORD`: MCP server authentication password
- `HULY_MCP_WORKSPACE`: Target workspace name

### Service URLs and Networking

Internal service communication uses Docker networking:
- `http://nginx:80` - Main proxy
- `http://account:3000` - Account service
- `http://transactor:3333` - Transaction service
- `mongodb://mongodb:27017` - Database connection
- `http://elastic:9200` - Elasticsearch
- `minio:9000` - Object storage

## MCP (Model Context Protocol) Integration

The `huly-mcp-server` provides AI integration capabilities:

### Available MCP Tools
- `huly_list_projects`: List all projects with descriptions
- `huly_list_issues`: List issues in specific projects
- `huly_create_issue`: Create new issues with priorities
- `huly_update_issue`: Update issue fields (title, description, status)
- `huly_create_project`: Create new projects with identifiers

### MCP Server Management
```bash
# Build MCP server
cd huly-mcp-server && docker build -t huly-mcp-server .

# Run MCP server (HTTP transport)
docker-compose up -d huly-mcp

# Test MCP server health
curl http://localhost:3457/health

# Test MCP tools
curl -X POST http://localhost:3457/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}'
```

## Security Considerations

- All services communicate through internal Docker networks
- External access is controlled through nginx proxy
- GitHub integration uses OAuth and webhook authentication
- MCP server requires authentication through Huly credentials
- Database and object storage have no external ports exposed

## Monitoring and Maintenance

### Log Management
```bash
# View aggregated logs
docker-compose logs

# Filter logs by service
docker-compose logs nginx transactor front

# Follow real-time logs
docker-compose logs -f --tail=100
```

### Resource Monitoring
```bash
# Check resource usage
docker stats

# Service-specific resource usage
docker-compose exec transactor ps aux
docker-compose exec mongodb mongostat
```

### Backup Procedures
```bash
# Database backup
docker-compose exec mongodb mongodump --out /backup

# File storage backup
docker-compose exec minio mc mirror /data /backup

# Configuration backup
cp .env .env.backup
cp docker-compose.yml docker-compose.yml.backup
```

## Troubleshooting

### Common Issues

**Service startup failures:**
- Check service logs: `docker-compose logs <service>`
- Verify environment variables in `.env`
- Ensure sufficient system resources (2+ vCPUs, 4GB+ RAM)

**Network connectivity issues:**
- Check nginx proxy configuration in `.huly.nginx`
- Verify internal service URLs in environment variables
- Test service-to-service connectivity

**GitHub integration problems:**
- Validate GitHub OAuth credentials
- Check webhook secret configuration
- Verify GitHub App permissions and installation

**MCP server connection issues:**
- Check MCP server logs: `docker-compose logs huly-mcp`
- Verify Huly credentials for MCP authentication
- Test MCP server health endpoint

### Version Compatibility

The deployment uses Huly version v0.6.501 across all services. The MCP server uses SDK version 0.6.500 for compatibility. Version alignment is critical for proper operation.

## Development Integration

### Huly Platform Development

For core platform development, refer to the main Huly repository structure in `hully/`:
- `models/`: Core data models and schemas
- `plugins/`: Feature plugins and extensions
- `services/`: Backend service implementations
- `server/`: Server-side logic and APIs

### Custom Service Development

When developing custom services:
1. Follow the existing service patterns in `docker-compose.yml`
2. Use internal Docker networking for service communication
3. Implement proper health checks and logging
4. Update nginx configuration for external access if needed

## External Dependencies

- **Node.js 18+**: Required for MCP server and development
- **Docker & Docker Compose**: Container orchestration
- **MongoDB**: Database backend
- **Elasticsearch**: Full-text search
- **MinIO**: Object storage
- **GitHub**: OAuth and repository integration
- **Nginx**: Reverse proxy and load balancing

## Git Worktree Development Workflow

### Overview

The Huly MCP Server project uses Git worktrees for parallel development, allowing simultaneous work on multiple features without context switching. Each Huly issue is developed in its own isolated worktree with automatic status tracking.

### 🚨 IMPORTANT: Use Claude Code Slash Commands

**DO NOT use the shell scripts directly.** Claude Code has custom slash commands that provide a more integrated and automated workflow. These commands handle all the necessary steps including status updates in Huly.

### Claude Code Slash Commands (PREFERRED METHOD)

The Huly MCP Server includes custom slash commands for Claude Code that streamline the worktree workflow:

#### Available Commands

- **`/worktree-create <issue> <type> [description]`** - Create a new worktree for a Huly issue
  - Example: `/worktree-create 38 feature search-functionality`
  - Automatically updates issue to "InProgress" status

- **`/worktree-pr`** - Create a pull request for the current branch
  - Automatically sets GitHub token and updates issue status

- **`/worktree-merge <issue>`** - Complete workflow by merging and cleaning up
  - Example: `/worktree-merge 38`
  - Merges locally to trigger status update hooks

- **`/huly-status <issue> <status>`** - Quick status update for any Huly issue
  - Example: `/huly-status 42 done`
  - Valid statuses: backlog, todo, in-progress, done, canceled

- **`/worktree-help`** - Show all available worktree commands with current status

These commands are stored in `.claude/commands/` and provide faster, more integrated workflow execution.

### Branch Naming Convention

All branches follow the format: `<type>/HULLY-<number>-<description>`

**Types:**
- `feature/` - New features or enhancements
- `bugfix/` - Bug fixes
- `hotfix/` - Critical production fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring

**Examples:**
- `feature/HULLY-8-search-filter-capabilities`
- `bugfix/HULLY-24-subissue-relationships`
- `docs/HULLY-5-setup-guides`

### Development Workflow (Using Slash Commands)

1. **Pick an Issue**: Select an issue from Huly backlog
2. **Create Worktree**: `/worktree-create <issue> <type> [description]`
3. **Develop**: Work in the isolated worktree (Claude automatically switches to it)
4. **Commit**: Use meaningful messages with issue references
5. **Test**: Thoroughly test all changes
6. **Create PR**: `/worktree-pr`
7. **After Review**: `/worktree-merge <issue>`

### Manual Scripts (For Reference Only)

⚠️ **Note**: These scripts exist but should NOT be used directly. Use the slash commands above instead.

The project includes helper scripts in the `huly-mcp-server/scripts/` directory:

```bash
# DO NOT USE THESE DIRECTLY - Use slash commands instead!
# ./scripts/worktree-create.sh <issue-number> <type> [description]
# ./scripts/worktree-list.sh
# ./scripts/worktree-status.sh
# ./scripts/worktree-remove.sh <issue-number>
```

### Commit Message Convention

Include Huly issue references in commit messages:
- `Fixes HULLY-XX` - Closes the issue when merged
- `Closes HULLY-XX` - Same as Fixes
- `Progresses HULLY-XX` - Updates progress on the issue
- `References HULLY-XX` - Mentions related issue

### Huly Integration Best Practices

**Status Updates:**
- Update Huly issue status ASAP at each stage
- Use these status transitions:
  - Backlog → In Progress (when branch created)
  - In Progress → In Review (when PR created)
  - In Review → Done (when merged)

**Parallel Development:**
- Multiple worktrees can be active simultaneously
- Each developer can work on different issues without conflicts
- Main branch stays clean for releases

**Testing:**
- Test in worktree before creating PR
- Run lint and typecheck commands
- Verify Docker container builds successfully


### Example Workflow Using Slash Commands

```bash
# 1. Create worktree for HULLY-8
/worktree-create 8 feature search-filter

# 2. Claude automatically switches to the worktree
# Develop your feature...

# 3. Commit with proper message
git add .
git commit -m "Add search and filter capabilities for issues

Implements comprehensive search functionality with filters
for status, priority, assignee, and date ranges.

Progresses HULLY-8"

# 4. Create PR when ready
/worktree-pr

# 5. After review and approval, merge and cleanup
/worktree-merge 8
```

The slash commands handle all the complex steps automatically, including:
- Creating the worktree in the correct location
- Updating Huly issue status to "In Progress"
- Setting up GitHub authentication for PR creation
- Cleaning up the worktree after merge
- Updating Huly issue status to "Done"

### Important Notes

- Always work in worktrees for feature development
- Never commit directly to main branch
- Keep worktrees clean - remove after merging
- Update Huly status immediately at each stage
- Use meaningful branch names and commit messages
- Test thoroughly before creating PRs