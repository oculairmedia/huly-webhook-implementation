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
    IconRefresh,
    createFocusManager
  } from '@hcengineering/ui'
  import webhook from '@hcengineering/webhook'

  export let webhookConfig: WebhookConfig

  const dispatch = createEventDispatcher()
  const manager = createFocusManager()

  let events: WebhookEvent[] = []
  let deliveryAttempts: WebhookDeliveryAttempt[] = []
  let loading = false

  interface WebhookStats {
    totalEvents: number
    totalDeliveries: number
    successfulDeliveries: number
    failedDeliveries: number
    successRate: number
    averageResponseTime: number
    retryRate: number
    eventsByType: Record<string, number>
    recentEvents: number
    circuitBreakerStatus: 'healthy' | 'degraded' | 'failing'
  }

  let stats: WebhookStats = {
    totalEvents: 0,
    totalDeliveries: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    successRate: 0,
    averageResponseTime: 0,
    retryRate: 0,
    eventsByType: {},
    recentEvents: 0,
    circuitBreakerStatus: 'healthy'
  }

  const eventQuery = createQuery()
  const attemptQuery = createQuery()

  $: eventQuery.query(
    webhook.class.WebhookEvent,
    { webhookConfig: webhookConfig._id },
    (result) => {
      events = result
      calculateStats()
    },
    {
      sort: { timestamp: -1 },
      limit: 1000
    }
  )

  $: attemptQuery.query(
    webhook.class.WebhookDeliveryAttempt,
    { webhookConfigId: webhookConfig._id },
    (result) => {
      deliveryAttempts = result
      calculateStats()
    },
    {
      sort: { timestamp: -1 },
      limit: 5000
    }
  )

  function calculateStats() {
    if (events.length === 0 && deliveryAttempts.length === 0) return

    const now = Date.now()
    const last24Hours = now - (24 * 60 * 60 * 1000)
    const last7Days = now - (7 * 24 * 60 * 60 * 1000)

    // Basic counts
    stats.totalEvents = events.length
    stats.totalDeliveries = deliveryAttempts.length

    // Success/failure analysis
    const successful = deliveryAttempts.filter(a => a.success)
    const failed = deliveryAttempts.filter(a => !a.success)
    
    stats.successfulDeliveries = successful.length
    stats.failedDeliveries = failed.length
    stats.successRate = stats.totalDeliveries > 0 
      ? (stats.successfulDeliveries / stats.totalDeliveries) * 100 
      : 0

    // Response time analysis
    const responseTimes = successful.map(a => a.responseTime).filter(rt => rt > 0)
    stats.averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, rt) => sum + rt, 0) / responseTimes.length
      : 0

    // Retry analysis
    const eventAttemptCounts = new Map<string, number>()
    deliveryAttempts.forEach(attempt => {
      const count = eventAttemptCounts.get(attempt.eventId) || 0
      eventAttemptCounts.set(attempt.eventId, count + 1)
    })
    
    const eventsWithRetries = Array.from(eventAttemptCounts.values()).filter(count => count > 1).length
    stats.retryRate = stats.totalEvents > 0 
      ? (eventsWithRetries / stats.totalEvents) * 100 
      : 0

    // Events by type
    stats.eventsByType = {}
    events.forEach(event => {
      stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1
    })

    // Recent activity
    stats.recentEvents = events.filter(e => e.timestamp > last24Hours).length

    // Circuit breaker status simulation based on recent performance
    const recentAttempts = deliveryAttempts.filter(a => a.timestamp > last24Hours)
    if (recentAttempts.length === 0) {
      stats.circuitBreakerStatus = 'healthy'
    } else {
      const recentSuccessRate = (recentAttempts.filter(a => a.success).length / recentAttempts.length) * 100
      const recentAvgResponseTime = recentAttempts
        .filter(a => a.success && a.responseTime > 0)
        .reduce((sum, a, _, arr) => sum + a.responseTime / arr.length, 0)

      if (recentSuccessRate < 50 || recentAvgResponseTime > 30000) {
        stats.circuitBreakerStatus = 'failing'
      } else if (recentSuccessRate < 85 || recentAvgResponseTime > 15000) {
        stats.circuitBreakerStatus = 'degraded'
      } else {
        stats.circuitBreakerStatus = 'healthy'
      }
    }
  }

  function close () {
    dispatch('close')
  }

  function refresh () {
    loading = true
    setTimeout(() => {
      eventQuery.query(
        webhook.class.WebhookEvent,
        { webhookConfig: webhookConfig._id },
        (result) => {
          events = result
          loading = false
        }
      )
    }, 100)
  }

  function formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'healthy': return 'var(--theme-success-color)'
      case 'degraded': return 'var(--theme-warning-color)'
      case 'failing': return 'var(--theme-error-color)'
      default: return 'var(--theme-content-trans-color)'
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case 'healthy': return 'Healthy'
      case 'degraded': return 'Degraded'
      case 'failing': return 'Failing'
      default: return 'Unknown'
    }
  }
</script>

<Card
  label={webhook.string.WebhookStats}
  okLabel={webhook.string.Close}
  canSave={true}
  on:close={close}
  on:changeContent={close}
  {manager}
>
  <div class="webhook-stats">
    <div class="stats-header">
      <div class="stats-title">
        <Label label={webhook.string.StatisticsFor} />
        <span class="webhook-url">{webhookConfig.url}</span>
      </div>
      
      <div class="stats-actions">
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
        <span class="ml-2">Loading statistics...</span>
      </div>
    {:else}
      <div class="stats-content">
        <!-- Overview Cards -->
        <div class="stats-overview">
          <div class="stat-card">
            <div class="stat-value">{stats.totalEvents}</div>
            <div class="stat-label">Total Events</div>
          </div>
          
          <div class="stat-card">
            <div class="stat-value">{stats.totalDeliveries}</div>
            <div class="stat-label">Total Deliveries</div>
          </div>
          
          <div class="stat-card">
            <div class="stat-value" style="color: var(--theme-success-color)">
              {stats.successfulDeliveries}
            </div>
            <div class="stat-label">Successful</div>
          </div>
          
          <div class="stat-card">
            <div class="stat-value" style="color: var(--theme-error-color)">
              {stats.failedDeliveries}
            </div>
            <div class="stat-label">Failed</div>
          </div>
        </div>

        <!-- Performance Metrics -->
        <div class="stats-section">
          <div class="section-header">
            <Label label={webhook.string.PerformanceMetrics} />
          </div>
          
          <div class="metrics-grid">
            <div class="metric-item">
              <div class="metric-label">Success Rate</div>
              <div class="metric-value" style="color: {stats.successRate > 85 ? 'var(--theme-success-color)' : stats.successRate > 50 ? 'var(--theme-warning-color)' : 'var(--theme-error-color)'}">
                {formatPercentage(stats.successRate)}
              </div>
              <div class="metric-bar">
                <div class="metric-bar-fill" style="width: {stats.successRate}%; background-color: {stats.successRate > 85 ? 'var(--theme-success-color)' : stats.successRate > 50 ? 'var(--theme-warning-color)' : 'var(--theme-error-color)'}"></div>
              </div>
            </div>
            
            <div class="metric-item">
              <div class="metric-label">Average Response Time</div>
              <div class="metric-value" style="color: {stats.averageResponseTime < 5000 ? 'var(--theme-success-color)' : stats.averageResponseTime < 15000 ? 'var(--theme-warning-color)' : 'var(--theme-error-color)'}">
                {formatDuration(stats.averageResponseTime)}
              </div>
            </div>
            
            <div class="metric-item">
              <div class="metric-label">Retry Rate</div>
              <div class="metric-value" style="color: {stats.retryRate < 10 ? 'var(--theme-success-color)' : stats.retryRate < 25 ? 'var(--theme-warning-color)' : 'var(--theme-error-color)'}">
                {formatPercentage(stats.retryRate)}
              </div>
              <div class="metric-bar">
                <div class="metric-bar-fill" style="width: {Math.min(stats.retryRate, 100)}%; background-color: {stats.retryRate < 10 ? 'var(--theme-success-color)' : stats.retryRate < 25 ? 'var(--theme-warning-color)' : 'var(--theme-error-color)'}"></div>
              </div>
            </div>
            
            <div class="metric-item">
              <div class="metric-label">Recent Events (24h)</div>
              <div class="metric-value">
                {stats.recentEvents}
              </div>
            </div>
          </div>
        </div>

        <!-- Circuit Breaker Status -->
        <div class="stats-section">
          <div class="section-header">
            <Label label={webhook.string.CircuitBreakerStatus} />
          </div>
          
          <div class="circuit-status">
            <div 
              class="circuit-indicator"
              style="background-color: {getStatusColor(stats.circuitBreakerStatus)}"
            ></div>
            <span class="circuit-text" style="color: {getStatusColor(stats.circuitBreakerStatus)}">
              {getStatusText(stats.circuitBreakerStatus)}
            </span>
            <div class="circuit-description">
              {#if stats.circuitBreakerStatus === 'healthy'}
                Endpoint is responding normally with good performance
              {:else if stats.circuitBreakerStatus === 'degraded'}
                Endpoint is experiencing some issues but still functional
              {:else}
                Endpoint is having significant issues and may be failing
              {/if}
            </div>
          </div>
        </div>

        <!-- Event Types Breakdown -->
        <div class="stats-section">
          <div class="section-header">
            <Label label={webhook.string.EventTypes} />
          </div>
          
          <div class="event-types">
            {#each Object.entries(stats.eventsByType).sort((a, b) => b[1] - a[1]) as [eventType, count]}
              <div class="event-type-item">
                <div class="event-type-name">{eventType}</div>
                <div class="event-type-count">{count}</div>
                <div class="event-type-bar">
                  <div 
                    class="event-type-bar-fill" 
                    style="width: {(count / Math.max(...Object.values(stats.eventsByType))) * 100}%"
                  ></div>
                </div>
              </div>
            {/each}
            
            {#if Object.keys(stats.eventsByType).length === 0}
              <div class="no-events">
                <Label label={webhook.string.NoEventTypesYet} />
              </div>
            {/if}
          </div>
        </div>

        <!-- Configuration Summary -->
        <div class="stats-section">
          <div class="section-header">
            <Label label={webhook.string.Configuration} />
          </div>
          
          <div class="config-summary">
            <div class="config-item">
              <span class="config-label">Status:</span>
              <span class="config-value" style="color: {webhookConfig.enabled ? 'var(--theme-success-color)' : 'var(--theme-warning-color)'}">
                {webhookConfig.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            
            <div class="config-item">
              <span class="config-label">Events:</span>
              <span class="config-value">{webhookConfig.events.length} types</span>
            </div>
            
            <div class="config-item">
              <span class="config-label">Retry Attempts:</span>
              <span class="config-value">{webhookConfig.retryAttempts || 3}</span>
            </div>
            
            <div class="config-item">
              <span class="config-label">Timeout:</span>
              <span class="config-value">{formatDuration(webhookConfig.timeout || 30000)}</span>
            </div>
            
            {#if webhookConfig.secret}
              <div class="config-item">
                <span class="config-label">Security:</span>
                <span class="config-value" style="color: var(--theme-success-color)">HMAC Enabled</span>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</Card>

<style>
  .webhook-stats {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1rem;
    min-width: 800px;
    max-width: 1000px;
    max-height: 80vh;
    overflow: hidden;
  }

  .stats-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .stats-title {
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

  .stats-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .stats-overview {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }

  .stat-card {
    padding: 1rem;
    background: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    text-align: center;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--theme-content-color);
    margin-bottom: 0.25rem;
  }

  .stat-label {
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
  }

  .stats-section {
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

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  .metric-item {
    padding: 1rem;
    background: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
  }

  .metric-label {
    font-size: 0.875rem;
    color: var(--theme-content-trans-color);
    margin-bottom: 0.5rem;
  }

  .metric-value {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .metric-bar {
    height: 6px;
    background: var(--theme-divider-color);
    border-radius: 3px;
    overflow: hidden;
  }

  .metric-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .circuit-status {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
  }

  .circuit-indicator {
    width: 16px;
    height: 16px;
    border-radius: 50%;
  }

  .circuit-text {
    font-weight: 600;
    font-size: 1rem;
  }

  .circuit-description {
    color: var(--theme-content-trans-color);
    font-size: 0.875rem;
  }

  .event-types {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .event-type-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    background: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
  }

  .event-type-name {
    flex: 0 0 200px;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: var(--theme-content-color);
  }

  .event-type-count {
    flex: 0 0 60px;
    font-weight: 600;
    color: var(--theme-content-color);
  }

  .event-type-bar {
    flex: 1;
    height: 8px;
    background: var(--theme-divider-color);
    border-radius: 4px;
    overflow: hidden;
  }

  .event-type-bar-fill {
    height: 100%;
    background: var(--theme-accent-color);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .no-events {
    text-align: center;
    padding: 1rem;
    color: var(--theme-content-trans-color);
  }

  .config-summary {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
  }

  .config-item {
    display: flex;
    gap: 1rem;
  }

  .config-label {
    flex: 0 0 120px;
    font-weight: 500;
    color: var(--theme-content-trans-color);
  }

  .config-value {
    color: var(--theme-content-color);
  }
</style>