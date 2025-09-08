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
  import type { WebhookConfig, WebhookEvent, WebhookDeliveryAttempt } from '@hcengineering/webhook'
  import { createEventDispatcher } from 'svelte'
  import { createQuery } from '@hcengineering/presentation'
  import { 
    Button, 
    Label, 
    Card,
    Loading,
    showPopup,
    IconRefresh,
    createFocusManager
  } from '@hcengineering/ui'
  import webhook from '@hcengineering/webhook'

  export let webhookConfig: WebhookConfig

  const dispatch = createEventDispatcher()
  const manager = createFocusManager()

  let events: WebhookEvent[] = []
  let deliveryAttempts: Map<string, WebhookDeliveryAttempt[]> = new Map()
  let loading = false
  let selectedEvent: WebhookEvent | null = null
  let expandedEvents: Set<string> = new Set()

  const eventQuery = createQuery()
  const attemptQuery = createQuery()

  $: eventQuery.query(
    webhook.class.WebhookEvent,
    { webhookConfig: webhookConfig._id },
    (result) => {
      events = result
    },
    {
      sort: { timestamp: -1 },
      limit: 100
    }
  )

  $: if (events.length > 0) {
    attemptQuery.query(
      webhook.class.WebhookDeliveryAttempt,
      { eventId: { $in: events.map(e => e._id) } },
      (result) => {
        const attemptMap = new Map<string, WebhookDeliveryAttempt[]>()
        result.forEach(attempt => {
          if (!attemptMap.has(attempt.eventId)) {
            attemptMap.set(attempt.eventId, [])
          }
          attemptMap.get(attempt.eventId)!.push(attempt)
        })
        
        // Sort attempts by timestamp for each event
        attemptMap.forEach(attempts => {
          attempts.sort((a, b) => b.timestamp - a.timestamp)
        })
        
        deliveryAttempts = attemptMap
      }
    )
  }

  function close () {
    dispatch('close')
  }

  function refresh () {
    loading = true
    eventQuery.query(
      webhook.class.WebhookEvent,
      { webhookConfig: webhookConfig._id },
      (result) => {
        events = result
        loading = false
      },
      {
        sort: { timestamp: -1 },
        limit: 100
      }
    )
  }

  function toggleEventExpansion (eventId: string) {
    if (expandedEvents.has(eventId)) {
      expandedEvents.delete(eventId)
    } else {
      expandedEvents.add(eventId)
    }
    expandedEvents = new Set(expandedEvents)
  }

  function getEventStatusColor (event: WebhookEvent): string {
    const attempts = deliveryAttempts.get(event._id) || []
    if (attempts.length === 0) return 'var(--theme-warning-color)'
    
    const lastAttempt = attempts[0]
    if (lastAttempt.success) return 'var(--theme-success-color)'
    
    return 'var(--theme-error-color)'
  }

  function getEventStatusText (event: WebhookEvent): string {
    const attempts = deliveryAttempts.get(event._id) || []
    if (attempts.length === 0) return 'Pending'
    
    const lastAttempt = attempts[0]
    const attemptCount = attempts.length
    
    if (lastAttempt.success) {
      return attemptCount === 1 ? 'Delivered' : `Delivered (${attemptCount} attempts)`
    }
    
    return `Failed (${attemptCount} attempts)`
  }

  function getAttemptStatusColor (attempt: WebhookDeliveryAttempt): string {
    return attempt.success ? 'var(--theme-success-color)' : 'var(--theme-error-color)'
  }

  function formatEventType (eventType: string): string {
    return eventType.split('.').map(part => 
      part.charAt(0).toUpperCase() + part.slice(1)
    ).join(' ')
  }

  function formatDuration (ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  function formatTimestamp (timestamp: number): string {
    return new Date(timestamp).toLocaleString()
  }
</script>

<Card
  label={webhook.string.EventLog}
  okLabel={webhook.string.Close}
  canSave={true}
  on:close={close}
  on:changeContent={close}
  {manager}
>
  <div class="event-log">
    <div class="log-header">
      <div class="log-title">
        <Label label={webhook.string.EventLogFor} />
        <span class="webhook-url">{webhookConfig.url}</span>
      </div>
      
      <div class="log-actions">
        <Button
          icon={IconRefresh}
          kind="ghost"
          size="small"
          loading={loading}
          on:click={refresh}
        />
      </div>
    </div>

    {#if loading}
      <div class="loading-container">
        <Loading />
        <span class="ml-2">Loading events...</span>
      </div>
    {:else if events.length === 0}
      <div class="empty-state">
        <div class="empty-title">
          <Label label={webhook.string.NoEventsFound} />
        </div>
        <div class="empty-description">
          <Label label={webhook.string.EventsWillAppearHere} />
        </div>
      </div>
    {:else}
      <div class="event-list">
        {#each events as event}
          <div class="event-item">
            <div class="event-header" on:click={() => toggleEventExpansion(event._id)}>
              <div class="event-info">
                <div class="event-type">{formatEventType(event.type)}</div>
                <div class="event-object">{event.objectClass} • {event.objectId}</div>
              </div>
              
              <div class="event-status">
                <div 
                  class="status-indicator"
                  style="background-color: {getEventStatusColor(event)}"
                ></div>
                <span class="status-text">{getEventStatusText(event)}</span>
              </div>
              
              <div class="event-timestamp">
                {formatTimestamp(event.timestamp)}
              </div>
              
              <div class="expand-icon" class:expanded={expandedEvents.has(event._id)}>
                ▼
              </div>
            </div>

            {#if expandedEvents.has(event._id)}
              <div class="event-details">
                <div class="event-payload">
                  <div class="payload-header">
                    <Label label={webhook.string.EventPayload} />
                  </div>
                  <pre class="payload-content">{JSON.stringify(event.payload, null, 2)}</pre>
                </div>

                {#if deliveryAttempts.has(event._id)}
                  <div class="delivery-attempts">
                    <div class="attempts-header">
                      <Label label={webhook.string.DeliveryAttempts} />
                    </div>
                    
                    {#each deliveryAttempts.get(event._id) || [] as attempt}
                      <div class="attempt-item">
                        <div class="attempt-header">
                          <div class="attempt-status">
                            <div 
                              class="status-indicator"
                              style="background-color: {getAttemptStatusColor(attempt)}"
                            ></div>
                            <span class="status-text">
                              {attempt.success ? 'Success' : 'Failed'}
                            </span>
                            {#if attempt.httpStatus}
                              <span class="http-status" style="color: {attempt.httpStatus >= 200 && attempt.httpStatus < 300 ? 'var(--theme-success-color)' : 'var(--theme-error-color)'}">
                                HTTP {attempt.httpStatus}
                              </span>
                            {/if}
                          </div>
                          
                          <div class="attempt-timing">
                            <span class="response-time">{formatDuration(attempt.responseTime)}</span>
                            <span class="attempt-timestamp">{formatTimestamp(attempt.timestamp)}</span>
                          </div>
                        </div>

                        {#if attempt.error}
                          <div class="attempt-error">
                            <div class="error-label">Error:</div>
                            <div class="error-message">{attempt.error}</div>
                          </div>
                        {/if}

                        {#if attempt.responseHeaders}
                          <div class="response-headers">
                            <div class="headers-label">Response Headers:</div>
                            <pre class="headers-content">{JSON.stringify(attempt.responseHeaders, null, 2)}</pre>
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</Card>

<style>
  .event-log {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    min-width: 800px;
    max-width: 1200px;
    max-height: 80vh;
    overflow: hidden;
  }

  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .log-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
  }

  .webhook-url {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
  }

  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: var(--theme-content-trans-color);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem;
    text-align: center;
  }

  .empty-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--theme-content-color);
    margin-bottom: 0.5rem;
  }

  .empty-description {
    color: var(--theme-content-trans-color);
  }

  .event-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
    flex: 1;
  }

  .event-item {
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-button-default);
  }

  .event-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .event-header:hover {
    background: var(--theme-button-hovered);
  }

  .event-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .event-type {
    font-weight: 600;
    color: var(--theme-content-color);
  }

  .event-object {
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
    font-family: var(--font-mono);
  }

  .event-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .event-timestamp {
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
    white-space: nowrap;
  }

  .expand-icon {
    transition: transform 0.2s;
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
  }

  .expand-icon.expanded {
    transform: rotate(180deg);
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .status-text {
    font-size: 0.875rem;
    color: var(--theme-content-color);
  }

  .event-details {
    border-top: 1px solid var(--theme-divider-color);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .event-payload {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .payload-header {
    font-weight: 600;
    color: var(--theme-content-color);
  }

  .payload-content {
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    padding: 1rem;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
  }

  .delivery-attempts {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .attempts-header {
    font-weight: 600;
    color: var(--theme-content-color);
  }

  .attempt-item {
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    padding: 0.75rem;
    background: var(--theme-bg-color);
  }

  .attempt-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .attempt-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .http-status {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .attempt-timing {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
  }

  .response-time {
    font-family: var(--font-mono);
    font-weight: 500;
  }

  .attempt-error {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .error-label {
    font-weight: 500;
    color: var(--theme-error-color);
  }

  .error-message {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: var(--theme-error-color);
    background: var(--theme-button-default);
    padding: 0.5rem;
    border-radius: 0.25rem;
    border-left: 3px solid var(--theme-error-color);
  }

  .response-headers {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .headers-label {
    font-weight: 500;
    color: var(--theme-content-color);
  }

  .headers-content {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    background: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    padding: 0.5rem;
    max-height: 150px;
    overflow-y: auto;
  }
</style>