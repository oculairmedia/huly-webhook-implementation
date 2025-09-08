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
  import type { WebhookConfig } from '@hcengineering/webhook'
  import { Label } from '@hcengineering/ui'
  import webhook from '@hcengineering/webhook'

  export let value: WebhookConfig
  export let inline: boolean = false
  export let accent: boolean = false
  export let disabled: boolean = false

  function formatEventTypes(events: string[]): string {
    if (events.length === 0) return 'No events'
    if (events.length <= 3) return events.join(', ')
    return `${events.slice(0, 2).join(', ')}, +${events.length - 2} more`
  }

  function getStatusColor(config: WebhookConfig): string {
    if (!config.enabled) return 'var(--theme-warning-color)'
    // TODO: Get actual circuit breaker status
    return 'var(--theme-success-color)'
  }

  function getStatusText(config: WebhookConfig): string {
    if (!config.enabled) return 'Disabled'
    // TODO: Get actual circuit breaker status
    return 'Active'
  }
</script>

{#if inline}
  <div class="webhook-config-inline" class:accent class:disabled>
    <div class="webhook-info">
      <div class="webhook-url" title={value.url}>
        {value.url}
      </div>
      <div class="webhook-status">
        <div 
          class="status-indicator"
          style="background-color: {getStatusColor(value)}"
        ></div>
        <span class="status-text">{getStatusText(value)}</span>
      </div>
    </div>
  </div>
{:else}
  <div class="webhook-config-card" class:accent class:disabled>
    <div class="config-header">
      <div class="config-url" title={value.url}>
        {value.url}
      </div>
      <div class="config-status">
        <div 
          class="status-indicator"
          style="background-color: {getStatusColor(value)}"
        ></div>
        <span class="status-text">{getStatusText(value)}</span>
      </div>
    </div>

    <div class="config-details">
      <div class="detail-row">
        <span class="detail-label">Events:</span>
        <span class="detail-value">{formatEventTypes(value.events)}</span>
      </div>

      {#if value.secret}
        <div class="detail-row">
          <span class="detail-label">Security:</span>
          <span class="detail-value security-enabled">HMAC Signatures</span>
        </div>
      {/if}

      <div class="detail-row">
        <span class="detail-label">Retries:</span>
        <span class="detail-value">{value.retryAttempts || 3} attempts</span>
      </div>

      <div class="detail-row">
        <span class="detail-label">Timeout:</span>
        <span class="detail-value">{(value.timeout || 30000) / 1000}s</span>
      </div>

      {#if value.rateLimit}
        <div class="detail-row">
          <span class="detail-label">Rate Limit:</span>
          <span class="detail-value">
            {value.rateLimit} req/{Math.round((value.rateLimitPeriod || 3600000) / 60000)}min
          </span>
        </div>
      {/if}

      {#if value.headers && Object.keys(value.headers).length > 0}
        <div class="detail-row">
          <span class="detail-label">Headers:</span>
          <span class="detail-value">{Object.keys(value.headers).length} custom</span>
        </div>
      {/if}
    </div>

    {#if value.modifiedOn}
      <div class="config-footer">
        <span class="modified-date">
          Modified {new Date(value.modifiedOn).toLocaleDateString()}
        </span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .webhook-config-inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }

  .webhook-config-inline.accent {
    background: var(--theme-accent-color);
    color: white;
  }

  .webhook-config-inline.disabled {
    opacity: 0.6;
  }

  .webhook-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .webhook-url {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .webhook-status {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .status-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  .status-text {
    font-size: 0.75rem;
    font-weight: 500;
  }

  .webhook-config-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-button-default);
  }

  .webhook-config-card.accent {
    border-color: var(--theme-accent-color);
    background: var(--theme-accent-color);
    color: white;
  }

  .webhook-config-card.disabled {
    opacity: 0.6;
    background: var(--theme-button-disabled);
  }

  .config-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .config-url {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .config-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .config-details {
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
    min-width: 70px;
    color: var(--theme-content-trans-color);
  }

  .webhook-config-card.accent .detail-label {
    color: rgba(255, 255, 255, 0.8);
  }

  .detail-value {
    color: var(--theme-content-color);
  }

  .webhook-config-card.accent .detail-value {
    color: white;
  }

  .detail-value.security-enabled {
    color: var(--theme-success-color);
    font-weight: 500;
  }

  .webhook-config-card.accent .detail-value.security-enabled {
    color: #90EE90;
  }

  .config-footer {
    padding-top: 0.5rem;
    border-top: 1px solid var(--theme-divider-color);
  }

  .webhook-config-card.accent .config-footer {
    border-top-color: rgba(255, 255, 255, 0.2);
  }

  .modified-date {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
  }

  .webhook-config-card.accent .modified-date {
    color: rgba(255, 255, 255, 0.7);
  }
</style>