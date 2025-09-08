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

import { Resources } from '@hcengineering/platform'

import WebhookList from './components/WebhookList.svelte'
import WebhookForm from './components/WebhookForm.svelte'
import WebhookTester from './components/WebhookTester.svelte'
import WebhookEventLog from './components/WebhookEventLog.svelte'
import WebhookStats from './components/WebhookStats.svelte'
import WebhookConfigPresenter from './components/WebhookConfigPresenter.svelte'
import WebhookEventPresenter from './components/WebhookEventPresenter.svelte'
import WebhookDeliveryAttemptPresenter from './components/WebhookDeliveryAttemptPresenter.svelte'

export default async (): Promise<Resources> => ({
  component: {
    WebhookList,
    WebhookForm,
    WebhookTester,
    WebhookEventLog,
    WebhookStats,
    WebhookConfigPresenter,
    WebhookEventPresenter,
    WebhookDeliveryAttemptPresenter
  }
})