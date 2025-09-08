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
  type Domain,
  type Ref,
  type Class,
  type Doc,
  type Space,
  type Timestamp,
  IndexKind
} from '@hcengineering/core'
import {
  ArrOf,
  Collection,
  Hidden,
  Index,
  Model,
  Prop,
  ReadOnly,
  TypeBoolean,
  TypeDate,
  TypeNumber,
  TypeRecord,
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import attachment from '@hcengineering/model-attachment'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import tracker, { type Project } from '@hcengineering/model-tracker'
import {
  type WebhookConfig,
  type WebhookEvent,
  type WebhookDeliveryAttempt,
  type WebhookDeliveryStats,
  type WebhookEventType,
  type WebhookEventStatus
} from '@hcengineering/webhook'
import webhook from './plugin'

export const DOMAIN_WEBHOOK = 'webhook' as Domain

/**
 * @public
 */
@Model(webhook.class.WebhookConfig, core.class.Doc, DOMAIN_WEBHOOK)
@UX(webhook.string.WebhookConfig)
export class TWebhookConfig extends TDoc implements WebhookConfig {
  @Prop(TypeString(), webhook.string.URL)
  @Index(IndexKind.FullText)
    url!: string

  @Prop(TypeString(), webhook.string.Secret)
  @Hidden()
    secret?: string

  @Prop(TypeRecord(), webhook.string.Headers)
    headers?: Record<string, string>

  @Prop(TypeBoolean(), webhook.string.Enabled)
  @Index(IndexKind.Indexed)
    enabled!: boolean

  @Prop(ArrOf(TypeString()), webhook.string.Events)
    events!: WebhookEventType[]

  @Prop(TypeRef(core.class.Space), core.string.Space)
    space?: Ref<Space>

  @Prop(ArrOf(TypeRef(tracker.class.Project)), tracker.string.Projects)
    projects?: Ref<Project>[]

  @Prop(TypeNumber(), webhook.string.RetryAttempts)
    retryAttempts?: number

  @Prop(TypeNumber(), webhook.string.Timeout)
    timeout?: number

  @Prop(TypeNumber(), webhook.string.RateLimit)
    rateLimit?: number

  @Prop(TypeNumber(), webhook.string.RateLimitPeriod)
    rateLimitPeriod?: number
}

/**
 * @public
 */
@Model(webhook.class.WebhookEvent, core.class.AttachedDoc, DOMAIN_WEBHOOK)
@UX(webhook.string.WebhookEvent)
export class TWebhookEvent extends TAttachedDoc implements WebhookEvent {
  @Prop(TypeString(), webhook.string.EventType)
  @Index(IndexKind.Indexed)
    eventType!: WebhookEventType

  @Prop(TypeRef(core.class.Doc), core.string.Object)
  @Index(IndexKind.Indexed)
    objectId!: Ref<Doc>

  @Prop(TypeRef(core.class.Class), core.string.Class)
  @Index(IndexKind.Indexed)
    objectClass!: Ref<Class<Doc>>

  @Prop(TypeRecord(), webhook.string.Payload)
    payload!: any

  @Prop(TypeString(), webhook.string.Status)
  @Index(IndexKind.Indexed)
    status!: WebhookEventStatus

  @Prop(TypeDate(), core.string.ModifiedOn)
    processedOn?: Timestamp

  @Prop(TypeRef(webhook.class.WebhookConfig), webhook.string.WebhookConfig)
  @Index(IndexKind.Indexed)
    webhookConfig!: Ref<WebhookConfig>

  @Prop(TypeNumber(), webhook.string.Attempts)
    attempts!: number

  @Prop(TypeDate(), webhook.string.LastAttemptedOn)
    lastAttemptedOn?: Timestamp

  @Prop(TypeDate(), webhook.string.NextAttemptAfter)
    nextAttemptAfter?: Timestamp

  @Prop(TypeString(), webhook.string.LastError)
    lastError?: string
}

/**
 * @public
 */
@Model(webhook.class.WebhookDeliveryAttempt, core.class.AttachedDoc, DOMAIN_WEBHOOK)
@UX(webhook.string.WebhookDeliveryAttempt)
export class TWebhookDeliveryAttempt extends TAttachedDoc implements WebhookDeliveryAttempt {
  declare attachedTo: Ref<WebhookEvent>

  @Prop(TypeNumber(), webhook.string.AttemptNumber)
    attemptNumber!: number

  @Prop(TypeDate(), core.string.ModifiedOn)
    timestamp!: Timestamp

  @Prop(TypeNumber(), webhook.string.HttpStatus)
    httpStatus?: number

  @Prop(TypeNumber(), webhook.string.ResponseTime)
    responseTime?: number

  @Prop(TypeBoolean(), webhook.string.Success)
  @Index(IndexKind.Indexed)
    success!: boolean

  @Prop(TypeString(), webhook.string.Error)
    error?: string

  @Prop(TypeRecord(), webhook.string.RequestHeaders)
  @Hidden()
    requestHeaders?: Record<string, string>

  @Prop(TypeRecord(), webhook.string.ResponseHeaders)
  @Hidden()
    responseHeaders?: Record<string, string>

  @Prop(TypeString(), webhook.string.ResponseBody)
  @Hidden()
    responseBody?: string
}

/**
 * @public
 */
@Model(webhook.class.WebhookDeliveryStats, core.class.Doc, DOMAIN_WEBHOOK)
@UX(webhook.string.WebhookDeliveryStats)
export class TWebhookDeliveryStats extends TDoc implements WebhookDeliveryStats {
  @Prop(TypeRef(webhook.class.WebhookConfig), webhook.string.WebhookConfig)
  @Index(IndexKind.Indexed)
    webhookConfig!: Ref<WebhookConfig>

  @Prop(TypeDate(), webhook.string.PeriodStart)
    periodStart!: Timestamp

  @Prop(TypeDate(), webhook.string.PeriodEnd)
    periodEnd!: Timestamp

  @Prop(TypeNumber(), webhook.string.TotalEvents)
    totalEvents!: number

  @Prop(TypeNumber(), webhook.string.DeliveredEvents)
    deliveredEvents!: number

  @Prop(TypeNumber(), webhook.string.FailedEvents)
    failedEvents!: number

  @Prop(TypeNumber(), webhook.string.AverageResponseTime)
    averageResponseTime!: number

  @Prop(TypeNumber(), webhook.string.SuccessRate)
    successRate!: number

  @Prop(TypeDate(), webhook.string.LastDeliveryAttempt)
    lastDeliveryAttempt?: Timestamp

  @Prop(TypeDate(), webhook.string.LastSuccessfulDelivery)
    lastSuccessfulDelivery?: Timestamp
}