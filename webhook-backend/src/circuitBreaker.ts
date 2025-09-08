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

import { MeasureContext } from '@hcengineering/core'

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed',      // Normal operation
  OPEN = 'open',          // Blocking requests
  HALF_OPEN = 'half_open' // Testing recovery
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number      // Number of failures to open circuit
  successThreshold: number      // Successes needed to close circuit
  timeout: number              // Duration to keep circuit open (ms)
  requestVolumeThreshold: number // Minimum requests before evaluation
  healthCheckInterval: number   // Health check frequency (ms)
  responseTimeThreshold: number // Max response time before failure (ms)
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  totalRequests: number
  successCount: number
  failureCount: number
  consecutiveFailures: number
  lastFailureTime: number
  lastSuccessTime: number
  averageResponseTime: number
  state: CircuitState
  stateChangedAt: number
}

/**
 * Request result interface
 */
export interface RequestResult {
  success: boolean
  responseTime: number
  error?: string
}

/**
 * Circuit breaker implementation for webhook endpoints
 * @public
 */
export class CircuitBreaker {
  private metrics: CircuitBreakerMetrics
  private config: CircuitBreakerConfig
  private ctx: MeasureContext
  private endpointUrl: string
  private healthCheckTimer?: NodeJS.Timeout
  private responseTimes: number[] = []
  private readonly maxResponseTimeHistory = 100

  constructor (
    endpointUrl: string,
    config: Partial<CircuitBreakerConfig> = {},
    ctx: MeasureContext
  ) {
    this.endpointUrl = endpointUrl
    this.ctx = ctx
    
    // Default configuration
    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 60000, // 1 minute
      requestVolumeThreshold: 10,
      healthCheckInterval: 30000, // 30 seconds
      responseTimeThreshold: 10000, // 10 seconds
      ...config
    }

    // Initialize metrics
    this.metrics = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      averageResponseTime: 0,
      state: CircuitState.CLOSED,
      stateChangedAt: Date.now()
    }

    this.startHealthCheck()
  }

  /**
   * Execute a request through the circuit breaker
   */
  async execute<T> (operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.shouldRejectRequest()) {
      const error = new CircuitBreakerOpenError(
        `Circuit breaker is OPEN for ${this.endpointUrl}`,
        this.metrics
      )
      this.ctx.warn('Circuit breaker rejected request', {
        url: this.endpointUrl,
        state: this.metrics.state
      })
      throw error
    }

    const startTime = Date.now()
    let result: RequestResult

    try {
      // Execute the operation
      const response = await Promise.race([
        operation(),
        this.timeoutPromise()
      ])

      const responseTime = Date.now() - startTime
      result = { success: true, responseTime }

      this.recordSuccess(result)
      return response

    } catch (error) {
      const responseTime = Date.now() - startTime
      result = { 
        success: false, 
        responseTime, 
        error: error.message 
      }

      this.recordFailure(result)
      throw error
    }
  }

  /**
   * Check if request should be rejected
   */
  private shouldRejectRequest (): boolean {
    const now = Date.now()

    switch (this.metrics.state) {
      case CircuitState.OPEN:
        // Check if timeout period has elapsed
        if (now - this.metrics.stateChangedAt >= this.config.timeout) {
          this.transitionTo(CircuitState.HALF_OPEN)
          return false
        }
        return true

      case CircuitState.HALF_OPEN:
        // Allow limited requests in half-open state
        return false

      case CircuitState.CLOSED:
      default:
        return false
    }
  }

  /**
   * Record successful request
   */
  private recordSuccess (result: RequestResult): void {
    this.updateMetrics(result)

    switch (this.metrics.state) {
      case CircuitState.HALF_OPEN:
        if (this.metrics.consecutiveFailures === 0) {
          // Reset consecutive failures counter on first success in half-open
          this.resetConsecutiveFailures()
        }

        // Check if enough successes to close circuit
        if (this.getRecentSuccessCount() >= this.config.successThreshold) {
          this.transitionTo(CircuitState.CLOSED)
          this.resetMetrics()
        }
        break

      case CircuitState.CLOSED:
        this.resetConsecutiveFailures()
        break
    }

    this.ctx.info('Circuit breaker recorded success', {
      url: this.endpointUrl,
      state: this.metrics.state,
      responseTime: result.responseTime
    })
  }

  /**
   * Record failed request
   */
  private recordFailure (result: RequestResult): void {
    this.updateMetrics(result)
    this.metrics.consecutiveFailures++
    this.metrics.lastFailureTime = Date.now()

    // Check if we should open the circuit
    if (this.shouldOpenCircuit()) {
      this.transitionTo(CircuitState.OPEN)
    }

    this.ctx.warn('Circuit breaker recorded failure', {
      url: this.endpointUrl,
      state: this.metrics.state,
      consecutiveFailures: this.metrics.consecutiveFailures,
      error: result.error
    })
  }

  /**
   * Update metrics with request result
   */
  private updateMetrics (result: RequestResult): void {
    this.metrics.totalRequests++
    
    if (result.success) {
      this.metrics.successCount++
      this.metrics.lastSuccessTime = Date.now()
    } else {
      this.metrics.failureCount++
    }

    // Update response times
    this.responseTimes.push(result.responseTime)
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift()
    }

    // Calculate average response time
    this.metrics.averageResponseTime = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
  }

  /**
   * Check if circuit should be opened
   */
  private shouldOpenCircuit (): boolean {
    // Need minimum request volume before opening
    if (this.metrics.totalRequests < this.config.requestVolumeThreshold) {
      return false
    }

    // Check failure threshold
    if (this.metrics.consecutiveFailures >= this.config.failureThreshold) {
      return true
    }

    // Check if average response time is too high
    if (this.metrics.averageResponseTime > this.config.responseTimeThreshold) {
      return true
    }

    return false
  }

  /**
   * Transition to new circuit state
   */
  private transitionTo (newState: CircuitState): void {
    const oldState = this.metrics.state
    this.metrics.state = newState
    this.metrics.stateChangedAt = Date.now()

    this.ctx.info('Circuit breaker state transition', {
      url: this.endpointUrl,
      from: oldState,
      to: newState,
      metrics: this.getMetricsSummary()
    })

    // Emit state change event for monitoring
    this.emitStateChange(oldState, newState)
  }

  /**
   * Get recent success count (for half-open state evaluation)
   */
  private getRecentSuccessCount (): number {
    // In a real implementation, this would track recent successes
    // For now, use inverse of consecutive failures as approximation
    return Math.max(0, this.config.successThreshold - this.metrics.consecutiveFailures)
  }

  /**
   * Reset consecutive failures counter
   */
  private resetConsecutiveFailures (): void {
    this.metrics.consecutiveFailures = 0
  }

  /**
   * Reset all metrics (when circuit closes)
   */
  private resetMetrics (): void {
    this.metrics.totalRequests = 0
    this.metrics.successCount = 0
    this.metrics.failureCount = 0
    this.metrics.consecutiveFailures = 0
    this.responseTimes = []
    this.metrics.averageResponseTime = 0
  }

  /**
   * Create timeout promise for request timeout
   */
  private timeoutPromise<T> (): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${this.config.responseTimeThreshold}ms`))
      }, this.config.responseTimeThreshold)
    })
  }

  /**
   * Start health check timer
   */
  private startHealthCheck (): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, this.config.healthCheckInterval)
  }

  /**
   * Perform health check on the endpoint
   */
  private async performHealthCheck (): Promise<void> {
    if (this.metrics.state !== CircuitState.OPEN) {
      return // Only health check when circuit is open
    }

    try {
      // Perform a lightweight health check (HEAD request or ping)
      const healthResult = await this.healthCheckRequest()
      
      if (healthResult.success) {
        this.ctx.info('Health check passed, transitioning to half-open', {
          url: this.endpointUrl
        })
        this.transitionTo(CircuitState.HALF_OPEN)
      }
    } catch (error) {
      this.ctx.info('Health check failed, circuit remains open', {
        url: this.endpointUrl,
        error: error.message
      })
    }
  }

  /**
   * Perform health check request (placeholder)
   */
  private async healthCheckRequest (): Promise<RequestResult> {
    // In a real implementation, this would make a lightweight HTTP request
    // For now, return a simulated result
    return {
      success: Math.random() > 0.5, // 50% success rate for demo
      responseTime: Math.random() * 1000
    }
  }

  /**
   * Emit state change event for monitoring systems
   */
  private emitStateChange (oldState: CircuitState, newState: CircuitState): void {
    // This would integrate with monitoring/alerting systems
    // For now, just log the event
    this.ctx.info('Circuit breaker state changed', {
      url: this.endpointUrl,
      from: oldState,
      to: newState,
      timestamp: Date.now()
    })
  }

  /**
   * Get current metrics
   */
  getMetrics (): CircuitBreakerMetrics {
    return { ...this.metrics }
  }

  /**
   * Get metrics summary for logging
   */
  private getMetricsSummary (): any {
    return {
      state: this.metrics.state,
      totalRequests: this.metrics.totalRequests,
      successRate: this.metrics.totalRequests > 0 
        ? (this.metrics.successCount / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      consecutiveFailures: this.metrics.consecutiveFailures,
      averageResponseTime: Math.round(this.metrics.averageResponseTime)
    }
  }

  /**
   * Check if circuit is healthy
   */
  isHealthy (): boolean {
    return this.metrics.state === CircuitState.CLOSED
  }

  /**
   * Force circuit to open (for testing/emergency)
   */
  forceOpen (): void {
    this.transitionTo(CircuitState.OPEN)
  }

  /**
   * Force circuit to close (for testing/recovery)
   */
  forceClose (): void {
    this.transitionTo(CircuitState.CLOSED)
    this.resetMetrics()
  }

  /**
   * Cleanup resources
   */
  destroy (): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = undefined
    }
  }
}

/**
 * Circuit breaker manager for multiple endpoints
 * @public
 */
export class CircuitBreakerManager {
  private circuits = new Map<string, CircuitBreaker>()
  private ctx: MeasureContext

  constructor (ctx: MeasureContext) {
    this.ctx = ctx
  }

  /**
   * Get or create circuit breaker for endpoint
   */
  getCircuitBreaker (
    endpointUrl: string, 
    config?: Partial<CircuitBreakerConfig>
  ): CircuitBreaker {
    if (!this.circuits.has(endpointUrl)) {
      const circuit = new CircuitBreaker(endpointUrl, config, this.ctx)
      this.circuits.set(endpointUrl, circuit)
    }

    return this.circuits.get(endpointUrl)!
  }

  /**
   * Get all circuit breakers
   */
  getAllCircuits (): Map<string, CircuitBreaker> {
    return new Map(this.circuits)
  }

  /**
   * Get health status of all circuits
   */
  getHealthStatus (): Record<string, { 
    healthy: boolean
    metrics: CircuitBreakerMetrics 
  }> {
    const status: Record<string, any> = {}

    this.circuits.forEach((circuit, url) => {
      status[url] = {
        healthy: circuit.isHealthy(),
        metrics: circuit.getMetrics()
      }
    })

    return status
  }

  /**
   * Cleanup all circuits
   */
  destroy (): void {
    this.circuits.forEach(circuit => circuit.destroy())
    this.circuits.clear()
  }
}

/**
 * Custom error for circuit breaker open state
 */
export class CircuitBreakerOpenError extends Error {
  constructor (
    message: string,
    public readonly metrics: CircuitBreakerMetrics
  ) {
    super(message)
    this.name = 'CircuitBreakerOpenError'
  }
}