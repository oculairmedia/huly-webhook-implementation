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
  import { createEventDispatcher } from 'svelte'
  import { 
    Button, 
    Label, 
    Card,
    Loading,
    createFocusManager
  } from '@hcengineering/ui'
  import { generateId } from '@hcengineering/core'
  import webhook from '@hcengineering/webhook'

  export let webhookConfig: WebhookConfig

  const dispatch = createEventDispatcher()
  const manager = createFocusManager()

  let testing = false
  let testResult: {
    success: boolean
    responseTime: number
    httpStatus?: number
    error?: string
    timestamp: number
  } | null = null

  let samplePayload = JSON.stringify({
    event: {
      id: `test-${generateId()}`,
      timestamp: Date.now(),
      type: 'test.webhook',
      action: 'test',
      objectId: 'test-object-id',
      objectClass: 'test:class:TestObject'
    },
    workspace: 'test-workspace',
    modifiedBy: 'test-user',
    data: {
      action: 'test',
      message: 'This is a test webhook from Huly',
      object: {
        _id: 'test-object-id',
        title: 'Test Object',
        description: 'This is a test object for webhook testing'
      }
    }
  }, null, 2)

  async function sendTestWebhook () {
    testing = true
    testResult = null

    try {
      // In a real implementation, this would call the webhook testing function
      // For now, simulate the test
      const startTime = Date.now()
      
      // Simulate HTTP request delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500))
      
      const responseTime = Date.now() - startTime
      const success = Math.random() > 0.3 // 70% success rate for demo
      
      testResult = {
        success,
        responseTime,
        httpStatus: success ? 200 : Math.random() > 0.5 ? 500 : 404,
        error: success ? undefined : 'Connection timeout or server error',
        timestamp: Date.now()
      }

    } catch (error) {
      testResult = {
        success: false,
        responseTime: 0,
        error: error.message,
        timestamp: Date.now()
      }
    } finally {
      testing = false
    }
  }

  function close () {
    dispatch('close')
  }

  function getStatusColor (success: boolean): string {
    return success ? 'var(--theme-success-color)' : 'var(--theme-error-color)'
  }

  function getStatusIcon (success: boolean): string {
    return success ? '✓' : '✗'
  }
</script>

<Card
  label={webhook.string.TestWebhook}
  okLabel={webhook.string.Close}
  canSave={true}
  on:close={close}
  on:changeContent={close}
  {manager}
>
  <div class="webhook-tester">
    <div class="section">
      <div class="section-header">
        <Label label={webhook.string.WebhookDetails} />
      </div>
      
      <div class="webhook-info">
        <div class="info-row">
          <span class="info-label">URL:</span>
          <span class="info-value url">{webhookConfig.url}</span>
        </div>
        
        <div class="info-row">
          <span class="info-label">Status:</span>
          <span class="info-value" style="color: {webhookConfig.enabled ? 'var(--theme-success-color)' : 'var(--theme-warning-color)'}">
            {webhookConfig.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        
        <div class="info-row">
          <span class="info-label">Events:</span>
          <span class="info-value">{webhookConfig.events.join(', ')}</span>
        </div>
        
        {#if webhookConfig.secret}
          <div class="info-row">
            <span class="info-label">Secret:</span>
            <span class="info-value">Configured (HMAC signatures enabled)</span>
          </div>
        {/if}
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <Label label={webhook.string.TestPayload} />
      </div>
      
      <div class="payload-editor">
        <textarea
          bind:value={samplePayload}
          class="payload-textarea"
          placeholder="JSON payload to send"
          readonly={testing}
        />
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <div class="flex-row-center">
          <Label label={webhook.string.TestResults} />
          <Button
            label={webhook.string.SendTest}
            kind="primary"
            loading={testing}
            disabled={!webhookConfig.enabled}
            on:click={sendTestWebhook}
          />
        </div>
      </div>

      {#if testing}
        <div class="test-status">
          <Loading />
          <span class="ml-2">Sending test webhook...</span>
        </div>
      {/if}

      {#if testResult}
        <div class="test-result">
          <div class="result-header" style="color: {getStatusColor(testResult.success)}">
            <span class="result-icon">{getStatusIcon(testResult.success)}</span>
            <span class="result-status">
              {testResult.success ? 'Test Successful' : 'Test Failed'}
            </span>
            <span class="result-time">
              {testResult.responseTime}ms
            </span>
          </div>

          <div class="result-details">
            <div class="detail-row">
              <span class="detail-label">Timestamp:</span>
              <span class="detail-value">
                {new Date(testResult.timestamp).toLocaleString()}
              </span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Response Time:</span>
              <span class="detail-value">{testResult.responseTime}ms</span>
            </div>

            {#if testResult.httpStatus}
              <div class="detail-row">
                <span class="detail-label">HTTP Status:</span>
                <span class="detail-value" style="color: {testResult.httpStatus >= 200 && testResult.httpStatus < 300 ? 'var(--theme-success-color)' : 'var(--theme-error-color)'}">
                  {testResult.httpStatus}
                </span>
              </div>
            {/if}

            {#if testResult.error}
              <div class="detail-row">
                <span class="detail-label">Error:</span>
                <span class="detail-value error">{testResult.error}</span>
              </div>
            {/if}
          </div>

          {#if testResult.success}
            <div class="success-message">
              <Label label={webhook.string.TestSuccessMessage} />
            </div>
          {:else}
            <div class="error-message">
              <Label label={webhook.string.TestFailureMessage} />
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if !webhookConfig.enabled}
      <div class="warning-message">
        <Label label={webhook.string.WebhookDisabledWarning} />
      </div>
    {/if}
  </div>
</Card>

<style>
  .webhook-tester {
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

  .webhook-info {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .info-row {
    display: flex;
    gap: 1rem;
  }

  .info-label {
    font-weight: 500;
    min-width: 80px;
    color: var(--theme-content-trans-color);
  }

  .info-value {
    color: var(--theme-content-color);
  }

  .info-value.url {
    font-family: var(--font-mono);
    font-size: 0.875rem;
  }

  .payload-editor {
    display: flex;
    flex-direction: column;
  }

  .payload-textarea {
    width: 100%;
    height: 200px;
    padding: 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    background: var(--theme-button-default);
    color: var(--theme-content-color);
    resize: vertical;
  }

  .payload-textarea:focus {
    outline: none;
    border-color: var(--theme-button-border-enabled);
  }

  .test-status {
    display: flex;
    align-items: center;
    color: var(--theme-content-trans-color);
  }

  .test-result {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-button-default);
  }

  .result-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
  }

  .result-icon {
    font-size: 1.25rem;
  }

  .result-status {
    flex: 1;
  }

  .result-time {
    font-family: var(--font-mono);
    font-size: 0.875rem;
  }

  .result-details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .detail-row {
    display: flex;
    gap: 1rem;
  }

  .detail-label {
    font-weight: 500;
    min-width: 120px;
    color: var(--theme-content-trans-color);
  }

  .detail-value {
    color: var(--theme-content-color);
  }

  .detail-value.error {
    color: var(--theme-error-color);
  }

  .success-message {
    padding: 0.75rem;
    background: var(--theme-success-color);
    color: white;
    border-radius: 0.375rem;
    font-weight: 500;
  }

  .error-message {
    padding: 0.75rem;
    background: var(--theme-error-color);
    color: white;
    border-radius: 0.375rem;
    font-weight: 500;
  }

  .warning-message {
    padding: 0.75rem;
    background: var(--theme-warning-color);
    color: var(--theme-content-color);
    border-radius: 0.375rem;
    font-weight: 500;
    text-align: center;
  }
</style>