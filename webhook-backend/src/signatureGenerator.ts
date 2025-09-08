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

import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Generate HMAC-SHA256 signature for webhook payload
 * @public
 */
export function generateWebhookSignature (payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

/**
 * Verify HMAC-SHA256 signature for webhook payload
 * @public
 */
export function verifyWebhookSignature (
  payload: string, 
  signature: string, 
  secret: string
): boolean {
  const expectedSignature = generateWebhookSignature(payload, secret)
  
  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch (error) {
    // timingSafeEqual throws if strings have different lengths
    return false
  }
}

/**
 * Generate a secure random secret for webhook configuration
 * @public
 */
export function generateWebhookSecret (length: number = 32): string {
  const crypto = require('crypto')
  return crypto.randomBytes(length).toString('hex')
}