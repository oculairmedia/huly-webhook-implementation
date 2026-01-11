-- CockroachDB Performance Indexes for Huly Self-Hosted
-- 
-- These indexes are REQUIRED for acceptable performance but are NOT created
-- by Huly's schema migration due to a bug in the PostgreSQL adapter.
-- 
-- The Huly schema definitions (server/postgres/src/schemas.ts) mark these 
-- fields as index:true but the createTable() function in utils.ts has a
-- bug where it checks `res.count > 0` which is always false for 
-- CREATE TABLE IF NOT EXISTS.
--
-- Run this script after initial Huly deployment or after any upgrade:
--   docker-compose exec cockroachdb cockroach sql --insecure < scripts/create-cockroachdb-indexes.sql
--
-- Performance impact (tested on real data):
--   - task queries: 4.4x faster (22ms -> 5ms)
--   - activity queries: 121x faster (242ms -> 2ms)  
--   - tx queries: 202x faster (405ms -> 2ms)
--
-- Created: 2026-01-11
-- Context: Deadlock investigation revealed full table scans on 300k+ row tables

-- Task table indexes (issues, projects, components, milestones)
CREATE INDEX IF NOT EXISTS idx_task_class ON task("workspaceId", _class, "modifiedOn" DESC);
CREATE INDEX IF NOT EXISTS idx_task_space ON task("workspaceId", space, _class, "modifiedOn" DESC);

-- Activity table indexes (comments, notifications, activity feed)
CREATE INDEX IF NOT EXISTS idx_activity_attached ON activity("workspaceId", "attachedTo", "modifiedOn" DESC);
CREATE INDEX IF NOT EXISTS idx_activity_class ON activity("workspaceId", _class, "modifiedOn" DESC);

-- Transaction log indexes (audit trail, undo/redo)
CREATE INDEX IF NOT EXISTS idx_tx_objectid ON tx("workspaceId", "objectId", "modifiedOn" DESC);
CREATE INDEX IF NOT EXISTS idx_tx_objectspace ON tx("workspaceId", "objectSpace", "modifiedOn" DESC);

-- GitHub sync indexes
CREATE INDEX IF NOT EXISTS idx_github_sync_attached ON github_sync("workspaceId", "attachedTo", "modifiedOn" DESC);

-- Notification indexes
CREATE INDEX IF NOT EXISTS idx_notification_dnc_attached ON notification_dnc("workspaceId", "attachedTo", "modifiedOn" DESC);

-- Collaborator indexes  
CREATE INDEX IF NOT EXISTS idx_collaborator_attached ON collaborator("workspaceId", "attachedTo", "modifiedOn" DESC);

-- Verify indexes were created
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
