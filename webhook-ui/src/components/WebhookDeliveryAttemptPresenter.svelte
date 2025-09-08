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
  import type { WebhookDeliveryAttempt } from '@hcengineering/webhook'
  import { Label } from '@hcengineering/ui'
  import webhook from '@hcengineering/webhook'

  export let value: WebhookDeliveryAttempt
  export let inline: boolean = false
  export let accent: boolean = false
  export let disabled: boolean = false

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
    
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  function getStatusColor(attempt: WebhookDeliveryAttempt): string {
    return attempt.success ? 'var(--theme-success-color)' : 'var(--theme-error-color)'
  }

  function getStatusIcon(attempt: WebhookDeliveryAttempt): string {
    return attempt.success ? '✓' : '✗'
  }

  function getHttpStatusColor(status: number | undefined): string {
    if (!status) return 'var(--theme-content-trans-color)'
    if (status >= 200 && status < 300) return 'var(--theme-success-color)'
    if (status >= 300 && status < 400) return 'var(--theme-warning-color)'
    if (status >= 400 && status < 500) return 'var(--theme-error-color)'
    if (status >= 500) return 'var(--theme-error-color)'
    return 'var(--theme-content-trans-color)'
  }

  function getResponseTimeColor(responseTime: number): string {
    if (responseTime < 1000) return 'var(--theme-success-color)'
    if (responseTime < 5000) return 'var(--theme-warning-color)'
    return 'var(--theme-error-color)'
  }

  function formatAttemptNumber(attemptNumber: number | undefined): string {
    if (!attemptNumber) return '1st'
    const suffix = ['th', 'st', 'nd', 'rd'][attemptNumber % 100 > 10 && attemptNumber % 100 < 14 ? 0 : attemptNumber % 10] || 'th'
    return `${attemptNumber}${suffix}`
  }
</script>

{#if inline}
  <div class="delivery-attempt-inline" class:accent class:disabled>
    <div class="attempt-status">
      <div 
        class="status-indicator"
        style="background-color: {getStatusColor(value)}"
      ></div>
      <span class="status-text" style="color: {getStatusColor(value)}">
        {value.success ? 'Success' : 'Failed'}
      </span>
    </div>
    
    {#if value.httpStatus}
      <span class="http-status" style="color: {getHttpStatusColor(value.httpStatus)}">
        HTTP {value.httpStatus}
      </span>
    {/if}
    
    <span class="response-time" style="color: {getResponseTimeColor(value.responseTime)}">
      {formatDuration(value.responseTime)}
    </span>
    
    <span class="attempt-time">
      {formatTimestamp(value.timestamp)}
    </span>
  </div>
{:else}
  <div class="delivery-attempt-card" class:accent class:disabled>
    <div class="attempt-header">
      <div class="attempt-status-info">
        <div class="status-main">
          <div 
            class="status-indicator"
            style="background-color: {getStatusColor(value)}"
          ></div>
          <span class="status-text" style="color: {getStatusColor(value)}">
            {getStatusIcon(value)} {value.success ? 'Successful' : 'Failed'} Delivery
          </span>
        </div>
        
        {#if value.attemptNumber}
          <div class="attempt-number">
            {formatAttemptNumber(value.attemptNumber)} attempt
          </div>
        {/if}
      </div>
      
      <div class="attempt-timing">
        <span class="response-time" style="color: {getResponseTimeColor(value.responseTime)}">
          {formatDuration(value.responseTime)}
        </span>
      </div>
    </div>

    <div class="attempt-details">
      <div class="detail-row">
        <span class="detail-label">Timestamp:</span>
        <span class="detail-value">{formatTimestamp(value.timestamp)}</span>
      </div>

      {#if value.httpStatus}
        <div class="detail-row">
          <span class="detail-label">HTTP Status:</span>
          <span class="detail-value" style="color: {getHttpStatusColor(value.httpStatus)}">
            {value.httpStatus}
          </span>
        </div>
      {/if}

      <div class="detail-row">
        <span class="detail-label">Response Time:</span>
        <span class="detail-value" style="color: {getResponseTimeColor(value.responseTime)}">
          {formatDuration(value.responseTime)}
        </span>
      </div>

      {#if value.eventId}
        <div class="detail-row">
          <span class="detail-label">Event ID:</span>
          <span class="detail-value event-id" title={value.eventId}>
            {value.eventId.length > 20 
              ? value.eventId.substring(0, 10) + '...' + value.eventId.substring(value.eventId.length - 6)
              : value.eventId
            }
          </span>
        </div>
      {/if}

      {#if value.webhookConfigId}
        <div class="detail-row">
          <span class="detail-label">Webhook ID:</span>
          <span class="detail-value webhook-id" title={value.webhookConfigId}>
            {value.webhookConfigId.length > 20 
              ? value.webhookConfigId.substring(0, 10) + '...' + value.webhookConfigId.substring(value.webhookConfigId.length - 6)
              : value.webhookConfigId
            }
          </span>
        </div>
      {/if}
    </div>

    {#if value.error}
      <div class="attempt-error">
        <div class="error-header">
          <span class="error-label">Error Details:</span>
        </div>
        <div class="error-message">
          {value.error}
        </div>
      </div>
    {/if}

    {#if value.responseHeaders && Object.keys(value.responseHeaders).length > 0}
      <div class="response-headers">
        <div class="headers-header">
          <span class="headers-label">Response Headers:</span>
          <span class="headers-count">
            {Object.keys(value.responseHeaders).length} headers
          </span>
        </div>
        <div class="headers-preview">
          {#each Object.entries(value.responseHeaders).slice(0, 3) as [key, headerValue]}
            <div class="header-field">
              <span class="header-key">{key}:</span>
              <span class="header-value" title={String(headerValue)}>
                {String(headerValue).length > 40 
                  ? String(headerValue).substring(0, 37) + '...'
                  : String(headerValue)
                }
              </span>
            </div>
          {/each}
          {#if Object.keys(value.responseHeaders).length > 3}
            <div class="headers-more">
              +{Object.keys(value.responseHeaders).length - 3} more headers...
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if value.responseBody && value.responseBody.length > 0}
      <div class="response-body">
        <div class="body-header">
          <span class="body-label">Response Body:</span>
          <span class="body-size">
            {value.responseBody.length} characters
          </span>
        </div>
        <div class="body-preview">
          {value.responseBody.length > 200 
            ? value.responseBody.substring(0, 197) + '...'
            : value.responseBody
          }
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .delivery-attempt-inline {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }

  .delivery-attempt-inline.accent {
    background: var(--theme-accent-color);
    color: white;
  }

  .delivery-attempt-inline.disabled {
    opacity: 0.6;
  }

  .attempt-status {
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
    font-weight: 500;
    font-size: 0.875rem;
  }

  .http-status {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .response-time {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .attempt-time {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
    white-space: nowrap;
  }

  .delivery-attempt-inline.accent .attempt-time {
    color: rgba(255, 255, 255, 0.8);
  }

  .delivery-attempt-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-button-default);
  }

  .delivery-attempt-card.accent {
    border-color: var(--theme-accent-color);
    background: var(--theme-accent-color);
    color: white;
  }

  .delivery-attempt-card.disabled {
    opacity: 0.6;
    background: var(--theme-button-disabled);
  }

  .attempt-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .attempt-status-info {
    flex: 1;
  }

  .status-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    font-size: 1rem;
  }

  .attempt-number {
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
    margin-top: 0.25rem;
  }

  .delivery-attempt-card.accent .attempt-number {
    color: rgba(255, 255, 255, 0.8);
  }

  .attempt-timing {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-weight: 500;
  }

  .attempt-details {
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
    min-width: 110px;
    color: var(--theme-content-trans-color);
  }

  .delivery-attempt-card.accent .detail-label {
    color: rgba(255, 255, 255, 0.8);
  }

  .detail-value {
    color: var(--theme-content-color);
    flex: 1;
  }

  .delivery-attempt-card.accent .detail-value {
    color: white;
  }

  .detail-value.event-id,
  .detail-value.webhook-id {
    font-family: var(--font-mono);
    word-break: break-all;
  }

  .attempt-error {
    padding: 0.75rem;
    background: var(--theme-error-color);
    color: white;
    border-radius: 0.375rem;
  }

  .error-header {
    margin-bottom: 0.5rem;
  }

  .error-label {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .error-message {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .response-headers,
  .response-body {
    padding: 0.75rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
  }

  .delivery-attempt-card.accent .response-headers,
  .delivery-attempt-card.accent .response-body {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .headers-header,
  .body-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .headers-label,
  .body-label {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--theme-content-color);
  }

  .delivery-attempt-card.accent .headers-label,
  .delivery-attempt-card.accent .body-label {
    color: white;
  }

  .headers-count,
  .body-size {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
  }

  .delivery-attempt-card.accent .headers-count,
  .delivery-attempt-card.accent .body-size {
    color: rgba(255, 255, 255, 0.8);
  }

  .headers-preview {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .header-field {
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .header-key {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--theme-content-trans-color);
    min-width: 120px;
  }

  .delivery-attempt-card.accent .header-key {
    color: rgba(255, 255, 255, 0.8);
  }

  .header-value {
    font-family: var(--font-mono);
    color: var(--theme-content-color);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .delivery-attempt-card.accent .header-value {
    color: white;
  }

  .headers-more {
    font-size: 0.75rem;
    color: var(--theme-content-trans-color);
    font-style: italic;
  }

  .delivery-attempt-card.accent .headers-more {
    color: rgba(255, 255, 255, 0.6);
  }

  .body-preview {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    padding: 0.5rem;
    border-radius: 0.25rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 150px;
    overflow-y: auto;
  }

  .delivery-attempt-card.accent .body-preview {
    background: rgba(0, 0, 0, 0.2);
    color: white;
  }
</style>