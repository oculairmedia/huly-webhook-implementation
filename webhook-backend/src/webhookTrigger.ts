//
// Copyright © 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import {
  Doc,
  Ref,
  Class,
  TxCUD,
  TxCreateDoc,
  TxUpdateDoc,
  TxRemoveDoc,
  Tx,
  TxFactory,
  generateId,
  SortingOrder
} from '@hcengineering/core'
import { TriggerControl } from '@hcengineering/server-core'
import {
  WebhookConfig,
  WebhookEvent,
  WebhookEventType,
  WebhookEventStatus
} from '@hcengineering/webhook'
import tracker from '@hcengineering/tracker'
import chunter from '@hcengineering/chunter'

/**
 * Document classes that trigger webhook events
 */
const MONITORED_CLASSES = [
  'tracker:class:Issue',
  'tracker:class:Project', 
  'tracker:class:Component',
  'tracker:class:Milestone',
  'chunter:class:ChatMessage'
]

/**
 * Main webhook trigger function that processes transactions and creates webhook events
 * @public
 */
export async function WebhookHandler (
  txes: TxCUD<Doc>[],
  control: TriggerControl
): Promise<Tx[]> {
  const results: Tx[] = []

  // Filter transactions for monitored document classes
  const relevantTxes = txes.filter(tx => 
    MONITORED_CLASSES.includes(tx.objectClass as any)
  )

  if (relevantTxes.length === 0) {
    return results
  }

  // Get all webhook configurations
  const webhookConfigs = await control.findAll(
    control.ctx,
    'webhook:class:WebhookConfig' as Ref<Class<WebhookConfig>>,
    { enabled: true },
    { sort: { modifiedOn: SortingOrder.Descending } }
  )

  if (webhookConfigs.length === 0) {
    return results
  }

  // Process each relevant transaction
  for (const tx of relevantTxes) {
    const webhookEvents = await createWebhookEvents(tx, webhookConfigs, control)
    results.push(...webhookEvents)
  }

  return results
}

/**
 * Creates webhook events for a transaction based on configured webhooks
 */
async function createWebhookEvents (
  tx: TxCUD<Doc>,
  webhookConfigs: WebhookConfig[],
  control: TriggerControl
): Promise<Tx[]> {
  const results: Tx[] = []
  const eventType = getEventType(tx)
  
  if (!eventType) {
    return results
  }

  for (const config of webhookConfigs) {
    // Check if this webhook should receive this event type
    if (!config.events.includes(eventType)) {
      continue
    }

    // Check workspace/project scope filtering
    if (!await isEventInScope(tx, config, control)) {
      continue
    }

    // Create webhook event
    const webhookEvent = await createWebhookEvent(tx, config, eventType, control)
    if (webhookEvent) {
      results.push(webhookEvent)
    }
  }

  return results
}

/**
 * Determines the webhook event type from a transaction
 */
function getEventType (tx: TxCUD<Doc>): WebhookEventType | null {
  const objectClass = tx.objectClass as string

  switch (tx._class) {
    case 'core:class:TxCreateDoc':
      if (objectClass === 'tracker:class:Issue') return 'issue.created'
      if (objectClass === 'tracker:class:Project') return 'project.created'
      if (objectClass === 'tracker:class:Component') return 'component.created'
      if (objectClass === 'tracker:class:Milestone') return 'milestone.created'
      if (objectClass === 'chunter:class:ChatMessage') return 'comment.created'
      break
      
    case 'core:class:TxUpdateDoc':
      if (objectClass === 'tracker:class:Issue') return 'issue.updated'
      if (objectClass === 'tracker:class:Project') return 'project.updated'
      if (objectClass === 'tracker:class:Component') return 'component.updated'
      if (objectClass === 'tracker:class:Milestone') return 'milestone.updated'
      if (objectClass === 'chunter:class:ChatMessage') return 'comment.updated'
      break
      
    case 'core:class:TxRemoveDoc':
      if (objectClass === 'tracker:class:Issue') return 'issue.deleted'
      if (objectClass === 'tracker:class:Project') return 'project.deleted'
      if (objectClass === 'tracker:class:Component') return 'component.deleted'
      if (objectClass === 'tracker:class:Milestone') return 'milestone.deleted'
      if (objectClass === 'chunter:class:ChatMessage') return 'comment.deleted'
      break
  }

  return null
}

/**
 * Checks if the transaction is within the scope of the webhook configuration
 */
async function isEventInScope (
  tx: TxCUD<Doc>,
  config: WebhookConfig,
  control: TriggerControl
): Promise<boolean> {
  // If no scope restrictions, include all events
  if (!config.space && (!config.projects || config.projects.length === 0)) {
    return true
  }

  // Check space scope
  if (config.space && tx.space !== config.space) {
    return false
  }

  // Check project scope for tracker objects
  if (config.projects && config.projects.length > 0) {
    const objectClass = tx.objectClass as string
    
    if (objectClass.startsWith('tracker:class:')) {
      try {
        // For tracker objects, get the project from the object or its space
        const object = await getTransactionObject(tx, control)
        if (object) {
          const projectId = await getObjectProject(object, control)
          if (projectId && config.projects.includes(projectId)) {
            return true
          }
        }
      } catch (error) {
        control.ctx.error('Error checking project scope for webhook', { error: error.message })
      }
      
      return false
    }
  }

  return true
}

/**
 * Gets the object associated with a transaction
 */
async function getTransactionObject (
  tx: TxCUD<Doc>,
  control: TriggerControl
): Promise<Doc | null> {
  try {
    if (tx._class === 'core:class:TxCreateDoc') {
      const createTx = tx as TxCreateDoc<Doc>
      return createTx as any // The created object is embedded in the transaction
    }

    if (tx._class === 'core:class:TxUpdateDoc' || tx._class === 'core:class:TxRemoveDoc') {
      // Find the object by ID
      const objects = await control.findAll(
        control.ctx,
        tx.objectClass,
        { _id: tx.objectId },
        { limit: 1 }
      )
      return objects[0] || null
    }
  } catch (error) {
    control.ctx.error('Error retrieving transaction object', { error: error.message })
  }

  return null
}

/**
 * Gets the project ID for a tracker object
 */
async function getObjectProject (
  object: Doc,
  control: TriggerControl
): Promise<Ref<any> | null> {
  try {
    // For issues, get project from the space
    if ((object as any)._class === 'tracker:class:Issue') {
      const projects = await control.findAll(
        control.ctx,
        'tracker:class:Project' as Ref<Class<Doc>>,
        { _id: object.space },
        { limit: 1 }
      )
      return projects[0]?._id || null
    }

    // For projects, the object itself is the project
    if ((object as any)._class === 'tracker:class:Project') {
      return object._id
    }

    // For components and milestones, find their project
    if ((object as any)._class === 'tracker:class:Component' || 
        (object as any)._class === 'tracker:class:Milestone') {
      return object.space // Space should be the project ID
    }
  } catch (error) {
    // Log error but don't fail the webhook processing
  }

  return null
}

/**
 * Creates a webhook event transaction
 */
async function createWebhookEvent (
  tx: TxCUD<Doc>,
  config: WebhookConfig,
  eventType: WebhookEventType,
  control: TriggerControl
): Promise<Tx | null> {
  try {
    const factory = new TxFactory(control.workspace.workspace, true)
    const eventId = generateId<WebhookEvent>()

    // Build event payload
    const payload = await buildEventPayload(tx, eventType, control)

    // Create the webhook event document
    const webhookEventTx = factory.createTxCreateDoc<WebhookEvent>(
      'webhook:class:WebhookEvent' as Ref<Class<WebhookEvent>>,
      control.workspace.workspace, // Use workspace as space
      {
        eventType,
        objectId: tx.objectId,
        objectClass: tx.objectClass,
        payload,
        status: 'pending' as WebhookEventStatus,
        webhookConfig: config._id,
        attempts: 0
      },
      eventId
    )

    return webhookEventTx
  } catch (error) {
    control.ctx.error('Error creating webhook event', { 
      error: error.message,
      txId: tx._id,
      configId: config._id 
    })
    return null
  }
}

/**
 * Builds the webhook event payload from a transaction
 */
async function buildEventPayload (
  tx: TxCUD<Doc>,
  eventType: WebhookEventType,
  control: TriggerControl
): Promise<any> {
  const basePayload = {
    event: {
      id: generateId(),
      timestamp: Date.now(),
      type: eventType,
      action: getActionFromEventType(eventType),
      objectId: tx.objectId,
      objectClass: tx.objectClass
    },
    workspace: control.workspace.name,
    modifiedBy: tx.modifiedBy
  }

  try {
    // Add specific data based on transaction type
    switch (tx._class) {
      case 'core:class:TxCreateDoc':
        const createTx = tx as TxCreateDoc<Doc>
        basePayload['data'] = {
          action: 'created',
          object: createTx.attributes
        }
        break

      case 'core:class:TxUpdateDoc':
        const updateTx = tx as TxUpdateDoc<Doc>
        const updatedObject = await getTransactionObject(tx, control)
        basePayload['data'] = {
          action: 'updated',
          operations: updateTx.operations,
          object: updatedObject
        }
        break

      case 'core:class:TxRemoveDoc':
        const removedObject = control.removedMap.get(tx.objectId)
        basePayload['data'] = {
          action: 'deleted',
          object: removedObject
        }
        break
    }
  } catch (error) {
    control.ctx.error('Error building webhook payload', { 
      error: error.message,
      txId: tx._id 
    })
    // Return base payload even if detailed data fails
  }

  return basePayload
}

/**
 * Extracts action from event type
 */
function getActionFromEventType (eventType: WebhookEventType): string {
  if (eventType.endsWith('.created')) return 'created'
  if (eventType.endsWith('.updated')) return 'updated'  
  if (eventType.endsWith('.deleted')) return 'deleted'
  return 'unknown'
}