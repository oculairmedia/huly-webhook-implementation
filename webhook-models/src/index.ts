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

import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/model-core'
import task from '@hcengineering/model-task'
import view from '@hcengineering/model-view'
import { webhookId, type WebhookConfig, type WebhookEvent, type WebhookDeliveryAttempt, type WebhookDeliveryStats } from '@hcengineering/webhook'

import { TWebhookConfig, TWebhookEvent, TWebhookDeliveryAttempt, TWebhookDeliveryStats } from './types'
import webhook from './plugin'

export { webhookId } from '@hcengineering/webhook'
export { webhook as default }

/**
 * @public
 */
export function createModel (builder: Builder): void {
  builder.createModel(TWebhookConfig, TWebhookEvent, TWebhookDeliveryAttempt, TWebhookDeliveryStats)

  builder.mixin(webhook.class.WebhookConfig, core.class.Class, view.mixin.AttributePresenter, {
    presenter: webhook.component.WebhookConfigPresenter
  })

  builder.mixin(webhook.class.WebhookEvent, core.class.Class, view.mixin.AttributePresenter, {
    presenter: webhook.component.WebhookEventPresenter
  })

  builder.mixin(webhook.class.WebhookDeliveryAttempt, core.class.Class, view.mixin.AttributePresenter, {
    presenter: webhook.component.WebhookDeliveryAttemptPresenter
  })

  builder.createDoc(webhook.class.WebhookConfig, core.space.Model, {
    _id: webhook.ids.DefaultWebhookConfig,
    url: '',
    enabled: false,
    events: [],
    retryAttempts: 3,
    timeout: 30000,
    rateLimit: 100,
    rateLimitPeriod: 3600000 // 1 hour
  })
}