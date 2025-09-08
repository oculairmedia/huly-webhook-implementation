<!--
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
-->
<script lang="ts">
  import type { WebhookEvent } from '@hcengineering/webhook'
  import { Label } from '@hcengineering/ui'
  import webhook from '@hcengineering/webhook'

  export let value: WebhookEvent
  export let inline: boolean = false
  export let accent: boolean = false
  export let disabled: boolean = false

  function formatEventType(eventType: string): string {
    return eventType.split('.').map(part => 
      part.charAt(0).toUpperCase() + part.slice(1)
    ).join(' ')
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    return date.toLocaleDateString()
  }

  function getEventIcon(eventType: string): string {
    if (eventType.includes('created')) return '+'
    if (eventType.includes('updated')) return '✏'
    if (eventType.includes('deleted')) return '✗'
    return '•'
  }

  function getEventColor(eventType: string): string {
    if (eventType.includes('created')) return 'var(--theme-success-color)'
    if (eventType.includes('updated')) return 'var(--theme-warning-color)'
    if (eventType.includes('deleted')) return 'var(--theme-error-color)'
    return 'var(--theme-accent-color)'
  }

  function formatObjectId(objectId: string): string {
    if (objectId.length > 20) {
      return objectId.substring(0, 10) + '...' + objectId.substring(objectId.length - 6)
    }
    return objectId
  }
</script>

{#if inline}
  <div class="webhook-event-inline" class:accent class:disabled>
    <div class="event-icon" style="color: {getEventColor(value.type)}">
      {getEventIcon(value.type)}
    </div>
    <div class="event-info">
      <span class="event-type">{formatEventType(value.type)}</span>
      <span class="event-object">{formatObjectId(value.objectId)}</span>
    </div>
    <div class="event-time">
      {formatTimestamp(value.timestamp)}
    </div>
  </div>
{:else}
  <div class="webhook-event-card" class:accent class:disabled>
    <div class="event-header">
      <div class="event-icon" style="color: {getEventColor(value.type)}">
        {getEventIcon(value.type)}
      </div>
      <div class="event-type-info">
        <div class="event-type-name">{formatEventType(value.type)}</div>
        <div class="event-timestamp">{formatTimestamp(value.timestamp)}</div>
      </div>
    </div>

    <div class="event-details">
      <div class="detail-row">
        <span class="detail-label">Object ID:</span>
        <span class="detail-value object-id" title={value.objectId}>
          {formatObjectId(value.objectId)}
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-label">Object Class:</span>
        <span class="detail-value">{value.objectClass}</span>
      </div>

      {#if value.action}
        <div class="detail-row">
          <span class="detail-label">Action:</span>
          <span class="detail-value">{value.action}</span>
        </div>
      {/if}

      {#if value.modifiedBy}
        <div class="detail-row">
          <span class="detail-label">Modified By:</span>
          <span class="detail-value">{value.modifiedBy}</span>
        </div>
      {/if}

      {#if value.workspace}
        <div class="detail-row">
          <span class="detail-label">Workspace:</span>
          <span class="detail-value">{value.workspace}</span>
        </div>
      {/if}
    </div>

    {#if value.payload && Object.keys(value.payload).length > 0}
      <div class="event-payload">
        <div class="payload-header">
          <span class="payload-label">Payload:</span>
          <span class="payload-size">
            {Object.keys(value.payload).length} fields
          </span>
        </div>
        <div class="payload-preview">
          {#each Object.entries(value.payload).slice(0, 3) as [key, payloadValue]}
            <div class="payload-field">
              <span class="field-key">{key}:</span>
              <span class="field-value" title={String(payloadValue)}>
                {typeof payloadValue === 'object' 
                  ? `{${Object.keys(payloadValue || {}).length} fields}`
                  : String(payloadValue).length > 30 
                    ? String(payloadValue).substring(0, 27) + '...'
                    : String(payloadValue)
                }
              </span>
            </div>
          {/each}
          {#if Object.keys(value.payload).length > 3}
            <div class="payload-more">
              +{Object.keys(value.payload).length - 3} more fields...
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .webhook-event-inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }

  .webhook-event-inline.accent {
    background: var(--theme-accent-color);
    color: white;
  }

  .webhook-event-inline.disabled {
    opacity: 0.6;
  }

  .event-icon {
    font-weight: bold;
    font-size: 1rem;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
  }

  .event-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .event-type {
    font-weight: 500;
    white-space: nowrap;
  }

  .event-object {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .webhook-event-inline.accent .event-object {
    color: rgba(255, 255, 255, 0.8);
  }

  .event-time {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .webhook-event-inline.accent .event-time {
    color: rgba(255, 255, 255, 0.8);
  }

  .webhook-event-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-button-default);
  }

  .webhook-event-card.accent {
    border-color: var(--theme-accent-color);
    background: var(--theme-accent-color);
    color: white;
  }

  .webhook-event-card.disabled {
    opacity: 0.6;
    background: var(--theme-button-disabled);
  }

  .event-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .event-type-info {
    flex: 1;
  }

  .event-type-name {
    font-weight: 600;
    font-size: 1rem;
    color: var(--theme-content-color);
  }

  .webhook-event-card.accent .event-type-name {
    color: white;
  }

  .event-timestamp {
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
    margin-top: 0.25rem;
  }

  .webhook-event-card.accent .event-timestamp {
    color: rgba(255, 255, 255, 0.8);
  }

  .event-details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .detail-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .detail-label {
    font-weight: 500;
    min-width: 90px;
    color: var(--theme-content-trans-color);
  }

  .webhook-event-card.accent .detail-label {
    color: rgba(255, 255, 255, 0.8);
  }

  .detail-value {
    color: var(--theme-content-color);
    flex: 1;
    min-width: 0;
  }

  .webhook-event-card.accent .detail-value {
    color: white;
  }

  .detail-value.object-id {
    font-family: var(--font-mono);
    word-break: break-all;
  }

  .event-payload {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--theme-divider-color);
  }

  .webhook-event-card.accent .event-payload {
    border-top-color: rgba(255, 255, 255, 0.2);
  }

  .payload-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .payload-label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
  }

  .webhook-event-card.accent .payload-label {
    color: rgba(255, 255, 255, 0.8);
  }

  .payload-size {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
  }

  .webhook-event-card.accent .payload-size {
    color: rgba(255, 255, 255, 0.6);
  }

  .payload-preview {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .payload-field {
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .field-key {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--theme-content-trans-color);
    min-width: 80px;
  }

  .webhook-event-card.accent .field-key {
    color: rgba(255, 255, 255, 0.8);
  }

  .field-value {
    font-family: var(--font-mono);
    color: var(--theme-content-color);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .webhook-event-card.accent .field-value {
    color: white;
  }

  .payload-more {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
    font-style: italic;
  }

  .webhook-event-card.accent .payload-more {
    color: rgba(255, 255, 255, 0.6);
  }
</style>