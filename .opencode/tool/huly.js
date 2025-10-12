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

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

export const huly_list_projects = tool({
  description: "List all Huly projects with their details",
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
  description: "Get detailed information about a specific project by identifier",
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

export const huly_create_project = tool({
  description: "Create a new Huly project with name, optional description and identifier",
  args: {
    name: stringSchema,
    description: optionalStringSchema,
    identifier: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const data = { name: args.name }
    if (args.description) data.description = args.description
    if (args.identifier) data.identifier = args.identifier

    return postTool(baseUrl, "huly_entity", {
      entity_type: "project",
      operation: "create",
      data: JSON.stringify(data)
    }, args.headers)
  }
})

export const huly_archive_project = tool({
  description: "Archive a project (soft delete - can be restored)",
  args: {
    project_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_entity", {
      entity_type: "project",
      operation: "archive",
      project_identifier: args.project_identifier
    }, args.headers)
  }
})

export const huly_delete_project = tool({
  description: "Permanently delete a project (WARNING: cannot be undone)",
  args: {
    project_identifier: stringSchema,
    cascade: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const payload = {
      entity_type: "project",
      operation: "delete",
      project_identifier: args.project_identifier
    }
    if (args.cascade) {
      payload.options = JSON.stringify({ cascade: args.cascade === "true" })
    }
    return postTool(baseUrl, "huly_entity", payload, args.headers)
  }
})

// ============================================================================
// ISSUE QUERY OPERATIONS
// ============================================================================

export const huly_list_issues = tool({
  description: "List all issues in a specific project",
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
  description: "Get detailed information about a specific issue by identifier (e.g., HULLY-301)",
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

export const huly_search_issues = tool({
  description: "Search issues with filters (query, status, priority, assignee, component, milestone, dates)",
  args: {
    project_identifier: optionalStringSchema,
    query: optionalStringSchema,
    status: optionalStringSchema,
    priority: optionalStringSchema,
    assignee: optionalStringSchema,
    component: optionalStringSchema,
    milestone: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const filters = {}
    if (args.project_identifier) filters.project_identifier = args.project_identifier
    if (args.query) filters.query = args.query
    if (args.status) filters.status = args.status
    if (args.priority) filters.priority = args.priority
    if (args.assignee) filters.assignee = args.assignee
    if (args.component) filters.component = args.component
    if (args.milestone) filters.milestone = args.milestone

    return postTool(baseUrl, "huly_query", {
      entity_type: "issue",
      mode: "search",
      filters: JSON.stringify(filters)
    }, args.headers)
  }
})

// ============================================================================
// ISSUE CRUD OPERATIONS
// ============================================================================

export const huly_create_issue = tool({
  description: "Create a new issue in a project with title, optional description, priority, component, milestone",
  args: {
    project_identifier: stringSchema,
    title: stringSchema,
    description: optionalStringSchema,
    priority: optionalStringSchema,
    component: optionalStringSchema,
    milestone: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const data = { title: args.title }
    if (args.description) data.description = args.description
    if (args.priority) data.priority = args.priority
    if (args.component) data.component = args.component
    if (args.milestone) data.milestone = args.milestone

    return postTool(baseUrl, "huly_issue_ops", {
      operation: "create",
      project_identifier: args.project_identifier,
      data: JSON.stringify(data)
    }, args.headers)
  }
})

export const huly_create_subissue = tool({
  description: "Create a sub-issue under an existing parent issue",
  args: {
    parent_issue_identifier: stringSchema,
    title: stringSchema,
    description: optionalStringSchema,
    priority: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const data = { title: args.title }
    if (args.description) data.description = args.description
    if (args.priority) data.priority = args.priority

    return postTool(baseUrl, "huly_issue_ops", {
      operation: "create_subissue",
      parent_issue_identifier: args.parent_issue_identifier,
      data: JSON.stringify(data)
    }, args.headers)
  }
})

export const huly_update_issue = tool({
  description: "Update an issue field (title, description, status, priority, component, milestone)",
  args: {
    issue_identifier: stringSchema,
    field: stringSchema,
    value: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_issue_ops", {
      operation: "update",
      issue_identifier: args.issue_identifier,
      update: JSON.stringify({ field: args.field, value: args.value })
    }, args.headers)
  }
})

export const huly_delete_issue = tool({
  description: "Delete an issue permanently (WARNING: cannot be undone)",
  args: {
    issue_identifier: stringSchema,
    cascade: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const payload = {
      operation: "delete",
      issue_identifier: args.issue_identifier
    }
    if (args.cascade) {
      payload.options = JSON.stringify({ cascade: args.cascade === "true" })
    }
    return postTool(baseUrl, "huly_issue_ops", payload, args.headers)
  }
})

export const huly_bulk_update_issues = tool({
  description: "Update multiple issues at once with field/value pairs",
  args: {
    updates: stringSchema, // JSON array of {issue_identifier, field, value}
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_issue_ops", {
      operation: "bulk_update",
      updates: args.updates
    }, args.headers)
  }
})

// ============================================================================
// COMPONENT OPERATIONS
// ============================================================================

export const huly_list_components = tool({
  description: "List all components in a project",
  args: {
    project_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", {
      entity_type: "component",
      mode: "list",
      project_identifier: args.project_identifier
    }, args.headers)
  }
})

export const huly_create_component = tool({
  description: "Create a new component in a project",
  args: {
    project_identifier: stringSchema,
    label: stringSchema,
    description: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const data = { label: args.label }
    if (args.description) data.description = args.description

    return postTool(baseUrl, "huly_entity", {
      entity_type: "component",
      operation: "create",
      project_identifier: args.project_identifier,
      data: JSON.stringify(data)
    }, args.headers)
  }
})

export const huly_delete_component = tool({
  description: "Delete a component from a project",
  args: {
    project_identifier: stringSchema,
    label: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_entity", {
      entity_type: "component",
      operation: "delete",
      project_identifier: args.project_identifier,
      entity_identifier: args.label
    }, args.headers)
  }
})

// ============================================================================
// MILESTONE OPERATIONS
// ============================================================================

export const huly_list_milestones = tool({
  description: "List all milestones in a project",
  args: {
    project_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", {
      entity_type: "milestone",
      mode: "list",
      project_identifier: args.project_identifier
    }, args.headers)
  }
})

export const huly_create_milestone = tool({
  description: "Create a new milestone in a project with target date (YYYY-MM-DD format)",
  args: {
    project_identifier: stringSchema,
    label: stringSchema,
    target_date: stringSchema,
    description: optionalStringSchema,
    status: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const data = {
      label: args.label,
      target_date: args.target_date
    }
    if (args.description) data.description = args.description
    if (args.status) data.status = args.status

    return postTool(baseUrl, "huly_entity", {
      entity_type: "milestone",
      operation: "create",
      project_identifier: args.project_identifier,
      data: JSON.stringify(data)
    }, args.headers)
  }
})

export const huly_delete_milestone = tool({
  description: "Delete a milestone from a project",
  args: {
    project_identifier: stringSchema,
    label: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_entity", {
      entity_type: "milestone",
      operation: "delete",
      project_identifier: args.project_identifier,
      entity_identifier: args.label
    }, args.headers)
  }
})

// ============================================================================
// COMMENT OPERATIONS
// ============================================================================

export const huly_list_comments = tool({
  description: "List all comments on an issue",
  args: {
    issue_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", {
      entity_type: "comment",
      mode: "list",
      issue_identifier: args.issue_identifier
    }, args.headers)
  }
})

export const huly_create_comment = tool({
  description: "Add a comment to an issue (supports markdown)",
  args: {
    issue_identifier: stringSchema,
    message: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_entity", {
      entity_type: "comment",
      operation: "create",
      issue_identifier: args.issue_identifier,
      data: JSON.stringify({ message: args.message })
    }, args.headers)
  }
})

// ============================================================================
// TEMPLATE OPERATIONS
// ============================================================================

export const huly_list_templates = tool({
  description: "List all issue templates in a project",
  args: {
    project_identifier: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    return postTool(baseUrl, "huly_query", {
      entity_type: "template",
      mode: "list",
      project_identifier: args.project_identifier
    }, args.headers)
  }
})

export const huly_create_template = tool({
  description: "Create a new issue template for reusable issue creation",
  args: {
    project_identifier: stringSchema,
    title: stringSchema,
    description: optionalStringSchema,
    priority: optionalStringSchema,
    component: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const data = { title: args.title }
    if (args.description) data.description = args.description
    if (args.priority) data.priority = args.priority
    if (args.component) data.component = args.component

    return postTool(baseUrl, "huly_template_ops", {
      operation: "create",
      project_identifier: args.project_identifier,
      data: JSON.stringify(data)
    }, args.headers)
  }
})

export const huly_instantiate_template = tool({
  description: "Create issues from a template (creates parent and all child issues)",
  args: {
    template_id: stringSchema,
    title: optionalStringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const payload = {
      operation: "instantiate",
      template_id: args.template_id
    }
    if (args.title) {
      payload.overrides = JSON.stringify({ title: args.title })
    }
    return postTool(baseUrl, "huly_template_ops", payload, args.headers)
  }
})

// ============================================================================
// WORKFLOW OPERATIONS
// ============================================================================

export const huly_setup_project = tool({
  description: "Complete project setup workflow: create project, components, milestones, and templates in one operation",
  args: {
    project_name: stringSchema,
    project_identifier: stringSchema,
    project_description: optionalStringSchema,
    components: optionalStringSchema, // JSON array of component names or {label, description} objects
    milestones: optionalStringSchema, // JSON array of {label, target_date, description, status}
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    const baseUrl = getBaseUrl(args.baseUrl)
    const context = {
      project: {
        name: args.project_name,
        identifier: args.project_identifier
      }
    }
    if (args.project_description) context.project.description = args.project_description
    if (args.components) context.components = JSON.parse(args.components)
    if (args.milestones) context.milestones = JSON.parse(args.milestones)

    return postTool(baseUrl, "huly_workflow", {
      workflow_type: "project_setup",
      context: JSON.stringify(context)
    }, args.headers)
  }
})

export default huly_list_projects
