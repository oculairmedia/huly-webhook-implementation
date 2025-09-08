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
  import type { WebhookConfig, WebhookEventType } from '@hcengineering/webhook'
  import { createEventDispatcher } from 'svelte'
  import { getClient } from '@hcengineering/presentation'
  import { 
    Button, 
    EditBox, 
    Label, 
    Toggle,
    Card,
    IconClose,
    showPopup,
    createFocusManager
  } from '@hcengineering/ui'
  import { generateId } from '@hcengineering/core'
  import webhook from '@hcengineering/webhook'

  export let webhook: WebhookConfig | undefined
  export let readonly: boolean = false

  const dispatch = createEventDispatcher()
  const client = getClient()
  const manager = createFocusManager()

  let url = webhook?.url || ''
  let secret = webhook?.secret || ''
  let enabled = webhook?.enabled ?? true
  let retryAttempts = webhook?.retryAttempts || 3
  let timeout = webhook?.timeout || 30000
  let rateLimit = webhook?.rateLimit || 100
  let rateLimitPeriod = webhook?.rateLimitPeriod || 3600000

  // Event type selections
  let selectedEvents = new Set(webhook?.events || [])
  
  // Custom headers
  let customHeaders: { key: string, value: string }[] = []
  
  if (webhook?.headers) {
    customHeaders = Object.entries(webhook.headers).map(([key, value]) => ({ key, value }))
  }

  const availableEvents: { type: WebhookEventType, label: string, group: string }[] = [
    // Issue events
    { type: 'issue.created', label: 'Issue Created', group: 'Issues' },
    { type: 'issue.updated', label: 'Issue Updated', group: 'Issues' },
    { type: 'issue.deleted', label: 'Issue Deleted', group: 'Issues' },
    
    // Project events
    { type: 'project.created', label: 'Project Created', group: 'Projects' },
    { type: 'project.updated', label: 'Project Updated', group: 'Projects' },
    { type: 'project.deleted', label: 'Project Deleted', group: 'Projects' },
    
    // Component events
    { type: 'component.created', label: 'Component Created', group: 'Components' },
    { type: 'component.updated', label: 'Component Updated', group: 'Components' },
    { type: 'component.deleted', label: 'Component Deleted', group: 'Components' },
    
    // Milestone events
    { type: 'milestone.created', label: 'Milestone Created', group: 'Milestones' },
    { type: 'milestone.updated', label: 'Milestone Updated', group: 'Milestones' },
    { type: 'milestone.deleted', label: 'Milestone Deleted', group: 'Milestones' },
    
    // Comment events
    { type: 'comment.created', label: 'Comment Created', group: 'Comments' },
    { type: 'comment.updated', label: 'Comment Updated', group: 'Comments' },
    { type: 'comment.deleted', label: 'Comment Deleted', group: 'Comments' }
  ]

  $: eventGroups = availableEvents.reduce((groups, event) => {
    if (!groups[event.group]) {
      groups[event.group] = []
    }
    groups[event.group].push(event)
    return groups
  }, {} as Record<string, typeof availableEvents>)

  $: isFormValid = url.trim() !== '' && selectedEvents.size > 0

  function toggleEvent (eventType: WebhookEventType) {
    if (selectedEvents.has(eventType)) {
      selectedEvents.delete(eventType)
    } else {
      selectedEvents.add(eventType)
    }
    selectedEvents = new Set(selectedEvents)
  }

  function addCustomHeader () {
    customHeaders = [...customHeaders, { key: '', value: '' }]
  }

  function removeCustomHeader (index: number) {
    customHeaders = customHeaders.filter((_, i) => i !== index)
  }

  function generateSecret () {
    // Generate a secure random secret
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    secret = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  async function save () {
    if (!isFormValid) return

    try {
      const headers = customHeaders.reduce((acc, header) => {
        if (header.key && header.value) {
          acc[header.key] = header.value
        }
        return acc
      }, {} as Record<string, string>)

      const data: Partial<WebhookConfig> = {
        url: url.trim(),
        secret: secret || undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        enabled,
        events: Array.from(selectedEvents),
        retryAttempts,
        timeout,
        rateLimit,
        rateLimitPeriod
      }

      if (webhook) {
        // Update existing webhook
        await client.update(webhook, data)
      } else {
        // Create new webhook
        await client.createDoc(webhook.class.WebhookConfig, webhook.space.Configuration, data)
      }

      dispatch('close')
    } catch (error) {
      console.error('Error saving webhook:', error)
      // TODO: Show error notification
    }
  }

  function cancel () {
    dispatch('close')
  }

  function isValidUrl (url: string): boolean {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }
</script>

<Card
  label={webhook ? webhook.string.EditWebhook : webhook.string.CreateWebhook}
  okLabel={webhook.string.Save}
  canSave={isFormValid}
  on:close={cancel}
  on:changeContent={save}
  {manager}
>
  <div class="webhook-form">
    <!-- Basic Configuration -->
    <div class="section">
      <div class="section-header">
        <Label label={webhook.string.BasicConfiguration} />
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <Label label={webhook.string.URL} />
          <EditBox
            bind:value={url}
            placeholder="https://your-webhook-endpoint.com/webhook"
            {readonly}
            maxWidth="400px"
          />
          {#if url && !isValidUrl(url)}
            <div class="error-text">
              <Label label={webhook.string.InvalidURL} />
            </div>
          {/if}
        </div>

        <div class="form-group">
          <div class="flex-row-center">
            <Label label={webhook.string.Enabled} />
            <Toggle bind:checked={enabled} disabled={readonly} />
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <div class="flex-row-center gap-2">
            <Label label={webhook.string.Secret} />
            <Button
              kind="ghost"
              size="small"
              label={webhook.string.Generate}
              on:click={generateSecret}
              disabled={readonly}
            />
          </div>
          <EditBox
            bind:value={secret}
            placeholder="Optional webhook secret for HMAC signatures"
            password={true}
            {readonly}
            maxWidth="400px"
          />
          <div class="help-text">
            <Label label={webhook.string.SecretHelp} />
          </div>
        </div>
      </div>
    </div>

    <!-- Event Selection -->
    <div class="section">
      <div class="section-header">
        <Label label={webhook.string.Events} />
      </div>
      
      <div class="event-groups">
        {#each Object.entries(eventGroups) as [groupName, events]}
          <div class="event-group">
            <div class="event-group-header">
              {groupName}
            </div>
            <div class="event-list">
              {#each events as event}
                <div class="event-item">
                  <Toggle
                    checked={selectedEvents.has(event.type)}
                    disabled={readonly}
                    on:change={() => toggleEvent(event.type)}
                  />
                  <span class="event-label">{event.label}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Advanced Configuration -->
    <div class="section">
      <div class="section-header">
        <Label label={webhook.string.Advanced} />
      </div>

      <div class="form-row">
        <div class="form-group">
          <Label label={webhook.string.RetryAttempts} />
          <EditBox
            bind:value={retryAttempts}
            type="number"
            min={0}
            max={10}
            {readonly}
            maxWidth="100px"
          />
        </div>

        <div class="form-group">
          <Label label={webhook.string.Timeout} />
          <EditBox
            bind:value={timeout}
            type="number"
            min={1000}
            max={300000}
            {readonly}
            maxWidth="120px"
          />
          <div class="help-text">milliseconds</div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <Label label={webhook.string.RateLimit} />
          <EditBox
            bind:value={rateLimit}
            type="number"
            min={1}
            max={10000}
            {readonly}
            maxWidth="120px"
          />
          <div class="help-text">requests per period</div>
        </div>

        <div class="form-group">
          <Label label={webhook.string.RateLimitPeriod} />
          <EditBox
            bind:value={rateLimitPeriod}
            type="number"
            min={60000}
            max={86400000}
            {readonly}
            maxWidth="120px"
          />
          <div class="help-text">milliseconds</div>
        </div>
      </div>
    </div>

    <!-- Custom Headers -->
    <div class="section">
      <div class="section-header">
        <div class="flex-row-center">
          <Label label={webhook.string.CustomHeaders} />
          <Button
            kind="ghost"
            size="small"
            label={webhook.string.Add}
            on:click={addCustomHeader}
            disabled={readonly}
          />
        </div>
      </div>

      {#each customHeaders as header, index}
        <div class="header-row">
          <EditBox
            bind:value={header.key}
            placeholder="Header name"
            {readonly}
            maxWidth="180px"
          />
          <EditBox
            bind:value={header.value}
            placeholder="Header value"
            {readonly}
            maxWidth="250px"
          />
          <Button
            icon={IconClose}
            kind="ghost"
            size="small"
            on:click={() => removeCustomHeader(index)}
            disabled={readonly}
          />
        </div>
      {/each}
    </div>
  </div>
</Card>

<style>
  .webhook-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1rem;
    min-width: 600px;
    max-width: 800px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-header {
    font-weight: 600;
    color: var(--theme-content-color);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .form-row {
    display: flex;
    gap: 2rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }

  .event-groups {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .event-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .event-group-header {
    font-weight: 500;
    color: var(--theme-content-color);
    font-size: 0.875rem;
  }

  .event-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-left: 1rem;
  }

  .event-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .event-label {
    font-size: 0.875rem;
    color: var(--theme-content-color);
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .help-text {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
    font-style: italic;
  }

  .error-text {
    font-size: 0.75rem;
    color: var(--theme-error-color);
  }
</style>