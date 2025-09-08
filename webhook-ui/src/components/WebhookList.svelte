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
  import type { Class, Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import type { WebhookConfig } from '@hcengineering/webhook'
  import { Button, Icon, Label, showPopup, IconAdd, IconMoreH } from '@hcengineering/ui'
  import { Table, showMenu } from '@hcengineering/view-resources'
  import webhook from '@hcengineering/webhook'
  
  import WebhookForm from './WebhookForm.svelte'
  import WebhookTester from './WebhookTester.svelte'
  import WebhookEventLog from './WebhookEventLog.svelte'
  import WebhookStats from './WebhookStats.svelte'

  let webhookConfigs: WebhookConfig[] = []
  let selectedConfig: WebhookConfig | undefined
  
  const query = createQuery()
  
  $: query.query(
    webhook.class.WebhookConfig,
    {},
    (result) => {
      webhookConfigs = result
    },
    {
      sort: { modifiedOn: -1 }
    }
  )

  function createWebhook () {
    showPopup(WebhookForm, {
      webhook: undefined,
      readonly: false
    })
  }

  function editWebhook (config: WebhookConfig) {
    showPopup(WebhookForm, {
      webhook: config,
      readonly: false
    })
  }

  function viewWebhookLogs (config: WebhookConfig) {
    showPopup(WebhookEventLog, {
      webhookConfig: config
    })
  }

  function viewWebhookStats (config: WebhookConfig) {
    showPopup(WebhookStats, {
      webhookConfig: config
    })
  }

  function testWebhook (config: WebhookConfig) {
    showPopup(WebhookTester, {
      webhookConfig: config
    })
  }

  function showWebhookMenu (ev: MouseEvent, config: WebhookConfig) {
    showMenu(ev, [
      {
        label: webhook.string.Edit,
        action: () => editWebhook(config)
      },
      {
        label: webhook.string.Test,
        action: () => testWebhook(config)
      },
      {
        label: webhook.string.ViewLogs,
        action: () => viewWebhookLogs(config)
      },
      {
        label: webhook.string.ViewStats,
        action: () => viewWebhookStats(config)
      },
      {},
      {
        label: webhook.string.Delete,
        action: () => {
          // TODO: Implement delete confirmation and action
        }
      }
    ])
  }

  function getStatusColor (config: WebhookConfig): string {
    if (!config.enabled) return 'var(--theme-warning-color)'
    // TODO: Get actual health status from circuit breaker
    return 'var(--theme-success-color)'
  }

  function getStatusText (config: WebhookConfig): string {
    if (!config.enabled) return 'Disabled'
    // TODO: Get actual health status from circuit breaker
    return 'Active'
  }
</script>

<div class="antiComponent">
  <div class="ac-header">
    <div class="ac-header__wrap-title">
      <span class="ac-header__title">
        <Label label={webhook.string.Webhooks} />
      </span>
    </div>
    <div class="ac-header__wrap-actions">
      <Button
        icon={IconAdd}
        label={webhook.string.CreateWebhook}
        kind="primary"
        on:click={createWebhook}
      />
    </div>
  </div>

  <div class="ac-body">
    {#if webhookConfigs.length === 0}
      <div class="flex-center p-4">
        <div class="fs-title content-color">
          <Label label={webhook.string.NoWebhooksConfigured} />
        </div>
        <div class="content-trans-color mt-2">
          <Label label={webhook.string.CreateFirstWebhook} />
        </div>
        <Button
          icon={IconAdd}
          label={webhook.string.CreateWebhook}
          kind="primary"
          size="large"
          on:click={createWebhook}
          class="mt-4"
        />
      </div>
    {:else}
      <Table
        _class={webhook.class.WebhookConfig}
        config={[
          { key: 'url', label: webhook.string.URL, sortable: true },
          { key: 'enabled', label: webhook.string.Status, sortable: true },
          { key: 'events', label: webhook.string.Events, sortable: false },
          { key: 'modifiedOn', label: webhook.string.Modified, sortable: true },
          { key: 'actions', label: '', sortable: false }
        ]}
        query={{}}
      >
        <svelte:fragment slot="cell" let:row let:key>
          {#if key === 'url'}
            <div class="flex-row-center">
              <div class="webhook-url" title={row.url}>
                {row.url}
              </div>
            </div>
          {:else if key === 'enabled'}
            <div class="flex-row-center">
              <div 
                class="status-indicator"
                style="background-color: {getStatusColor(row)}"
              ></div>
              <span class="ml-2">
                {getStatusText(row)}
              </span>
            </div>
          {:else if key === 'events'}
            <div class="flex-row-center">
              <div class="event-badges">
                {#each row.events.slice(0, 3) as eventType}
                  <span class="event-badge">
                    {eventType}
                  </span>
                {/each}
                {#if row.events.length > 3}
                  <span class="event-badge-more">
                    +{row.events.length - 3} more
                  </span>
                {/if}
              </div>
            </div>
          {:else if key === 'modifiedOn'}
            <div class="content-trans-color">
              {new Date(row.modifiedOn).toLocaleDateString()}
            </div>
          {:else if key === 'actions'}
            <div class="flex-row-center">
              <Button
                icon={IconMoreH}
                kind="ghost"
                size="small"
                on:click={(ev) => showWebhookMenu(ev, row)}
              />
            </div>
          {/if}
        </svelte:fragment>
      </Table>
    {/if}
  </div>
</div>

<style>
  .webhook-url {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .event-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .event-badge {
    background: var(--theme-button-default);
    color: var(--theme-content-color);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .event-badge-more {
    color: var(--theme-content-trans-color);
    font-size: 0.75rem;
    font-style: italic;
  }
</style>