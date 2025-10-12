import { tool } from "@opencode-ai/plugin"
import { getBaseUrl as _getBaseUrl, getAuthHeader } from "./_authStore"

const z = tool.schema

function getBaseUrl(input?: string) {
  return _getBaseUrl(input)
}

function buildHeaders(extra?: Record<string, string>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const auth = getAuthHeader()
  if (auth) headers["Authorization"] = auth
  if (extra) Object.assign(headers, extra)
  return headers
}

async function postTool(baseUrl: string, toolName: string, args: any, headers?: Record<string, string>): Promise<string> {
  const res = await fetch(`${baseUrl}/api/tools/${toolName}`, {
    method: "POST",
    headers: buildHeaders(headers),
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

export const huly_list_projects = tool({
  description: "List Huly projects (via MCP REST huly_query)",
  args: {
    baseUrl: z.string().optional().describe("MCP server base URL"),
    headers: z.record(z.string()).optional().describe("Extra HTTP headers (e.g., Authorization)")
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", { entity_type: "project", mode: "list" }, args.headers)
  }
})

export const huly_get_project = tool({
  description: "Get a Huly project by identifier",
  args: {
    project_identifier: z.string().describe("Project identifier (e.g., HULLY)"),
    baseUrl: z.string().optional(),
    headers: z.record(z.string()).optional()
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", {
      entity_type: "project",
      mode: "get",
      project_identifier: args.project_identifier,
    }, args.headers)
  }
})

export const huly_list_issues = tool({
  description: "List issues in a project",
  args: {
    project_identifier: z.string().describe("Project identifier (e.g., HULLY)"),
    limit: z.number().int().positive().optional().describe("Max results"),
    baseUrl: z.string().optional(),
    headers: z.record(z.string()).optional()
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const options = typeof args.limit === "number" ? { limit: args.limit } : undefined
    return postTool(baseUrl, "huly_query", {
      entity_type: "issue",
      mode: "list",
      project_identifier: args.project_identifier,
      options,
    }, args.headers)
  }
})

export const huly_search_issues = tool({
  description: "Search issues with filters",
  args: {
    filters: z.object({
      project_identifier: z.string().optional(),
      query: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      assignee: z.string().optional(),
      component: z.string().optional(),
      milestone: z.string().optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
      modified_after: z.string().optional(),
      modified_before: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }).describe("Issue search filters"),
    baseUrl: z.string().optional(),
    headers: z.record(z.string()).optional()
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const { limit, ...rest } = args.filters || {}
    const options = typeof limit === "number" ? { limit } : undefined
    return postTool(baseUrl, "huly_query", {
      entity_type: "issue",
      mode: "search",
      filters: rest,
      options,
    }, args.headers)
  }
})

export const huly_get_issue = tool({
  description: "Get a single issue by Huly identifier (e.g., HULLY-301)",
  args: {
    issue_identifier: z.string().describe("Issue identifier, e.g., HULLY-301"),
    baseUrl: z.string().optional(),
    headers: z.record(z.string()).optional()
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", {
      entity_type: "issue",
      mode: "get",
      issue_identifier: args.issue_identifier,
    }, args.headers)
  }
})

export default huly_list_projects
