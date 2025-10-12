// Simple in-memory auth/baseUrl store shared by OpenCode tools
// Note: This resets when the OpenCode process restarts.

let authHeader: string | null = null
let baseUrlOverride: string | null = null

export function setAuthHeader(header: string | null) {
  authHeader = header && header.trim().length > 0 ? header.trim() : null
}

export function getAuthHeader(): string | null {
  return authHeader || process.env.HULY_MCP_AUTHORIZATION || null
}

export function setBaseUrl(url: string | null) {
  baseUrlOverride = url && url.trim().length > 0 ? url.trim() : null
}

export function getBaseUrl(input?: string | null): string {
  return (
    (input && input.trim()) ||
    baseUrlOverride ||
    process.env.HULY_MCP_BASE_URL ||
    "http://localhost:3457"
  )
}
