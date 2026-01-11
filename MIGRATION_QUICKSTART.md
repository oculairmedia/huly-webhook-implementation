# Huly v0.7 Migration Quick Start

## 🚀 Quick Commands

### Deploy Test Stack
```bash
cd /opt/stacks/huly-selfhost
sudo ./setup-test-stack.sh
```

### Access Test Stack
- **Web UI**: http://localhost:8201
- **MCP Server**: http://localhost:3557
- **Credentials**: Same as production

### Monitor Test Stack
```bash
cd /opt/stacks/huly-test-v07

# Watch logs
docker-compose logs -f

# Check status
docker-compose ps

# Resource usage
docker stats --no-stream
```

### Test MCP Server
```bash
# Health check
curl http://localhost:3557/health

# List tools
curl -X POST http://localhost:3557/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | jq
```

## 📊 Port Comparison

| Service | Production | Test Stack |
|---------|-----------|-----------|
| Web UI | 8101 | 8201 |
| MCP Server | 3457 | 3557 |
| REST API | 3458 | (not in test) |

## ✅ Validation Checklist

### Must Pass Before Cutover
- [ ] Test stack starts successfully
- [ ] Web UI accessible at http://localhost:8201
- [ ] Login works with production credentials
- [ ] All projects and issues visible
- [ ] GitHub integration functional
- [ ] MCP server responds to health checks
- [ ] No errors in logs after 1 hour
- [ ] Stable for 24+ hours

### Nice to Have
- [ ] Create test issue
- [ ] Update existing issue
- [ ] Search functionality works
- [ ] Performance acceptable
- [ ] Load test completed

## 🔧 Troubleshooting

### Test Stack Won't Start
```bash
# Check port conflicts
sudo netstat -tulpn | grep -E '8201|3557'

# Check Docker
docker ps -a | grep huly-test

# Restart
cd /opt/stacks/huly-test-v07
docker-compose down
docker-compose up -d
```

### MongoDB Issues
```bash
# Check MongoDB
docker-compose logs mongodb

# Restart MongoDB
docker-compose restart mongodb
```

### MCP Not Working
```bash
# Rebuild MCP
docker-compose build huly-mcp
docker-compose up -d huly-mcp

# Check logs
docker-compose logs huly-mcp
```

## 📁 Important Locations

- **Production**: `/opt/stacks/huly-selfhost/`
- **Test Stack**: `/opt/stacks/huly-test-v07/`
- **Backups**: `/opt/backups/huly-migration-20251119/`
- **Full Guide**: `/opt/stacks/huly-selfhost/MIGRATION_GUIDE_v07.md`

## ⚠️ Safety Notes

1. Production remains running during all testing
2. Test stack uses separate database volumes
3. Full backup created before any changes
4. Rollback procedure documented
5. No production data modified during testing

## 🎯 Next Steps

1. **Now**: Run `./setup-test-stack.sh`
2. **Then**: Test for 24-48 hours
3. **Finally**: Schedule production cutover

## 🆘 Emergency Contacts

If anything goes wrong:
1. Stop test stack: `cd /opt/stacks/huly-test-v07 && docker-compose down`
2. Production unaffected: `http://pm.oculair.ca:8101`
3. Restore from backup: `/opt/backups/huly-migration-20251119/`

---

**Quick Reference** | Version 1.0 | 2025-11-19
