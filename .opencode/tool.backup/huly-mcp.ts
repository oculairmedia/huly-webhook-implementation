import { tool } from "@opencode-ai/plugin"

const z = tool.schema

/**
 * Huly MCP HTTP tools for OpenCode
 * - mcp_health: check server health
 * - mcp_tools: list available MCP tools
 * - mcp_call: generic JSON-RPC call passthrough
 */

function getBaseUrl(input?: string) {
  return (
    input ||
    process.env.HULY_MCP_BASE_URL ||
    "http://localhost:3457"
  )
}

export const mcp_health = tool({
  description: "Check Huly MCP server health endpoint",
  args: {
    baseUrl: z.string().optional().describe("Base URL, defaults to env HULY_MCP_BASE_URL or http://localhost:3457"),
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const res = await fetch(`${baseUrl}/health`)
    const text = await res.text()
    return JSON.stringify({ status: res.status, ok: res.ok, body: text })
  },
})

export const mcp_tools = tool({
  description: "List tools from Huly MCP server (HTTP transport)",
  args: {
    baseUrl: z.string().optional().describe("Base URL, defaults to env HULY_MCP_BASE_URL or http://localhost:3457"),
    headers: z.record(z.string()).optional().describe("Additional HTTP headers to include"),
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const payload = { jsonrpc: "2.0", method: "tools/list", params: {}, id: 1 }
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(args.headers || {}) },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let json: unknown
    try { json = JSON.parse(text) } catch {
      json = { error: "Invalid JSON response", raw: text }
    }
    return JSON.stringify({ status: res.status, ok: res.ok, data: json })
  },
})

export const mcp_call = tool({
  description: "Call an arbitrary MCP JSON-RPC method on the Huly MCP server",
  args: {
    method: z.string().describe("JSON-RPC method name, e.g. tools/list or tool/call"),
    params: z.unknown().optional().describe("JSON-RPC params object for the method"),
    id: z.union([z.number(), z.string()]).optional().describe("Optional request id"),
    baseUrl: z.string().optional().describe("Base URL, defaults to env HULY_MCP_BASE_URL or http://localhost:3457"),
    headers: z.record(z.string()).optional().describe("Additional HTTP headers to include"),
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const payload: any = { jsonrpc: "2.0", method: args.method, params: args.params ?? {}, id: args.id ?? 1 }
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(args.headers || {}) },
      body: JSON.stringify(payload),
    })

    const text = await res.text()
    let json: unknown
    try { json = JSON.parse(text) } catch {
      json = { error: "Invalid JSON response", raw: text }
    }

    return JSON.stringify({ status: res.status, ok: res.ok, data: json })
  },
})

export default mcp_call
