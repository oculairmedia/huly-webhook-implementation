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

import { Plugin, Resource, plugin } from '@hcengineering/platform'
import type { TriggerFunc } from '@hcengineering/server-core'

export * from './webhookTrigger'
export * from './deliveryService'
export * from './signatureGenerator'
export * from './circuitBreaker'

/**
 * @public
 */
export const serverWebhookId = 'server-webhook-resources' as Plugin

/**
 * @public
 */
export default plugin(serverWebhookId, {
  trigger: {
    WebhookHandler: '' as Resource<TriggerFunc>
  },
  function: {
    GenerateWebhookSignature: '' as Resource<(payload: string, secret: string) => string>,
    ProcessWebhookEvent: '' as Resource<(eventId: string) => Promise<void>>,
    ValidateWebhookConfig: '' as Resource<(configId: string) => Promise<boolean>>,
    TestWebhookEndpoint: '' as Resource<(configId: string) => Promise<any>>,
    GetEndpointHealthStatus: '' as Resource<() => Record<string, any>>,
    GetEndpointMetrics: '' as Resource<(url: string) => any>
  }
})