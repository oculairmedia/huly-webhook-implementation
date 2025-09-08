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
  type Account,
  type Class,
  type Doc,
  type Domain,
  type Ref,
  type Space,
  type Status
} from '@hcengineering/core'
import { type AnyComponent, type Resource } from '@hcengineering/platform'
import { mergeIds, type IntlString } from '@hcengineering/platform'
import { webhookId, type WebhookConfig, type WebhookEvent, type WebhookDeliveryAttempt, type WebhookDeliveryStats } from '@hcengineering/webhook'

export default mergeIds(webhookId, {
  class: {
    WebhookConfig: '' as Ref<Class<WebhookConfig>>,
    WebhookEvent: '' as Ref<Class<WebhookEvent>>,
    WebhookDeliveryAttempt: '' as Ref<Class<WebhookDeliveryAttempt>>,
    WebhookDeliveryStats: '' as Ref<Class<WebhookDeliveryStats>>
  },
  component: {
    WebhookConfigPresenter: '' as AnyComponent,
    WebhookEventPresenter: '' as AnyComponent,
    WebhookDeliveryAttemptPresenter: '' as AnyComponent
  },
  ids: {
    DefaultWebhookConfig: '' as Ref<WebhookConfig>
  },
  string: {
    // Configuration strings
    URL: '' as IntlString,
    Secret: '' as IntlString,
    Headers: '' as IntlString,
    Enabled: '' as IntlString,
    Events: '' as IntlString,
    RetryAttempts: '' as IntlString,
    Timeout: '' as IntlString,
    RateLimit: '' as IntlString,
    RateLimitPeriod: '' as IntlString,
    
    // Event strings
    EventType: '' as IntlString,
    Payload: '' as IntlString,
    Status: '' as IntlString,
    Attempts: '' as IntlString,
    LastAttemptedOn: '' as IntlString,
    NextAttemptAfter: '' as IntlString,
    LastError: '' as IntlString,
    
    // Delivery attempt strings
    AttemptNumber: '' as IntlString,
    HttpStatus: '' as IntlString,
    ResponseTime: '' as IntlString,
    Success: '' as IntlString,
    Error: '' as IntlString,
    RequestHeaders: '' as IntlString,
    ResponseHeaders: '' as IntlString,
    ResponseBody: '' as IntlString,
    
    // Stats strings
    PeriodStart: '' as IntlString,
    PeriodEnd: '' as IntlString,
    TotalEvents: '' as IntlString,
    DeliveredEvents: '' as IntlString,
    FailedEvents: '' as IntlString,
    AverageResponseTime: '' as IntlString,
    SuccessRate: '' as IntlString,
    LastDeliveryAttempt: '' as IntlString,
    LastSuccessfulDelivery: '' as IntlString
  }
})