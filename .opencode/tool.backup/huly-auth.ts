import { tool } from "@opencode-ai/plugin"
import { getAuthHeader, setAuthHeader, getBaseUrl, setBaseUrl } from "./_authStore"

const z = tool.schema

// Helper to POST to REST API tools with Authorization injection
async function postTool(baseUrl: string, toolName: string, args: any, extraHeaders?: Record<string, string>): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const auth = getAuthHeader()
  if (auth) headers["Authorization"] = auth
  if (extraHeaders) Object.assign(headers, extraHeaders)

  const res = await fetch(`${baseUrl}/api/tools/${toolName}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ arguments: args || {} }),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = { success: false, error: "Invalid JSON", raw: text } }
  if (!res.ok || json?.success === false) {
    return JSON.stringify({ ok: false, status: res.status, error: json?.error || text })
  }
  return JSON.stringify({ ok: true, status: res.status, data: json.data })
}

export const huly_auth_set = tool({
  description: "Set Authorization header to use for Huly MCP REST calls (e.g., 'Bearer <token>')",
  args: {
    authorization: z.string().describe("Authorization header value, e.g., 'Bearer <token>'"),
  },
  async execute(args) {
    setAuthHeader(args.authorization)
    return JSON.stringify({ ok: true, message: "Authorization header set" })
  }
})

export const huly_auth_clear = tool({
  description: "Clear stored Authorization header",
  args: {},
  async execute() {
    setAuthHeader(null)
    return JSON.stringify({ ok: true, message: "Authorization header cleared" })
  }
})

export const huly_baseurl_set = tool({
  description: "Set base URL for Huly MCP server (e.g., http://localhost:3457)",
  args: {
    baseUrl: z.string().url().describe("Base URL for the server")
  },
  async execute(args) {
    setBaseUrl(args.baseUrl)
    return JSON.stringify({ ok: true, message: `Base URL set to ${args.baseUrl}` })
  }
})

// Helper: fetch tool definitions to detect if login is supported
async function fetchToolDefinitions(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/tools`, { method: "GET" })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { success: false, error: text } }
}

export const huly_auth_login = tool({
  description: "Authenticate for Huly MCP REST: verifies server-side auth via get_current, or performs login if tool supports it.",
  args: {
    email: z.string().email().describe("Huly account email").optional(),
    password: z.string().describe("Huly account password").optional(),
    baseUrl: z.string().optional().describe("MCP base URL; defaults from env/store"),
    headerPrefix: z.string().optional().describe("Authorization header prefix, default 'Bearer '")
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)

    // 1) If server already has env-based credentials, get_current succeeds; no Authorization header needed
    const probeStr = await postTool(baseUrl, "huly_account_ops", { operation: "get_current" })
    const probe = JSON.parse(probeStr)
    if (probe.ok) {
      // Clear any previously set header; rely on server-side auth
      setAuthHeader(null)
      return JSON.stringify({ ok: true, mode: "server-env", message: "Server authentication verified via get_current; no client Authorization header required." })
    }

    // 2) If get_current failed, check whether a login operation is exposed by huly_account_ops
    const defs = await fetchToolDefinitions(baseUrl)
    const tools = defs?.data?.tools || defs?.tools || []
    const accountTool = tools.find((t: any) => t?.name === "huly_account_ops")
    const loginSupported = Array.isArray(accountTool?.inputSchema?.properties?.operation?.enum) && accountTool.inputSchema.properties.operation.enum.includes("login")

    if (!loginSupported) {
      return JSON.stringify({ ok: false, status: probe.status || 400, error: "Login not supported by server and server-side auth failed. Configure server HULY_MCP_EMAIL/PASSWORD or provide a token via huly_auth_set." })
    }

    if (!args.email || !args.password) {
      return JSON.stringify({ ok: false, status: 400, error: "Email and password are required when using login flow" })
    }

    // 3) Attempt login if supported
    const payload = { operation: "login", email: args.email, password: args.password }
    const resultStr = await postTool(baseUrl, "huly_account_ops", payload)
    const result = JSON.parse(resultStr)
    if (!result.ok) {
      return JSON.stringify({ ok: false, status: result.status, error: result.error })
    }

    // Extract token from common shapes
    const data = result.data?.result ?? result.data
    const token = data?.token || data?.authToken || data?.accessToken || data?.data?.token
    if (typeof token !== "string" || token.length === 0) {
      return JSON.stringify({ ok: false, status: 200, error: "Login succeeded but no token found in response" })
    }

    const prefix = args.headerPrefix ?? "Bearer "
    const headerVal = token.startsWith("Bearer ") || token.startsWith("Token ") ? token : `${prefix}${token}`
    setAuthHeader(headerVal)

    return JSON.stringify({ ok: true, mode: "token", message: "Login successful; Authorization header stored" })
  }
})

export default huly_auth_login
