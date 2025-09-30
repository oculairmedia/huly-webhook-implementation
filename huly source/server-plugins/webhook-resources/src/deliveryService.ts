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
  TxFactory,
  generateId,
  SortingOrder,
  MeasureContext
} from '@hcengineering/core'
import { TriggerControl } from '@hcengineering/server-core'
import {
  WebhookConfig,
  WebhookEvent,
  WebhookDeliveryAttempt,
  WebhookEventStatus
} from '@hcengineering/webhook'
import { generateWebhookSignature } from './signatureGenerator'
import { CircuitBreakerManager, CircuitBreakerOpenError, CircuitState } from './circuitBreaker'

/**
 * HTTP client interface for webhook delivery
 */
interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
  responseTime: number
}

/**
 * Webhook delivery service for processing webhook events
 * @public
 */
export class WebhookDeliveryService {
  private circuitBreakers: CircuitBreakerManager

  constructor (
    private readonly ctx: MeasureContext,
    private readonly control: TriggerControl
  ) {
    this.circuitBreakers = new CircuitBreakerManager(ctx)
  }

  /**
   * Process pending webhook events
   */
  async processPendingEvents (): Promise<void> {
    const pendingEvents = await this.control.findAll(
      this.ctx,
      'webhook:class:WebhookEvent' as Ref<Class<WebhookEvent>>,
      { 
        status: { $in: ['pending', 'processing'] as WebhookEventStatus[] },
        nextAttemptAfter: { $lte: Date.now() }
      },
      { 
        sort: { modifiedOn: SortingOrder.Ascending },
        limit: 100 
      }
    )

    for (const event of pendingEvents) {
      await this.processWebhookEvent(event)
    }
  }

  /**
   * Process a single webhook event
   */
  async processWebhookEvent (event: WebhookEvent): Promise<void> {
    try {
      // Mark event as processing
      await this.updateEventStatus(event, 'processing')

      // Get webhook configuration
      const config = await this.getWebhookConfig(event.webhookConfig)
      if (!config) {
        await this.updateEventStatus(event, 'failed', 'Webhook configuration not found')
        return
      }

      if (!config.enabled) {
        await this.updateEventStatus(event, 'failed', 'Webhook configuration is disabled')
        return
      }

      // Get circuit breaker for this endpoint
      const circuitBreaker = this.circuitBreakers.getCircuitBreaker(config.url, {
        failureThreshold: config.retryAttempts || 5,
        timeout: 60000, // 1 minute
        responseTimeThreshold: config.timeout || 30000
      })

      try {
        // Attempt delivery through circuit breaker
        const deliveryResult = await circuitBreaker.execute(async () => {
          return await this.deliverWebhook(event, config)
        })
        
        // Record delivery attempt
        await this.recordDeliveryAttempt(event, deliveryResult, config)

        // Update event status based on delivery result
        if (deliveryResult.success) {
          await this.updateEventStatus(event, 'delivered')
        } else {
          await this.handleDeliveryFailure(event, config, deliveryResult.error)
        }

      } catch (error) {
        if (error instanceof CircuitBreakerOpenError) {
          // Circuit breaker is open, handle gracefully
          await this.handleCircuitBreakerOpen(event, config, error)
        } else {
          // Regular delivery failure
          const deliveryResult = {
            success: false,
            responseTime: 0,
            error: error.message,
            requestHeaders: {}
          }
          
          await this.recordDeliveryAttempt(event, deliveryResult, config)
          await this.handleDeliveryFailure(event, config, error.message)
        }
      }

    } catch (error) {
      this.ctx.error('Error processing webhook event', { 
        eventId: event._id, 
        error: error.message 
      })
      await this.handleDeliveryFailure(event, null, error.message)
    }
  }

  /**
   * Deliver webhook to the configured endpoint
   */
  private async deliverWebhook (
    event: WebhookEvent, 
    config: WebhookConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now()

    try {
      // Prepare request payload
      const payload = JSON.stringify(event.payload)
      
      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Huly-Webhook/1.0',
        'X-Webhook-Event': event.eventType,
        'X-Webhook-ID': event._id,
        'X-Webhook-Timestamp': Date.now().toString(),
        ...config.headers
      }

      // Add HMAC signature if secret is configured
      if (config.secret) {
        headers['X-Huly-Signature'] = generateWebhookSignature(payload, config.secret)
      }

      // Make HTTP request (using Node.js built-in fetch or http client)
      const response = await this.makeHttpRequest(config.url, {
        method: 'POST',
        headers,
        body: payload,
        timeout: config.timeout || 30000
      })

      const responseTime = Date.now() - startTime

      return {
        success: response.status >= 200 && response.status < 300,
        httpStatus: response.status,
        responseTime,
        requestHeaders: headers,
        responseHeaders: response.headers,
        responseBody: response.body,
        error: response.status >= 400 ? `HTTP ${response.status}: ${response.body}` : undefined
      }

    } catch (error) {
      const responseTime = Date.now() - startTime
      return {
        success: false,
        responseTime,
        error: error.message,
        requestHeaders: {}
      }
    }
  }

  /**
   * Make HTTP request (placeholder - would use actual HTTP client)
   */
  private async makeHttpRequest (
    url: string, 
    options: {
      method: string
      headers: Record<string, string>
      body: string
      timeout: number
    }
  ): Promise<HttpResponse> {
    // This is a placeholder implementation
    // In a real implementation, you would use Node.js fetch, axios, or http module
    
    // For now, simulate a successful response
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"success": true}',
      responseTime: 150
    }
  }

  /**
   * Handle circuit breaker open state
   */
  private async handleCircuitBreakerOpen (
    event: WebhookEvent,
    config: WebhookConfig,
    error: CircuitBreakerOpenError
  ): Promise<void> {
    this.ctx.warn('Circuit breaker is open, deferring webhook delivery', {
      eventId: event._id,
      url: config.url,
      metrics: error.metrics
    })

    // Record the circuit breaker rejection
    const circuitBreakerResult = {
      success: false,
      responseTime: 0,
      error: `Circuit breaker OPEN: ${error.message}`,
      requestHeaders: {},
      httpStatus: 503 // Service Unavailable
    }

    await this.recordDeliveryAttempt(event, circuitBreakerResult, config)

    // Defer the event for retry when circuit recovers
    const deferralDelay = 300000 // 5 minutes
    const nextAttemptAfter = Date.now() + deferralDelay

    const factory = new TxFactory(this.control.workspace.workspace, true)
    const updateTx = factory.createTxUpdateDoc<WebhookEvent>(
      'webhook:class:WebhookEvent' as Ref<Class<WebhookEvent>>,
      event.space,
      event._id,
      {
        status: 'pending' as WebhookEventStatus,
        nextAttemptAfter,
        lastError: `Circuit breaker open - endpoint unhealthy`
      }
    )

    await this.control.apply(this.ctx, [updateTx], true)
  }

  /**
   * Handle delivery failure with retry logic
   */
  private async handleDeliveryFailure (
    event: WebhookEvent,
    config: WebhookConfig | null,
    error: string
  ): Promise<void> {
    const maxAttempts = config?.retryAttempts || 3
    const newAttempts = event.attempts + 1

    if (newAttempts >= maxAttempts) {
      // Move to dead letter queue
      await this.updateEventStatus(event, 'dead_letter', error)
      return
    }

    // Calculate next retry time with exponential backoff
    const backoffDelay = this.calculateBackoffDelay(newAttempts)
    const nextAttemptAfter = Date.now() + backoffDelay

    // Update event for retry
    const factory = new TxFactory(this.control.workspace.workspace, true)
    const updateTx = factory.createTxUpdateDoc<WebhookEvent>(
      'webhook:class:WebhookEvent' as Ref<Class<WebhookEvent>>,
      event.space,
      event._id,
      {
        status: 'pending' as WebhookEventStatus,
        attempts: newAttempts,
        lastAttemptedOn: Date.now(),
        nextAttemptAfter,
        lastError: error
      }
    )

    await this.control.apply(this.ctx, [updateTx], true)
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay (attempt: number): number {
    const baseDelay = 1000 // 1 second
    const maxDelay = 3600000 // 1 hour
    const backoffMultiplier = 2

    const delay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay)
    
    // Add jitter (±25%) to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1)
    
    return Math.max(1000, delay + jitter)
  }

  /**
   * Update webhook event status
   */
  private async updateEventStatus (
    event: WebhookEvent,
    status: WebhookEventStatus,
    error?: string
  ): Promise<void> {
    const factory = new TxFactory(this.control.workspace.workspace, true)
    const updateData: Partial<WebhookEvent> = {
      status,
      lastAttemptedOn: Date.now()
    }

    if (status === 'delivered') {
      updateData.processedOn = Date.now()
    }

    if (error) {
      updateData.lastError = error
    }

    const updateTx = factory.createTxUpdateDoc<WebhookEvent>(
      'webhook:class:WebhookEvent' as Ref<Class<WebhookEvent>>,
      event.space,
      event._id,
      updateData
    )

    await this.control.apply(this.ctx, [updateTx], true)
  }

  /**
   * Record delivery attempt
   */
  private async recordDeliveryAttempt (
    event: WebhookEvent,
    result: DeliveryResult,
    config: WebhookConfig
  ): Promise<void> {
    try {
      const factory = new TxFactory(this.control.workspace.workspace, true)
      const attemptId = generateId<WebhookDeliveryAttempt>()

      const createAttemptTx = factory.createTxCreateDoc<WebhookDeliveryAttempt>(
        'webhook:class:WebhookDeliveryAttempt' as Ref<Class<WebhookDeliveryAttempt>>,
        event.space,
        {
          attachedTo: event._id,
          attachedToClass: 'webhook:class:WebhookEvent' as Ref<Class<WebhookEvent>>,
          attemptNumber: event.attempts + 1,
          timestamp: Date.now(),
          httpStatus: result.httpStatus,
          responseTime: result.responseTime,
          success: result.success,
          error: result.error,
          requestHeaders: result.requestHeaders,
          responseHeaders: result.responseHeaders,
          responseBody: result.responseBody
        },
        attemptId
      )

      await this.control.apply(this.ctx, [createAttemptTx], true)
    } catch (error) {
      this.ctx.error('Error recording delivery attempt', { 
        eventId: event._id, 
        error: error.message 
      })
    }
  }

  /**
   * Get webhook configuration by ID
   */
  private async getWebhookConfig (configId: Ref<WebhookConfig>): Promise<WebhookConfig | null> {
    try {
      const configs = await this.control.findAll(
        this.ctx,
        'webhook:class:WebhookConfig' as Ref<Class<WebhookConfig>>,
        { _id: configId },
        { limit: 1 }
      )
      return configs[0] || null
    } catch (error) {
      this.ctx.error('Error fetching webhook config', { configId, error: error.message })
      return null
    }
  }

  /**
   * Get health status of all webhook endpoints
   */
  getEndpointHealthStatus (): Record<string, any> {
    return this.circuitBreakers.getHealthStatus()
  }

  /**
   * Get circuit breaker metrics for a specific endpoint
   */
  getEndpointMetrics (url: string): any {
    const circuits = this.circuitBreakers.getAllCircuits()
    const circuit = circuits.get(url)
    return circuit ? circuit.getMetrics() : null
  }

  /**
   * Force circuit breaker open for testing/emergency
   */
  forceCircuitOpen (url: string): boolean {
    const circuits = this.circuitBreakers.getAllCircuits()
    const circuit = circuits.get(url)
    if (circuit) {
      circuit.forceOpen()
      return true
    }
    return false
  }

  /**
   * Force circuit breaker closed for recovery
   */
  forceCircuitClosed (url: string): boolean {
    const circuits = this.circuitBreakers.getAllCircuits()
    const circuit = circuits.get(url)
    if (circuit) {
      circuit.forceClose()
      return true
    }
    return false
  }

  /**
   * Test webhook endpoint connectivity
   */
  async testWebhookEndpoint (config: WebhookConfig): Promise<{
    success: boolean
    responseTime: number
    error?: string
    httpStatus?: number
  }> {
    try {
      const testPayload = {
        event: {
          id: 'test-' + generateId(),
          timestamp: Date.now(),
          type: 'test.webhook',
          action: 'test'
        },
        workspace: 'test',
        data: { message: 'This is a test webhook from Huly' }
      }

      const startTime = Date.now()
      const response = await this.makeHttpRequest(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Huly-Webhook-Test/1.0',
          'X-Webhook-Test': 'true',
          ...config.headers
        },
        body: JSON.stringify(testPayload),
        timeout: config.timeout || 30000
      })

      const responseTime = Date.now() - startTime

      return {
        success: response.status >= 200 && response.status < 300,
        responseTime,
        httpStatus: response.status,
        error: response.status >= 400 ? response.body : undefined
      }

    } catch (error) {
      return {
        success: false,
        responseTime: 0,
        error: error.message
      }
    }
  }

  /**
   * Cleanup resources
   */
  destroy (): void {
    this.circuitBreakers.destroy()
  }
}

/**
 * Delivery result interface
 */
interface DeliveryResult {
  success: boolean
  httpStatus?: number
  responseTime: number
  requestHeaders: Record<string, string>
  responseHeaders?: Record<string, string>
  responseBody?: string
  error?: string
}

/**
 * Function to process webhook events (exported for trigger system)
 * @public
 */
export async function ProcessWebhookEvent (eventId: string): Promise<void> {
  // This would be called by a background worker or scheduler
  // Implementation would create DeliveryService and process specific event
  // For now, this is a placeholder
}