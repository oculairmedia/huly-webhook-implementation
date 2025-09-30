# Huly Webhook Integration: Comprehensive Implementation Guide

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Requirements and Scope](#requirements-and-scope)
3. [Implementation Plan](#implementation-plan)
4. [Technical Specifications](#technical-specifications)
5. [Development Guidelines](#development-guidelines)
6. [Deployment and Configuration](#deployment-and-configuration)

## Current State Analysis

### Existing Webhook Implementation

Huly currently has a **standalone webhook service** (`huly-webhook`) that operates as a separate microservice:

**Architecture:**
- **Location**: `huly-webhook/` directory (separate from main Huly codebase)
- **Technology**: Node.js/Express.js standalone service
- **Database Monitoring**: MongoDB Change Streams
- **Event Detection**: Monitors MongoDB collections directly
- **Delivery**: HTTP POST requests with retry logic and dead letter queue

**Supported Events:**
- `issue.created`, `issue.updated`, `issue.deleted`
- `issue.status_changed`, `issue.assigned`
- `project.created`, `project.updated`, `project.archived`
- `comment.created`, `attachment.added`

**Key Features:**
- HMAC-SHA256 signature verification
- Configurable retry mechanisms with exponential backoff
- Event filtering by project, status, priority, assignee
- API key authentication
- Comprehensive logging and monitoring
- Health checks and statistics endpoints

### Huly Core Architecture Overview

Understanding Huly's architecture is crucial for implementing integrated webhooks:

#### Transaction System
Huly uses a sophisticated transaction system where all data changes are represented as transactions (`Tx`):

<augment_code_snippet path="hully source/packages/core/src/tx.ts" mode="EXCERPT">
````typescript
export interface Tx extends Doc {
  objectSpace: Ref<Space> // space where transaction will operate
}

export interface TxCreateDoc<T extends Doc> extends TxCUD<T> {
  attributes: Data<T>
}

export interface TxUpdateDoc<T extends Doc> extends TxCUD<T> {
  operations: DocumentUpdate<T>
}

export interface TxRemoveDoc<T extends Doc> extends TxCUD<T> {}
````
</augment_code_snippet>

#### Plugin System
Huly uses a modular plugin architecture with server-side plugins:

<augment_code_snippet path="hully source/server-plugins/chunter/src/index.ts" mode="EXCERPT">
````typescript
export default plugin(serverChunterId, {
  trigger: {
    ChunterTrigger: '' as Resource<TriggerFunc>,
    OnChatMessageRemoved: '' as Resource<TriggerFunc>,
    ChatNotificationsHandler: '' as Resource<TriggerFunc>
  },
  function: {
    CommentRemove: '' as Resource<ObjectDDParticipantFunc>,
    ChannelHTMLPresenter: '' as Resource<Presenter>
  }
})
````
</augment_code_snippet>

#### Trigger System
Triggers are the primary mechanism for responding to data changes:

<augment_code_snippet path="hully source/server-plugins/chunter-resources/src/index.ts" mode="EXCERPT">
````typescript
export async function ChunterTrigger (txes: TxCUD<Doc>[], control: TriggerControl): Promise<Tx[]> {
  const res: Tx[] = []
  for (const tx of txes) {
    if (
      tx._class === core.class.TxCreateDoc &&
      control.hierarchy.isDerived(tx.objectClass, chunter.class.ThreadMessage)
    ) {
      res.push(...(await OnThreadMessageCreated(ctx, tx, control)))
    }
  }
  return res
}
````
</augment_code_snippet>

### Existing Webhook-Related Code

#### LiveKit Webhook Handler
The `love` service already implements webhook receiving:

<augment_code_snippet path="hully source/services/love/src/main.ts" mode="EXCERPT">
````typescript
app.post('/webhook', async (req, res) => {
  try {
    const event = await receiver.receive(req.body, req.get('Authorization'))
    if (event.event === 'egress_ended' && event.egressInfo !== undefined) {
      // Process webhook event
      ctx.info('webhook event', { event: event.event, egress: event.egressInfo })
    }
  } catch (error) {
    ctx.error('webhook error', error)
  }
})
````
</augment_code_snippet>

#### Notification System
Huly has a comprehensive notification system that could be extended for webhooks:

<augment_code_snippet path="hully source/models/notification/src/index.ts" mode="EXCERPT">
````typescript
@Model(notification.class.NotificationProvider, core.class.Doc)
export class TNotificationProvider extends TDoc implements NotificationProvider {
  icon!: Asset
  label!: IntlString
  description!: IntlString
  defaultEnabled!: boolean
  order!: number
  presenter?: AnyComponent
}
````
</augment_code_snippet>

## Requirements and Scope

### Webhook Types and Use Cases

**Primary Use Case: Outgoing Webhooks**
- Send HTTP POST requests when Huly documents change
- Enable external system integration (CI/CD, project management tools, etc.)
- Real-time notifications for external applications

**Secondary Use Case: Incoming Webhooks** (Future consideration)
- Receive webhooks from external systems
- Create/update Huly documents based on external events

### Event Types and Triggers

**Document Classes to Monitor:**
- `tracker:class:Issue` - Issues and tasks
- `tracker:class:Project` - Projects and spaces
- `tracker:class:Component` - Project components
- `tracker:class:Milestone` - Project milestones
- `chunter:class:ChatMessage` - Comments and messages
- `attachment:class:Attachment` - File attachments

**Transaction Types:**
- `TxCreateDoc` - Document creation
- `TxUpdateDoc` - Document updates
- `TxRemoveDoc` - Document deletion

**Event Categories:**
```typescript
interface WebhookEventType {
  // Issue events
  'issue.created' | 'issue.updated' | 'issue.deleted' |
  'issue.status_changed' | 'issue.assigned' | 'issue.priority_changed' |
  
  // Project events  
  'project.created' | 'project.updated' | 'project.archived' |
  'project.member_added' | 'project.member_removed' |
  
  // Comment events
  'comment.created' | 'comment.updated' | 'comment.deleted' |
  
  // Attachment events
  'attachment.added' | 'attachment.removed'
}
```

### Payload Format Specification

**Standard Webhook Payload:**
```typescript
interface WebhookPayload {
  event: {
    id: string              // Unique event identifier
    type: WebhookEventType  // Event type
    timestamp: number       // Unix timestamp
    workspace: string       // Workspace identifier
  }
  data: {
    object: any            // The affected document
    changes?: FieldChange[] // For update events
    actor: {               // User who triggered the event
      id: string
      email: string
      name: string
    }
  }
  metadata: {
    version: string        // Webhook payload version
    delivery_id: string    // Unique delivery attempt ID
  }
}

interface FieldChange {
  field: string
  old_value: any
  new_value: any
}
```

### Authentication and Security Requirements

**Webhook Signature Verification:**
- HMAC-SHA256 signatures using configurable secrets
- Header: `X-Huly-Signature-256: sha256=<signature>`
- Payload signing for authenticity verification

**API Authentication:**
- API key authentication for webhook management endpoints
- Role-based access control (workspace admin required)
- Rate limiting for webhook management operations

**Security Features:**
- Configurable timeout values (default: 30 seconds)
- Retry limits to prevent abuse
- IP whitelisting support
- SSL/TLS requirement for webhook URLs

### Integration Points with Existing Huly Features

**Notification System Integration:**
- Extend existing notification providers
- Leverage notification preferences for webhook configuration
- Use notification templates for webhook payload formatting

**Permission System Integration:**
- Respect existing space permissions
- Only send webhooks for documents user has access to
- Workspace-level webhook configuration

**Activity System Integration:**
- Leverage activity messages for rich webhook content
- Use existing activity tracking for webhook events
- Integrate with activity-based filtering

## Implementation Plan

### Approach Comparison

#### Option 1: Standalone Service (Current Implementation)
**Pros:**
- Already implemented and functional
- Independent deployment and scaling
- No impact on Huly core performance
- Easy to maintain and update separately

**Cons:**
- Requires separate infrastructure
- MongoDB Change Streams dependency
- Potential data consistency issues
- Limited access to Huly's internal APIs

#### Option 2: Integrated Plugin (Recommended)
**Pros:**
- Native integration with Huly's transaction system
- Access to all Huly APIs and services
- Consistent with Huly's architecture
- Better performance and reliability
- Easier permission and security integration

**Cons:**
- Requires core Huly modifications
- More complex implementation
- Potential impact on core performance if not optimized

### Phase-by-Phase Implementation (Integrated Approach)

#### Phase 1: Core Webhook Infrastructure
**Duration:** 2-3 weeks

**Deliverables:**
1. **Webhook Models and Schema**
   - Create webhook configuration document model
   - Define webhook event model
   - Create delivery attempt tracking model

2. **Basic Trigger Implementation**
   - Create webhook server plugin structure
   - Implement basic transaction monitoring
   - Create webhook event generation logic

3. **Webhook Management API**
   - Create webhook CRUD endpoints
   - Implement authentication and authorization
   - Add basic validation and error handling

**Files to Create/Modify:**
```
server-plugins/webhook/
├── src/
│   ├── index.ts                 # Plugin definition
│   └── triggers.ts              # Webhook trigger functions
├── package.json
└── tsconfig.json

server-plugins/webhook-resources/
├── src/
│   ├── index.ts                 # Resource implementations
│   ├── api.ts                   # HTTP API endpoints
│   ├── delivery.ts              # Webhook delivery service
│   └── utils.ts                 # Utility functions
├── package.json
└── tsconfig.json

models/webhook/
├── src/
│   ├── index.ts                 # Model definitions
│   └── plugin.ts                # Plugin configuration
├── package.json
└── tsconfig.json
```

#### Phase 2: Event Processing and Delivery
**Duration:** 2-3 weeks

**Deliverables:**
1. **Event Processing Pipeline**
   - Implement event filtering and routing
   - Create payload transformation logic
   - Add event deduplication

2. **Delivery System**
   - HTTP client with retry logic
   - Signature generation and verification
   - Delivery status tracking and logging

3. **Configuration Management**
   - Webhook configuration UI components
   - Event type selection interface
   - Filter configuration options

#### Phase 3: Advanced Features and Optimization
**Duration:** 2-3 weeks

**Deliverables:**
1. **Advanced Filtering**
   - Field-level change detection
   - Custom filter expressions
   - Conditional webhook triggers

2. **Monitoring and Observability**
   - Delivery statistics and metrics
   - Health check endpoints
   - Comprehensive logging

3. **Performance Optimization**
   - Async processing optimization
   - Batch delivery support
   - Circuit breaker implementation

### Dependencies and Prerequisites

**Technical Dependencies:**
- Node.js 18+ (already required by Huly)
- TypeScript 4.9+ (already used by Huly)
- MongoDB with replica set (required for Change Streams in standalone service)

**Huly Dependencies:**
- `@hcengineering/core` - Core types and interfaces
- `@hcengineering/server-core` - Server plugin infrastructure
- `@hcengineering/model` - Model definition system
- `@hcengineering/platform` - Plugin system

**Development Dependencies:**
- Understanding of Huly's transaction system
- Familiarity with Huly's plugin architecture
- Knowledge of TypeScript decorators and metadata

### Migration Path from Standalone Service

**For Existing Users:**
1. **Parallel Operation Period**
   - Run both standalone and integrated services
   - Gradually migrate webhook configurations
   - Validate event delivery consistency

2. **Configuration Migration**
   - Export webhook configurations from standalone service
   - Import into integrated webhook system
   - Verify all settings and filters

3. **Cutover Process**
   - Stop standalone service
   - Monitor integrated service performance
   - Rollback plan if issues arise

**Migration Tools:**
```typescript
// Migration utility to transfer webhook configs
interface MigrationTool {
  exportStandaloneConfig(): Promise<WebhookConfig[]>
  importToIntegrated(configs: WebhookConfig[]): Promise<void>
  validateMigration(): Promise<MigrationReport>
}
```

This comprehensive implementation plan provides a clear roadmap for implementing webhook functionality that integrates seamlessly with Huly's existing architecture while maintaining the flexibility and features of the standalone service.

## Technical Specifications

### Database Models and Schema

#### Webhook Configuration Model

Following Huly's model patterns, create webhook configuration documents:

```typescript
// models/webhook/src/index.ts
import { Doc, Domain, Ref, Timestamp, AccountUuid } from '@hcengineering/core'
import { Model, Prop, TypeString, TypeBoolean, TypeNumber, TypeRef, ArrOf, TypeRecord, Hidden, Index } from '@hcengineering/model'
import { TDoc } from '@hcengineering/model-core'

export const DOMAIN_WEBHOOK = 'webhook' as Domain

@Model(webhook.class.WebhookConfig, core.class.Doc, DOMAIN_WEBHOOK)
export class TWebhookConfig extends TDoc implements WebhookConfig {
  @Prop(TypeString(), webhook.string.Name)
  @Index(IndexKind.FullText)
    name!: string

  @Prop(TypeString(), webhook.string.URL)
    url!: string

  @Prop(TypeString(), webhook.string.Secret)
  @Hidden()
    secret?: string

  @Prop(TypeBoolean(), webhook.string.Enabled)
  @Index(IndexKind.Indexed)
    enabled!: boolean

  @Prop(ArrOf(TypeString()), webhook.string.Events)
    events!: WebhookEventType[]

  @Prop(TypeRecord(), webhook.string.Headers)
    headers?: Record<string, string>

  @Prop(TypeNumber(), webhook.string.Timeout)
    timeout?: number

  @Prop(TypeNumber(), webhook.string.MaxRetries)
    maxRetries?: number

  @Prop(TypeRecord(), webhook.string.Filters)
    filters?: WebhookFilters

  @Prop(TypeTimestamp(), webhook.string.LastDelivery)
    lastDelivery?: Timestamp

  @Prop(TypeNumber(), webhook.string.DeliveryCount)
    deliveryCount!: number

  @Prop(TypeNumber(), webhook.string.FailureCount)
    failureCount!: number
}

interface WebhookFilters {
  projects?: Ref<Project>[]
  statuses?: string[]
  priorities?: number[]
  assignees?: Ref<Person>[]
  components?: Ref<Component>[]
  milestones?: Ref<Milestone>[]
}
```

#### Webhook Event Model

```typescript
@Model(webhook.class.WebhookEvent, core.class.Doc, DOMAIN_WEBHOOK)
export class TWebhookEvent extends TDoc implements WebhookEvent {
  @Prop(TypeString(), webhook.string.EventType)
  @Index(IndexKind.Indexed)
    eventType!: WebhookEventType

  @Prop(TypeRef(core.class.Doc), webhook.string.ObjectId)
  @Index(IndexKind.Indexed)
    objectId!: Ref<Doc>

  @Prop(TypeRef(core.class.Class), webhook.string.ObjectClass)
  @Index(IndexKind.Indexed)
    objectClass!: Ref<Class<Doc>>

  @Prop(TypeRef(webhook.class.WebhookConfig), webhook.string.WebhookConfig)
  @Index(IndexKind.Indexed)
    webhookConfig!: Ref<WebhookConfig>

  @Prop(TypeRecord(), webhook.string.Payload)
    payload!: WebhookPayload

  @Prop(TypeString(), webhook.string.Status)
  @Index(IndexKind.Indexed)
    status!: 'pending' | 'delivered' | 'failed' | 'retrying'

  @Prop(TypeNumber(), webhook.string.AttemptCount)
    attemptCount!: number

  @Prop(TypeTimestamp(), webhook.string.NextRetry)
    nextRetry?: Timestamp

  @Prop(TypeString(), webhook.string.LastError)
    lastError?: string

  @Prop(TypeString(), webhook.string.DeliveryId)
  @Index(IndexKind.Indexed)
    deliveryId!: string
}
```

#### Webhook Delivery Attempt Model

```typescript
@Model(webhook.class.WebhookDeliveryAttempt, core.class.Doc, DOMAIN_WEBHOOK)
export class TWebhookDeliveryAttempt extends TDoc implements WebhookDeliveryAttempt {
  @Prop(TypeRef(webhook.class.WebhookEvent), webhook.string.WebhookEvent)
  @Index(IndexKind.Indexed)
    webhookEvent!: Ref<WebhookEvent>

  @Prop(TypeNumber(), webhook.string.AttemptNumber)
    attemptNumber!: number

  @Prop(TypeTimestamp(), webhook.string.AttemptedAt)
  @Index(IndexKind.Indexed)
    attemptedAt!: Timestamp

  @Prop(TypeNumber(), webhook.string.ResponseStatus)
    responseStatus?: number

  @Prop(TypeString(), webhook.string.ResponseBody)
    responseBody?: string

  @Prop(TypeRecord(), webhook.string.ResponseHeaders)
    responseHeaders?: Record<string, string>

  @Prop(TypeNumber(), webhook.string.Duration)
    duration!: number

  @Prop(TypeString(), webhook.string.Error)
    error?: string

  @Prop(TypeBoolean(), webhook.string.Success)
  @Index(IndexKind.Indexed)
    success!: boolean
}
```

### API Endpoint Design

Following Huly's API patterns, implement RESTful webhook management endpoints:

#### Webhook Management Endpoints

```typescript
// server-plugins/webhook-resources/src/api.ts
import express from 'express'
import { TriggerControl } from '@hcengineering/server-core'
import { WebhookConfig, WebhookEvent } from '@hcengineering/webhook'

export function createWebhookAPI(control: TriggerControl): express.Router {
  const router = express.Router()

  // GET /api/v1/webhooks - List webhooks
  router.get('/', async (req, res) => {
    try {
      const webhooks = await control.findAll(control.ctx, webhook.class.WebhookConfig, {
        space: req.workspace
      })
      res.json({ webhooks })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // POST /api/v1/webhooks - Create webhook
  router.post('/', async (req, res) => {
    try {
      const { name, url, events, filters, secret, timeout, maxRetries } = req.body

      // Validate required fields
      if (!name || !url || !events?.length) {
        return res.status(400).json({
          error: 'Missing required fields: name, url, events'
        })
      }

      // Validate URL format
      try {
        new URL(url)
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' })
      }

      const webhookId = await control.txFactory.createDoc(
        webhook.class.WebhookConfig,
        req.workspace,
        {
          name,
          url,
          events,
          filters: filters || {},
          secret,
          timeout: timeout || 30000,
          maxRetries: maxRetries || 3,
          enabled: true,
          deliveryCount: 0,
          failureCount: 0,
          headers: req.body.headers || {}
        }
      )

      res.status(201).json({ id: webhookId })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // PUT /api/v1/webhooks/:id - Update webhook
  router.put('/:id', async (req, res) => {
    try {
      const webhookId = req.params.id as Ref<WebhookConfig>
      const updates = req.body

      // Validate webhook exists
      const webhook = await control.findAll(control.ctx, webhook.class.WebhookConfig, {
        _id: webhookId,
        space: req.workspace
      })

      if (webhook.length === 0) {
        return res.status(404).json({ error: 'Webhook not found' })
      }

      await control.txFactory.updateDoc(
        webhook.class.WebhookConfig,
        req.workspace,
        webhookId,
        updates
      )

      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // DELETE /api/v1/webhooks/:id - Delete webhook
  router.delete('/:id', async (req, res) => {
    try {
      const webhookId = req.params.id as Ref<WebhookConfig>

      await control.txFactory.removeDoc(
        webhook.class.WebhookConfig,
        req.workspace,
        webhookId
      )

      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // POST /api/v1/webhooks/:id/test - Test webhook delivery
  router.post('/:id/test', async (req, res) => {
    try {
      const webhookId = req.params.id as Ref<WebhookConfig>

      const webhook = await control.findAll(control.ctx, webhook.class.WebhookConfig, {
        _id: webhookId,
        space: req.workspace
      })

      if (webhook.length === 0) {
        return res.status(404).json({ error: 'Webhook not found' })
      }

      // Create test payload
      const testPayload = createTestPayload(req.workspace)

      // Attempt delivery
      const result = await deliverWebhook(webhook[0], testPayload, control)

      res.json({
        success: result.success,
        status: result.status,
        response: result.response,
        duration: result.duration
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // GET /api/v1/webhooks/:id/deliveries - Get delivery history
  router.get('/:id/deliveries', async (req, res) => {
    try {
      const webhookId = req.params.id as Ref<WebhookConfig>
      const limit = parseInt(req.query.limit as string) || 50
      const offset = parseInt(req.query.offset as string) || 0

      const deliveries = await control.findAll(
        control.ctx,
        webhook.class.WebhookDeliveryAttempt,
        {
          webhookEvent: { $in: await getWebhookEventIds(webhookId, control) }
        },
        {
          limit,
          skip: offset,
          sort: { attemptedAt: -1 }
        }
      )

      res.json({ deliveries, total: deliveries.length })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  return router
}
```

### Webhook Trigger Implementation

Following Huly's trigger patterns, implement webhook event generation:

```typescript
// server-plugins/webhook-resources/src/triggers.ts
import { TxCUD, Doc, TxCreateDoc, TxUpdateDoc, TxRemoveDoc, Ref } from '@hcengineering/core'
import { TriggerControl, TriggerFunc } from '@hcengineering/server-core'
import tracker from '@hcengineering/tracker'
import chunter from '@hcengineering/chunter'
import webhook from '@hcengineering/webhook'

/**
 * Main webhook trigger function - monitors all document changes
 */
export const WebhookTrigger: TriggerFunc = async (
  txes: TxCUD<Doc>[],
  control: TriggerControl
): Promise<Tx[]> => {
  const result: Tx[] = []

  // Get active webhooks for this workspace
  const activeWebhooks = await control.findAll(control.ctx, webhook.class.WebhookConfig, {
    space: control.workspace.uuid,
    enabled: true
  })

  if (activeWebhooks.length === 0) {
    return result
  }

  for (const tx of txes) {
    // Skip system transactions
    if (tx.modifiedBy === core.account.System) {
      continue
    }

    // Check if this document type is monitored
    if (!isMonitoredDocumentClass(tx.objectClass, control.hierarchy)) {
      continue
    }

    // Generate webhook events for matching webhooks
    for (const webhookConfig of activeWebhooks) {
      if (shouldTriggerWebhook(tx, webhookConfig, control)) {
        const webhookEvent = await createWebhookEvent(tx, webhookConfig, control)
        if (webhookEvent) {
          result.push(webhookEvent)
        }
      }
    }
  }

  return result
}

/**
 * Check if document class should trigger webhooks
 */
function isMonitoredDocumentClass(objectClass: Ref<Class<Doc>>, hierarchy: Hierarchy): boolean {
  const monitoredClasses = [
    tracker.class.Issue,
    tracker.class.Project,
    tracker.class.Component,
    tracker.class.Milestone,
    chunter.class.ChatMessage,
    attachment.class.Attachment
  ]

  return monitoredClasses.some(cls => hierarchy.isDerived(objectClass, cls))
}

/**
 * Determine if webhook should be triggered for this transaction
 */
function shouldTriggerWebhook(
  tx: TxCUD<Doc>,
  webhookConfig: WebhookConfig,
  control: TriggerControl
): boolean {
  // Check event type filter
  const eventType = getEventType(tx)
  if (!webhookConfig.events.includes(eventType)) {
    return false
  }

  // Apply additional filters
  return applyWebhookFilters(tx, webhookConfig, control)
}

/**
 * Apply webhook filters (project, status, etc.)
 */
async function applyWebhookFilters(
  tx: TxCUD<Doc>,
  webhookConfig: WebhookConfig,
  control: TriggerControl
): Promise<boolean> {
  const filters = webhookConfig.filters
  if (!filters) return true

  // Get the document being modified
  let doc: Doc | undefined

  if (tx._class === core.class.TxCreateDoc) {
    doc = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Doc>)
  } else if (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxRemoveDoc) {
    const docs = await control.findAll(control.ctx, tx.objectClass, { _id: tx.objectId })
    doc = docs[0]
  }

  if (!doc) return false

  // Apply project filter
  if (filters.projects?.length && !filters.projects.includes(doc.space)) {
    return false
  }

  // Apply issue-specific filters
  if (control.hierarchy.isDerived(tx.objectClass, tracker.class.Issue)) {
    const issue = doc as Issue

    // Status filter
    if (filters.statuses?.length && !filters.statuses.includes(issue.status)) {
      return false
    }

    // Priority filter
    if (filters.priorities?.length && !filters.priorities.includes(issue.priority)) {
      return false
    }

    // Assignee filter
    if (filters.assignees?.length && !filters.assignees.includes(issue.assignee)) {
      return false
    }

    // Component filter
    if (filters.components?.length && !filters.components.includes(issue.component)) {
      return false
    }

    // Milestone filter
    if (filters.milestones?.length && !filters.milestones.includes(issue.milestone)) {
      return false
    }
  }

  return true
}

/**
 * Create webhook event document
 */
async function createWebhookEvent(
  tx: TxCUD<Doc>,
  webhookConfig: WebhookConfig,
  control: TriggerControl
): Promise<Tx | null> {
  try {
    const eventType = getEventType(tx)
    const payload = await createWebhookPayload(tx, control)
    const deliveryId = generateDeliveryId()

    const webhookEventTx = control.txFactory.createTxCreateDoc(
      webhook.class.WebhookEvent,
      control.workspace.uuid,
      {
        eventType,
        objectId: tx.objectId,
        objectClass: tx.objectClass,
        webhookConfig: webhookConfig._id,
        payload,
        status: 'pending',
        attemptCount: 0,
        deliveryId
      }
    )

    // Schedule async delivery
    void scheduleWebhookDelivery(webhookEventTx.objectId, control)

    return webhookEventTx
  } catch (error) {
    control.ctx.error('Failed to create webhook event', { error, tx: tx._id })
    return null
  }
}

/**
 * Get event type from transaction
 */
function getEventType(tx: TxCUD<Doc>): WebhookEventType {
  const baseType = getDocumentTypeFromClass(tx.objectClass)

  switch (tx._class) {
    case core.class.TxCreateDoc:
      return `${baseType}.created` as WebhookEventType
    case core.class.TxUpdateDoc:
      return getUpdateEventType(tx as TxUpdateDoc<Doc>, baseType)
    case core.class.TxRemoveDoc:
      return `${baseType}.deleted` as WebhookEventType
    default:
      return `${baseType}.updated` as WebhookEventType
  }
}

/**
 * Get specific update event type based on changed fields
 */
function getUpdateEventType(tx: TxUpdateDoc<Doc>, baseType: string): WebhookEventType {
  const operations = tx.operations

  // Check for specific field changes
  if ('status' in operations) {
    return `${baseType}.status_changed` as WebhookEventType
  }
  if ('assignee' in operations) {
    return `${baseType}.assigned` as WebhookEventType
  }
  if ('priority' in operations) {
    return `${baseType}.priority_changed` as WebhookEventType
  }

  return `${baseType}.updated` as WebhookEventType
}

/**
 * Create webhook payload from transaction
 */
async function createWebhookPayload(
  tx: TxCUD<Doc>,
  control: TriggerControl
): Promise<WebhookPayload> {
  const actor = await getActor(tx.modifiedBy, control)
  const object = await getDocumentData(tx, control)
  const changes = getChanges(tx)

  return {
    event: {
      id: generateId(),
      type: getEventType(tx),
      timestamp: tx.modifiedOn,
      workspace: control.workspace.name
    },
    data: {
      object,
      changes,
      actor
    },
    metadata: {
      version: '1.0',
      delivery_id: generateDeliveryId()
    }
  }
}
```

### Webhook Delivery System

```typescript
// server-plugins/webhook-resources/src/delivery.ts
import fetch from 'node-fetch'
import crypto from 'crypto'
import { TriggerControl } from '@hcengineering/server-core'
import { WebhookConfig, WebhookEvent, WebhookPayload } from '@hcengineering/webhook'

/**
 * Webhook delivery service with retry logic
 */
export class WebhookDeliveryService {
  constructor(private control: TriggerControl) {}

  /**
   * Deliver webhook with retry logic
   */
  async deliverWebhook(
    webhookEvent: WebhookEvent,
    webhookConfig: WebhookConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now()
    let lastError: string | undefined

    for (let attempt = 1; attempt <= (webhookConfig.maxRetries || 3); attempt++) {
      try {
        const result = await this.attemptDelivery(
          webhookEvent,
          webhookConfig,
          attempt
        )

        // Record successful delivery
        await this.recordDeliveryAttempt(webhookEvent, attempt, result, true)
        await this.updateWebhookEventStatus(webhookEvent._id, 'delivered')
        await this.updateWebhookStats(webhookConfig._id, true)

        return result
      } catch (error) {
        lastError = error.message

        // Record failed attempt
        await this.recordDeliveryAttempt(
          webhookEvent,
          attempt,
          { status: 0, duration: Date.now() - startTime, error: error.message },
          false
        )

        // If not the last attempt, wait before retrying
        if (attempt < (webhookConfig.maxRetries || 3)) {
          const delay = this.calculateRetryDelay(attempt)
          await this.scheduleRetry(webhookEvent._id, delay)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    // All attempts failed
    await this.updateWebhookEventStatus(webhookEvent._id, 'failed', lastError)
    await this.updateWebhookStats(webhookConfig._id, false)

    throw new Error(`Webhook delivery failed after ${webhookConfig.maxRetries || 3} attempts: ${lastError}`)
  }

  /**
   * Attempt single webhook delivery
   */
  private async attemptDelivery(
    webhookEvent: WebhookEvent,
    webhookConfig: WebhookConfig,
    attempt: number
  ): Promise<DeliveryResult> {
    const startTime = Date.now()
    const payload = JSON.stringify(webhookEvent.payload)

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Huly-Webhook/1.0',
      'X-Huly-Event': webhookEvent.eventType,
      'X-Huly-Delivery': webhookEvent.deliveryId,
      'X-Huly-Attempt': attempt.toString(),
      ...webhookConfig.headers
    }

    // Add signature if secret is configured
    if (webhookConfig.secret) {
      const signature = this.generateSignature(payload, webhookConfig.secret)
      headers['X-Huly-Signature-256'] = signature
    }

    // Make HTTP request
    const response = await fetch(webhookConfig.url, {
      method: 'POST',
      headers,
      body: payload,
      timeout: webhookConfig.timeout || 30000
    })

    const duration = Date.now() - startTime
    const responseBody = await response.text()

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
      duration
    }
  }

  /**
   * Generate HMAC signature for webhook payload
   */
  private generateSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(payload)
    return `sha256=${hmac.digest('hex')}`
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000 // 1 second
    const maxDelay = 300000 // 5 minutes
    const delay = baseDelay * Math.pow(2, attempt - 1)
    return Math.min(delay, maxDelay)
  }

  /**
   * Record delivery attempt in database
   */
  private async recordDeliveryAttempt(
    webhookEvent: WebhookEvent,
    attemptNumber: number,
    result: Partial<DeliveryResult>,
    success: boolean
  ): Promise<void> {
    await this.control.txFactory.createDoc(
      webhook.class.WebhookDeliveryAttempt,
      this.control.workspace.uuid,
      {
        webhookEvent: webhookEvent._id,
        attemptNumber,
        attemptedAt: Date.now(),
        responseStatus: result.status,
        responseBody: result.body,
        responseHeaders: result.headers,
        duration: result.duration || 0,
        error: result.error,
        success
      }
    )
  }

  /**
   * Update webhook event status
   */
  private async updateWebhookEventStatus(
    eventId: Ref<WebhookEvent>,
    status: 'pending' | 'delivered' | 'failed' | 'retrying',
    error?: string
  ): Promise<void> {
    const updates: any = { status }
    if (error) {
      updates.lastError = error
    }

    await this.control.txFactory.updateDoc(
      webhook.class.WebhookEvent,
      this.control.workspace.uuid,
      eventId,
      updates
    )
  }

  /**
   * Update webhook configuration statistics
   */
  private async updateWebhookStats(
    webhookId: Ref<WebhookConfig>,
    success: boolean
  ): Promise<void> {
    const updates: any = {
      lastDelivery: Date.now(),
      $inc: {
        deliveryCount: 1
      }
    }

    if (!success) {
      updates.$inc.failureCount = 1
    }

    await this.control.txFactory.updateDoc(
      webhook.class.WebhookConfig,
      this.control.workspace.uuid,
      webhookId,
      updates
    )
  }

  /**
   * Schedule webhook retry
   */
  private async scheduleRetry(eventId: Ref<WebhookEvent>, delay: number): Promise<void> {
    const nextRetry = Date.now() + delay

    await this.control.txFactory.updateDoc(
      webhook.class.WebhookEvent,
      this.control.workspace.uuid,
      eventId,
      {
        status: 'retrying',
        nextRetry,
        $inc: { attemptCount: 1 }
      }
    )
  }
}

interface DeliveryResult {
  status: number
  headers?: Record<string, string>
  body?: string
  duration: number
  error?: string
}

/**
 * Schedule async webhook delivery
 */
export async function scheduleWebhookDelivery(
  eventId: Ref<WebhookEvent>,
  control: TriggerControl
): Promise<void> {
  // Use Huly's queue system if available, otherwise process immediately
  if (control.queue) {
    await control.queue.add('webhook-delivery', { eventId })
  } else {
    // Process immediately in background
    void processWebhookDelivery(eventId, control)
  }
}

/**
 * Process webhook delivery
 */
async function processWebhookDelivery(
  eventId: Ref<WebhookEvent>,
  control: TriggerControl
): Promise<void> {
  try {
    // Get webhook event
    const events = await control.findAll(control.ctx, webhook.class.WebhookEvent, {
      _id: eventId
    })

    if (events.length === 0) {
      control.ctx.error('Webhook event not found', { eventId })
      return
    }

    const webhookEvent = events[0]

    // Get webhook configuration
    const configs = await control.findAll(control.ctx, webhook.class.WebhookConfig, {
      _id: webhookEvent.webhookConfig
    })

    if (configs.length === 0) {
      control.ctx.error('Webhook configuration not found', {
        configId: webhookEvent.webhookConfig
      })
      return
    }

    const webhookConfig = configs[0]

    // Check if webhook is still enabled
    if (!webhookConfig.enabled) {
      control.ctx.info('Webhook disabled, skipping delivery', {
        configId: webhookConfig._id
      })
      return
    }

    // Deliver webhook
    const deliveryService = new WebhookDeliveryService(control)
    await deliveryService.deliverWebhook(webhookEvent, webhookConfig)

    control.ctx.info('Webhook delivered successfully', {
      eventId,
      configId: webhookConfig._id,
      url: webhookConfig.url
    })
  } catch (error) {
    control.ctx.error('Webhook delivery failed', {
      eventId,
      error: error.message
    })
  }
}
```

## Development Guidelines

### Understanding Huly's Architecture

#### Core Concepts for Webhook Development

**1. Document-Centric Architecture**
Huly is built around documents (`Doc`) that represent all entities (issues, projects, comments, etc.):

<augment_code_snippet path="hully source/models/core/src/core.ts" mode="EXCERPT">
````typescript
@Model(core.class.Doc, core.class.Obj)
export class TDoc extends TObj implements Doc {
  @Prop(TypeRef(core.class.Doc), core.string.Id)
  @Hidden()
    _id!: Ref<this>

  @Prop(TypeRef(core.class.Space), core.string.Space)
  @Index(IndexKind.Indexed)
  @Hidden()
    space!: Ref<Space>

  @Prop(TypeTimestamp(), core.string.ModifiedDate)
  @Index(IndexKind.Indexed)
    modifiedOn!: Timestamp

  @Prop(TypePersonId(), core.string.ModifiedBy)
  @Index(IndexKind.Indexed)
    modifiedBy!: PersonId
}
````
</augment_code_snippet>

**2. Transaction System**
All changes in Huly are represented as transactions that modify documents:

<augment_code_snippet path="hully source/models/core/src/tx.ts" mode="EXCERPT">
````typescript
@Model(core.class.TxCreateDoc, core.class.TxCUD)
export class TTxCreateDoc<T extends Doc> extends TTxCUD<T> implements TxCreateDoc<T> {
  @Prop(TypeRecord(), core.string.Attributes)
    attributes!: Data<T>
}

@Model(core.class.TxUpdateDoc, core.class.TxCUD)
export class TTxUpdateDoc<T extends Doc> extends TTxCUD<T> implements TxUpdateDoc<T> {
  @Prop(TypeRecord(), core.string.Operations)
    operations!: DocumentUpdate<T>
}
````
</augment_code_snippet>

**3. Plugin System Structure**
Huly plugins follow a specific structure with separate definition and implementation packages:

```
server-plugins/
├── webhook/                    # Plugin definition
│   ├── src/
│   │   ├── index.ts           # Plugin interface definition
│   │   └── plugin.ts          # Plugin configuration
│   └── package.json
└── webhook-resources/          # Plugin implementation
    ├── src/
    │   ├── index.ts           # Resource implementations
    │   ├── triggers.ts        # Trigger functions
    │   ├── api.ts            # HTTP endpoints
    │   └── delivery.ts       # Webhook delivery logic
    └── package.json
```

#### Plugin Development Patterns

**1. Plugin Definition Pattern**
Create the plugin interface following Huly conventions:

```typescript
// server-plugins/webhook/src/index.ts
import type { Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import { TriggerFunc } from '@hcengineering/server-core'

export const serverWebhookId = 'server-webhook' as Plugin

export default plugin(serverWebhookId, {
  trigger: {
    WebhookTrigger: '' as Resource<TriggerFunc>,
    WebhookDeliveryTrigger: '' as Resource<TriggerFunc>
  },
  function: {
    WebhookDeliveryService: '' as Resource<any>,
    WebhookEventProcessor: '' as Resource<any>
  }
})
```

**2. Model Definition Pattern**
Define data models using Huly's decorator system:

```typescript
// models/webhook/src/index.ts
import { Builder } from '@hcengineering/model'
import core from '@hcengineering/core'
import serverCore from '@hcengineering/server-core'
import webhook from './plugin'

export function createModel(builder: Builder): void {
  // Create model classes
  builder.createModel(
    TWebhookConfig,
    TWebhookEvent,
    TWebhookDeliveryAttempt
  )

  // Register triggers
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: webhook.trigger.WebhookTrigger,
    txMatch: {
      objectClass: {
        $in: [
          'tracker:class:Issue',
          'tracker:class:Project',
          'chunter:class:ChatMessage'
        ]
      }
    },
    isAsync: true
  })

  // Register API endpoints if needed
  builder.mixin(webhook.class.WebhookConfig, core.class.Class, serverCore.mixin.ServerPlugin, {
    endpoints: [
      { path: '/api/v1/webhooks', handler: webhook.function.WebhookAPI }
    ]
  })
}
```

**3. Trigger Implementation Pattern**
Implement triggers following established patterns:

```typescript
// server-plugins/webhook-resources/src/triggers.ts
import { TxCUD, Doc } from '@hcengineering/core'
import { TriggerControl, TriggerFunc } from '@hcengineering/server-core'

export const WebhookTrigger: TriggerFunc = async (
  txes: TxCUD<Doc>[],
  control: TriggerControl
): Promise<Tx[]> => {
  const result: Tx[] = []

  // Process each transaction
  for (const tx of txes) {
    // Filter relevant transactions
    if (!isRelevantTransaction(tx, control)) {
      continue
    }

    // Generate webhook events
    const webhookTx = await createWebhookEvent(tx, control)
    if (webhookTx) {
      result.push(webhookTx)
    }
  }

  return result
}

// Helper function following Huly patterns
function isRelevantTransaction(tx: TxCUD<Doc>, control: TriggerControl): boolean {
  // Skip system transactions
  if (tx.modifiedBy === core.account.System) {
    return false
  }

  // Check document class hierarchy
  return control.hierarchy.isDerived(tx.objectClass, tracker.class.Issue) ||
         control.hierarchy.isDerived(tx.objectClass, tracker.class.Project)
}
```

### Huly Development Conventions

#### Naming Conventions

**1. Plugin Naming**
- Plugin IDs: `server-{feature}` (e.g., `server-webhook`)
- Resource packages: `{feature}-resources` (e.g., `webhook-resources`)
- Model packages: `model-{feature}` (e.g., `model-webhook`)

**2. Class Naming**
- Model classes: `T{ClassName}` (e.g., `TWebhookConfig`)
- Interface implementations: `{ClassName}Impl`
- Service classes: `{Feature}Service` (e.g., `WebhookDeliveryService`)

**3. Function Naming**
- Trigger functions: `{Feature}Trigger` (e.g., `WebhookTrigger`)
- API handlers: `handle{Action}` (e.g., `handleCreateWebhook`)
- Utility functions: camelCase with descriptive names

#### Code Organization Patterns

**1. File Structure**
```typescript
// Each file should have a single primary responsibility
src/
├── index.ts          # Main exports and plugin definition
├── triggers.ts       # Trigger function implementations
├── api.ts           # HTTP API endpoints
├── services/        # Business logic services
│   ├── delivery.ts  # Webhook delivery service
│   └── validation.ts # Input validation
├── utils/           # Utility functions
│   ├── crypto.ts    # Cryptographic functions
│   └── helpers.ts   # General helpers
└── types.ts         # Type definitions
```

**2. Import Organization**
```typescript
// Follow this import order:
// 1. Node.js built-ins
import crypto from 'crypto'
import { URL } from 'url'

// 2. External dependencies
import fetch from 'node-fetch'

// 3. Huly core packages
import { Doc, Ref, TxCUD } from '@hcengineering/core'
import { TriggerControl } from '@hcengineering/server-core'

// 4. Huly plugin packages
import tracker from '@hcengineering/tracker'
import chunter from '@hcengineering/chunter'

// 5. Local imports
import webhook from './plugin'
import { WebhookConfig, WebhookEvent } from './types'
```

#### Error Handling Patterns

**1. Trigger Error Handling**
```typescript
export const WebhookTrigger: TriggerFunc = async (
  txes: TxCUD<Doc>[],
  control: TriggerControl
): Promise<Tx[]> => {
  const result: Tx[] = []

  for (const tx of txes) {
    try {
      const webhookTx = await processTransaction(tx, control)
      if (webhookTx) {
        result.push(webhookTx)
      }
    } catch (error) {
      // Log error but don't fail the entire trigger
      control.ctx.error('Failed to process webhook for transaction', {
        txId: tx._id,
        error: error.message,
        objectClass: tx.objectClass
      })
    }
  }

  return result
}
```

**2. API Error Handling**
```typescript
router.post('/webhooks', async (req, res) => {
  try {
    // Validate input
    const validation = validateWebhookConfig(req.body)
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      })
    }

    // Process request
    const result = await createWebhook(req.body, control)
    res.status(201).json(result)
  } catch (error) {
    // Log error with context
    control.ctx.error('Failed to create webhook', {
      error: error.message,
      body: req.body,
      user: req.user
    })

    // Return appropriate error response
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message })
    } else if (error instanceof AuthorizationError) {
      res.status(403).json({ error: 'Insufficient permissions' })
    } else {
      res.status(500).json({ error: 'Internal server error' })
    }
  }
})
```

#### Testing Patterns

**1. Unit Test Structure**
```typescript
// __tests__/webhook-trigger.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals'
import { TxCreateDoc } from '@hcengineering/core'
import { createMockTriggerControl } from '@hcengineering/server-test-utils'
import { WebhookTrigger } from '../src/triggers'

describe('WebhookTrigger', () => {
  let control: TriggerControl

  beforeEach(() => {
    control = createMockTriggerControl()
  })

  it('should create webhook event for issue creation', async () => {
    // Arrange
    const createTx: TxCreateDoc<Issue> = {
      _class: core.class.TxCreateDoc,
      objectClass: tracker.class.Issue,
      objectId: 'issue-1' as Ref<Issue>,
      attributes: {
        title: 'Test Issue',
        description: 'Test Description'
      }
      // ... other required fields
    }

    // Act
    const result = await WebhookTrigger([createTx], control)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0]._class).toBe(core.class.TxCreateDoc)
    expect(result[0].objectClass).toBe(webhook.class.WebhookEvent)
  })

  it('should skip system transactions', async () => {
    // Test implementation
  })

  it('should apply webhook filters correctly', async () => {
    // Test implementation
  })
})
```

**2. Integration Test Pattern**
```typescript
// __tests__/webhook-api.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { TestServer } from '@hcengineering/server-test-utils'
import { WebhookAPI } from '../src/api'

describe('Webhook API Integration', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await TestServer.create()
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('should create webhook via API', async () => {
    const response = await server.request
      .post('/api/v1/webhooks')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['issue.created']
      })

    expect(response.status).toBe(201)
    expect(response.body).toHaveProperty('id')
  })
})
```

### Code Examples and References

#### Existing Trigger Examples

**1. Issue Tracking Triggers**
Reference the tracker plugin for issue-related trigger patterns:

<augment_code_snippet path="hully source/server-plugins/tracker-resources/src/index.ts" mode="EXCERPT">
````typescript
export async function OnIssueUpdate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const actualTx of txes) {
    if (
      actualTx._class === core.class.TxCreateDoc ||
      actualTx._class === core.class.TxUpdateDoc ||
      actualTx._class === core.class.TxRemoveDoc
    ) {
      const cud = actualTx as TxCUD<TimeSpendReport>
      if (cud.objectClass === tracker.class.TimeSpendReport) {
        result.push(...(await doTimeReportUpdate(cud, control)))
      }
    }
  }
  return result
}
````
</augment_code_snippet>

**2. Notification System Integration**
Reference notification triggers for user notification patterns:

<augment_code_snippet path="hully source/server-plugins/chunter-resources/src/index.ts" mode="EXCERPT">
````typescript
async function ChatNotificationsHandler (txes: TxCUD<Doc>[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    const actualTx = tx as TxCreateDoc<ChatMessage>

    if (actualTx._class !== core.class.TxCreateDoc) {
      continue
    }

    const chatMessage = TxProcessor.createDoc2Doc(actualTx)
    result.push(...(await createCollaboratorNotifications(control.ctx, tx, control, [chatMessage])))
  }
  return result
}
````
</augment_code_snippet>

**3. Document Processing Patterns**
Reference existing document processing for data transformation:

<augment_code_snippet path="hully source/server-plugins/recruit-resources/src/index.ts" mode="EXCERPT">
````typescript
async function handleVacancyUpdate (control: TriggerControl, cud: TxCUD<Doc>, res: Tx[]): Promise<void> {
  const updateTx = cud as TxUpdateDoc<Vacancy>
  if (updateTx.operations.company !== undefined) {
    const txes = (
      await control.findAll(control.ctx, core.class.TxCUD, {
        objectId: updateTx.objectId
      })
    ).filter((it) => it._id !== updateTx._id)
    const vacancy = TxProcessor.buildDoc2Doc<Vacancy>(txes)
    // Process the document...
  }
}
````
</augment_code_snippet>

This comprehensive development guide provides the foundation for implementing webhook functionality that follows Huly's established patterns and conventions while maintaining code quality and consistency with the existing codebase.

## Deployment and Configuration

### Environment Configuration

#### Required Environment Variables

```bash
# Webhook Service Configuration
WEBHOOK_ENABLED=true
WEBHOOK_MAX_RETRIES=3
WEBHOOK_TIMEOUT=30000
WEBHOOK_RATE_LIMIT=100
WEBHOOK_SIGNATURE_ALGORITHM=sha256

# Security Configuration
WEBHOOK_SECRET_KEY=your-webhook-secret-key
WEBHOOK_API_KEY=your-api-key
WEBHOOK_ALLOWED_IPS=192.168.1.0/24,10.0.0.0/8

# Performance Configuration
WEBHOOK_BATCH_SIZE=10
WEBHOOK_QUEUE_SIZE=1000
WEBHOOK_WORKER_THREADS=4

# Monitoring Configuration
WEBHOOK_METRICS_ENABLED=true
WEBHOOK_LOG_LEVEL=info
WEBHOOK_HEALTH_CHECK_INTERVAL=30000
```

#### Docker Configuration

**Dockerfile for Integrated Webhook Service:**
```dockerfile
# Use Huly's base image or Node.js
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server-plugins/webhook*/package.json ./server-plugins/webhook/
COPY server-plugins/webhook-resources/package.json ./server-plugins/webhook-resources/

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application
CMD ["npm", "start"]
```

**Docker Compose Integration:**
```yaml
# docker-compose.yml
version: '3.8'

services:
  huly-server:
    image: huly/huly:latest
    environment:
      - WEBHOOK_ENABLED=true
      - WEBHOOK_SECRET_KEY=${WEBHOOK_SECRET_KEY}
      - WEBHOOK_API_KEY=${WEBHOOK_API_KEY}
    volumes:
      - ./server-plugins/webhook:/app/server-plugins/webhook
      - ./server-plugins/webhook-resources:/app/server-plugins/webhook-resources
    networks:
      - huly-network
    depends_on:
      - mongodb

  mongodb:
    image: mongo:6.0
    command: mongod --replSet rs0
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=password
    volumes:
      - mongodb_data:/data/db
    networks:
      - huly-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    networks:
      - huly-network
    depends_on:
      - huly-server

networks:
  huly-network:
    driver: bridge

volumes:
  mongodb_data:
```

### Production Deployment Checklist

#### Security Hardening

**1. SSL/TLS Configuration**
```nginx
# nginx.conf
server {
    listen 443 ssl http2;
    server_name your-huly-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;

    # Webhook API proxy
    location /api/v1/webhooks {
        proxy_pass http://huly-server:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Rate limiting
        limit_req zone=webhook_api burst=10 nodelay;

        # Security headers
        add_header X-Content-Type-Options nosniff;
        add_header X-Frame-Options DENY;
        add_header X-XSS-Protection "1; mode=block";
    }
}

# Rate limiting configuration
http {
    limit_req_zone $binary_remote_addr zone=webhook_api:10m rate=10r/m;
}
```

**2. Firewall Configuration**
```bash
# UFW firewall rules
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw deny 3000/tcp   # Block direct access to Huly server
sudo ufw enable
```

**3. Secret Management**
```bash
# Use environment-specific secret files
# .env.production
WEBHOOK_SECRET_KEY=$(openssl rand -hex 32)
WEBHOOK_API_KEY=$(openssl rand -hex 32)

# Or use external secret management
# AWS Secrets Manager, HashiCorp Vault, etc.
```

#### Monitoring and Observability

**1. Health Check Endpoints**
```typescript
// Health check implementation
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    uptime: process.uptime(),
    checks: {
      database: await checkDatabaseConnection(),
      webhooks: await checkWebhookService(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
  }

  const isHealthy = Object.values(health.checks).every(check =>
    typeof check === 'object' ? check.status === 'ok' : true
  )

  res.status(isHealthy ? 200 : 503).json(health)
})
```

**2. Metrics Collection**
```typescript
// Prometheus metrics
import { register, Counter, Histogram, Gauge } from 'prom-client'

const webhookDeliveries = new Counter({
  name: 'webhook_deliveries_total',
  help: 'Total number of webhook deliveries',
  labelNames: ['status', 'webhook_id']
})

const webhookDuration = new Histogram({
  name: 'webhook_delivery_duration_seconds',
  help: 'Webhook delivery duration',
  buckets: [0.1, 0.5, 1, 2, 5, 10]
})

const activeWebhooks = new Gauge({
  name: 'active_webhooks_total',
  help: 'Number of active webhooks'
})

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(register.metrics())
})
```

**3. Logging Configuration**
```typescript
// Structured logging with Winston
import winston from 'winston'

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'huly-webhook' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
})

// Log webhook events
logger.info('Webhook delivered', {
  webhookId: webhook._id,
  url: webhook.url,
  eventType: event.type,
  duration: deliveryTime,
  status: response.status
})
```

### Performance Optimization

#### Database Optimization

**1. Index Strategy**
```typescript
// Ensure proper indexes for webhook queries
const indexes = [
  { 'webhook.class.WebhookConfig': { space: 1, enabled: 1 } },
  { 'webhook.class.WebhookEvent': { status: 1, nextRetry: 1 } },
  { 'webhook.class.WebhookEvent': { webhookConfig: 1, createdOn: -1 } },
  { 'webhook.class.WebhookDeliveryAttempt': { webhookEvent: 1, attemptedAt: -1 } }
]
```

**2. Query Optimization**
```typescript
// Efficient webhook lookup
async function getActiveWebhooks(control: TriggerControl): Promise<WebhookConfig[]> {
  return await control.findAll(
    control.ctx,
    webhook.class.WebhookConfig,
    {
      space: control.workspace.uuid,
      enabled: true
    },
    {
      projection: {
        _id: 1,
        url: 1,
        events: 1,
        filters: 1,
        secret: 1,
        timeout: 1,
        maxRetries: 1
      }
    }
  )
}
```

#### Async Processing

**1. Queue Configuration**
```typescript
// Use Huly's queue system for webhook processing
if (control.queue) {
  await control.queue.add('webhook-delivery', {
    eventId: webhookEvent._id,
    priority: getPriority(webhookEvent.eventType),
    delay: 0,
    attempts: webhookConfig.maxRetries || 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  })
}
```

**2. Batch Processing**
```typescript
// Process webhooks in batches
async function processPendingWebhooks(control: TriggerControl): Promise<void> {
  const batchSize = parseInt(process.env.WEBHOOK_BATCH_SIZE || '10')

  const pendingEvents = await control.findAll(
    control.ctx,
    webhook.class.WebhookEvent,
    {
      status: 'pending',
      $or: [
        { nextRetry: { $exists: false } },
        { nextRetry: { $lte: Date.now() } }
      ]
    },
    { limit: batchSize, sort: { createdOn: 1 } }
  )

  const deliveryPromises = pendingEvents.map(event =>
    processWebhookDelivery(event._id, control)
  )

  await Promise.allSettled(deliveryPromises)
}
```

### Troubleshooting Guide

#### Common Issues and Solutions

**1. Webhook Delivery Failures**
```bash
# Check webhook configuration
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/v1/webhooks/{webhook-id}

# Test webhook endpoint manually
curl -X POST https://your-webhook-endpoint.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "payload"}'

# Check delivery logs
docker logs huly-server | grep "webhook"
```

**2. Performance Issues**
```bash
# Monitor webhook metrics
curl http://localhost:3000/metrics | grep webhook

# Check database performance
db.webhook_events.find({status: "pending"}).explain("executionStats")

# Monitor system resources
docker stats huly-server
```

**3. Configuration Issues**
```bash
# Validate environment variables
env | grep WEBHOOK

# Check plugin loading
curl http://localhost:3000/api/health | jq '.checks.webhooks'

# Verify database connectivity
mongosh --eval "db.adminCommand('ping')"
```

#### Debug Mode

**Enable Debug Logging:**
```bash
# Set debug environment
export LOG_LEVEL=debug
export WEBHOOK_DEBUG=true

# Or in Docker Compose
environment:
  - LOG_LEVEL=debug
  - WEBHOOK_DEBUG=true
```

**Debug Webhook Processing:**
```typescript
// Add debug logging to triggers
export const WebhookTrigger: TriggerFunc = async (txes, control) => {
  if (process.env.WEBHOOK_DEBUG === 'true') {
    control.ctx.info('Processing webhook trigger', {
      transactionCount: txes.length,
      transactions: txes.map(tx => ({
        id: tx._id,
        class: tx._class,
        objectClass: tx.objectClass
      }))
    })
  }

  // ... rest of implementation
}
```

This comprehensive deployment and configuration guide ensures that webhook functionality can be successfully deployed, monitored, and maintained in production environments while following security best practices and performance optimization techniques.

## Summary and Next Steps

### Implementation Summary

This comprehensive guide provides everything needed to implement webhook functionality in Huly, covering both the existing standalone service approach and a new integrated plugin approach. The documentation includes:

**✅ Complete Architecture Analysis**
- Detailed analysis of existing webhook service
- Deep dive into Huly's core architecture (transactions, plugins, triggers)
- Integration points with notification and activity systems

**✅ Implementation Roadmap**
- Phase-by-phase implementation plan
- Database models following Huly patterns
- API endpoints with proper authentication
- Webhook delivery system with retry logic

**✅ Developer Guidelines**
- Huly development patterns and conventions
- Plugin development best practices
- Code examples from existing implementations
- Testing strategies and patterns

**✅ Production Deployment**
- Security hardening checklist
- Monitoring and observability setup
- Performance optimization techniques
- Troubleshooting guide

### Recommended Implementation Path

**For New Implementations:**
1. **Start with Integrated Plugin Approach** - Follow the plugin development guidelines to create a native Huly webhook system
2. **Implement in Phases** - Begin with Phase 1 (core infrastructure) and gradually add advanced features
3. **Follow Huly Patterns** - Use the provided code examples and conventions to maintain consistency

**For Existing Standalone Service Users:**
1. **Continue with Standalone Service** - The existing service is functional and well-tested
2. **Plan Migration** - Use the migration path outlined in this guide when ready to integrate
3. **Hybrid Approach** - Run both systems in parallel during transition

### Key Benefits of Integrated Approach

**Technical Benefits:**
- Native integration with Huly's transaction system
- Better performance and reliability
- Access to all Huly APIs and services
- Consistent error handling and logging

**Operational Benefits:**
- Single deployment and maintenance
- Unified monitoring and observability
- Better security integration
- Simplified configuration management

### Development Resources

**Essential Reading for Huly Development:**
- Study existing server plugins in `server-plugins/` directory
- Review trigger implementations in `server-plugins/*-resources/src/`
- Examine model definitions in `models/` directory
- Understand transaction processing in `packages/core/src/`

**Code References:**
- **Trigger Patterns**: `server-plugins/chunter-resources/src/index.ts`
- **Model Definitions**: `models/notification/src/index.ts`
- **API Patterns**: `services/*/src/server.ts`
- **Plugin Structure**: `server-plugins/*/src/index.ts`

**Testing Resources:**
- Use existing test patterns from `server-plugins/*/src/__tests__/`
- Follow integration test examples in `tests/`
- Implement health checks similar to existing services

### Future Enhancements

**Potential Extensions:**
1. **Incoming Webhooks** - Receive webhooks from external systems
2. **Webhook Templates** - Customizable payload formats
3. **Advanced Filtering** - Complex event filtering expressions
4. **Webhook Marketplace** - Pre-built integrations for popular services
5. **Real-time Dashboard** - Live webhook monitoring interface

**Integration Opportunities:**
1. **CI/CD Integration** - Trigger builds on issue status changes
2. **External Project Management** - Sync with Jira, Asana, etc.
3. **Communication Tools** - Send notifications to Slack, Teams, Discord
4. **Analytics Platforms** - Send event data to analytics services
5. **Custom Automations** - Enable complex workflow automations

### Support and Community

**Getting Help:**
- Review this documentation thoroughly before implementation
- Study existing Huly code patterns and conventions
- Test implementations thoroughly in development environments
- Follow security best practices for production deployments

**Contributing Back:**
- Share improvements and bug fixes with the Huly community
- Document any additional patterns or conventions discovered
- Contribute test cases and examples for future developers
- Help maintain and improve this documentation

This comprehensive webhook integration guide provides a complete foundation for implementing robust, scalable, and maintainable webhook functionality in Huly while following established development patterns and best practices.
```
