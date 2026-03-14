-- CockroachDB performance indexes for Huly v0.7
-- Run against: cockroach sql --insecure < crdb-indexes.sql
-- These indexes are additive and idempotent (IF NOT EXISTS)

-- task: parent-child JSONB lookup (fixed transactor-1 crash loop, HULY-eo9)
CREATE INDEX IF NOT EXISTS idx_task_parent ON task ("workspaceId", (data#>>'{parents,parentId}'), _class) STORING (space, "modifiedBy", "modifiedOn", data);

-- activity: GROUP BY space count (1M+ rows, 3s → 700ms)
CREATE INDEX IF NOT EXISTS idx_activity_space ON activity ("workspaceId", space) STORING (_class, "modifiedOn");

-- notification_dnc: user + class filter (25s → sub-ms)
CREATE INDEX IF NOT EXISTS idx_notification_dnc_user ON notification_dnc ("workspaceId", "user", _class) STORING (data, space);

-- preference: space + class lookup (3.4s → 0.7ms)
CREATE INDEX IF NOT EXISTS idx_preference_space_class ON preference ("workspaceId", space, _class) STORING (data, "modifiedOn", "attachedTo");

-- tx: GROUP BY objectSpace (1.2M rows, 1.3s → 960ms)
CREATE INDEX IF NOT EXISTS idx_tx_workspace_objectspace ON tx ("workspaceId", "objectSpace") STORING ("modifiedOn", _class);

-- contact: personUuid JSONB lookup
CREATE INDEX IF NOT EXISTS idx_contact_person ON contact ("workspaceId", (data->>'personUuid'), _class) STORING (data);

-- notification: class + time ordered
CREATE INDEX IF NOT EXISTS idx_notification_class ON notification ("workspaceId", _class, "modifiedOn" DESC) STORING (space, data);

-- chunter: chat message retrieval by target and by class
CREATE INDEX IF NOT EXISTS idx_chunter_attached ON chunter ("workspaceId", "attachedTo", "modifiedOn" DESC) STORING (_class, space, data);
CREATE INDEX IF NOT EXISTS idx_chunter_class ON chunter ("workspaceId", _class, "modifiedOn" DESC) STORING (space, data);

-- collaborator: attachedTo lookups
CREATE INDEX IF NOT EXISTS idx_collaborator_attached ON collaborator ("workspaceId", "attachedTo", _class) STORING (data, space);
