import { tool } from "@opencode-ai/plugin"

const z = tool.schema

// Pre-define schemas (OpenCode bug workaround: no inline chaining)
const stringSchema = z.string()
const optionalStringSchema = z.string().optional()
const unknownSchema = z.unknown().optional() // For headers/objects - z.record() causes errors

function getBaseUrl(input) {
  return input || process.env.HULY_MCP_BASE_URL || "http://localhost:3457"
}

async function postTool(baseUrl, toolName, args, headers) {
  const hdrs = { "Content-Type": "application/json" }
  if (headers && typeof headers === 'object') {
    Object.assign(hdrs, headers)
  }
  
  const res = await fetch(`${baseUrl}/api/tools/${toolName}`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ arguments: args || {} }),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { success: false, error: "Invalid JSON", raw: text } }
  if (!res.ok || json?.success === false) {
    return JSON.stringify({ ok: false, status: res.status, error: json?.error || text })
  }
  return JSON.stringify({ ok: true, status: res.status, data: json.data })
}

export const huly_list_projects = tool({
  description: "List Huly projects (via MCP REST huly_query)",
  args: {
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", { entity_type: "project", mode: "list" }, args.headers)
  }
})

export const huly_get_project = tool({
  description: "Get a Huly project by identifier",
  args: {
    project_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
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
    project_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", {
      entity_type: "issue",
      mode: "list",
      project_identifier: args.project_identifier
    }, args.headers)
  }
})

export const huly_get_issue = tool({
  description: "Get a single issue by identifier (e.g., HULLY-301)",
  args: {
    issue_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
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
