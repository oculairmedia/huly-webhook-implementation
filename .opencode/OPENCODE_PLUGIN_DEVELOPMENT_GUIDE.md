# OpenCode Plugin Development Guide

## Overview

This guide documents the capabilities, limitations, and best practices for developing OpenCode plugins based on lessons learned from building the Huly MCP integration plugin.

**Last Updated:** 2025-10-11
**OpenCode Version:** Latest (as of date)
**Reference Implementation:** `.opencode/tool/huly.js`

---

## Table of Contents

1. [What OpenCode Allows](#what-opencode-allows)
2. [What OpenCode Doesn't Allow](#what-opencode-doesnt-allow)
3. [Plugin Architecture](#plugin-architecture)
4. [Schema Definition Workarounds](#schema-definition-workarounds)
5. [Best Practices](#best-practices)
6. [Common Pitfalls](#common-pitfalls)
7. [Example Implementations](#example-implementations)

---

## What OpenCode Allows

### ✅ Tool Definition and Export

```javascript
import { tool } from "@opencode-ai/plugin"

// You CAN export tools with descriptions and args
export const my_tool = tool({
  description: "Clear description of what the tool does",
  args: {
    required_param: stringSchema,
    optional_param: optionalStringSchema
  },
  async execute(args) {
    // Tool implementation
    return JSON.stringify({ success: true, data: result })
  }
})
```

### ✅ Pre-Defined Schema Variables

```javascript
const z = tool.schema

// MUST pre-define schemas - no inline chaining
const stringSchema = z.string()
const optionalStringSchema = z.string().optional()
const numberSchema = z.number()
const booleanSchema = z.boolean()
const unknownSchema = z.unknown().optional() // For objects/headers
```

**Key Point:** All schemas MUST be defined as standalone variables before use. Inline method chaining causes runtime errors.

### ✅ Async/Await Operations

```javascript
async execute(args) {
  const res = await fetch(url, options)
  const data = await res.json()
  return JSON.stringify(data)
}
```

### ✅ Environment Variable Access

```javascript
const baseUrl = args.baseUrl || process.env.MY_BASE_URL || "http://localhost:3000"
```

### ✅ Fetch API for HTTP Requests

```javascript
const res = await fetch(`${baseUrl}/api/endpoint`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ arguments: args || {} }),
})
```

### ✅ Error Handling and Response Formatting

```javascript
const text = await res.text()
let json
try {
  json = JSON.parse(text)
} catch {
  json = { success: false, error: "Invalid JSON", raw: text }
}

if (!res.ok || json?.success === false) {
  return JSON.stringify({
    ok: false,
    status: res.status,
    error: json?.error || text
  })
}
```

### ✅ Multiple Tool Exports

```javascript
export const tool_one = tool({ /* ... */ })
export const tool_two = tool({ /* ... */ })
export const tool_three = tool({ /* ... */ })

// Optional: Export one as default
export default tool_one
```

### ✅ Helper Functions

```javascript
function getBaseUrl(input) {
  return input || process.env.BASE_URL || "http://localhost:3000"
}

async function postTool(baseUrl, toolName, args, headers) {
  // Shared logic for making API calls
}

export const my_tool = tool({
  async execute(args) {
    return postTool(getBaseUrl(args.baseUrl), "tool_name", args, args.headers)
  }
})
```

### ✅ Object and Unknown Types

```javascript
// For headers, metadata, or complex objects
const unknownSchema = z.unknown().optional()

export const my_tool = tool({
  args: {
    headers: unknownSchema,  // Accepts any object
    metadata: unknownSchema
  },
  async execute(args) {
    if (args.headers && typeof args.headers === 'object') {
      Object.assign(defaultHeaders, args.headers)
    }
  }
})
```

---

## What OpenCode Doesn't Allow

### ❌ Inline Schema Method Chaining

```javascript
// ❌ THIS BREAKS - TypeError: Cannot read property '_zod' of undefined
export const broken_tool = tool({
  args: {
    param: z.string().optional()  // FAILS at runtime
  }
})

// ✅ THIS WORKS
const optionalStringSchema = z.string().optional()
export const working_tool = tool({
  args: {
    param: optionalStringSchema  // Success!
  }
})
```

**Root Cause:** OpenCode's `tool.schema` proxy doesn't properly handle chained method calls. The `z.string()` call returns a schema object, but when `.optional()` is called on it, the internal `_zod` reference is lost.

### ❌ Complex Zod Schemas with Chaining

```javascript
// ❌ FAILS - z.record() causes errors
const recordSchema = z.record(z.string())

// ✅ WORKAROUND - Use z.unknown()
const unknownSchema = z.unknown().optional()
```

### ❌ Nested Schema Definitions

```javascript
// ❌ FAILS - Nested object schemas don't work reliably
const nestedSchema = z.object({
  field1: z.string(),
  field2: z.number()
})

// ✅ WORKAROUND - Use unknown and validate manually
const unknownSchema = z.unknown().optional()

async execute(args) {
  // Manual validation
  if (args.data && typeof args.data === 'object') {
    if (!args.data.field1 || typeof args.data.field1 !== 'string') {
      return JSON.stringify({ error: "field1 must be a string" })
    }
  }
}
```

### ❌ Schema Validation with Complex Types

```javascript
// ❌ Can't use advanced Zod features
const emailSchema = z.string().email()  // FAILS
const urlSchema = z.string().url()      // FAILS
const enumSchema = z.enum(['a', 'b'])   // FAILS
```

### ❌ Dynamic Schema Generation

```javascript
// ❌ Can't build schemas dynamically
function createSchema(type) {
  return z.string()  // Won't work reliably
}
```

### ❌ Import from Node Modules (Limited)

```javascript
// ❌ Most npm packages won't work
import axios from 'axios'  // Likely fails

// ✅ Use built-in fetch instead
const res = await fetch(url)
```

---

## Plugin Architecture

### File Structure

```
.opencode/
  tool/
    my-plugin.js        # Main plugin file
    helper.js           # Optional helpers (if imports work)
  OPENCODE_PLUGIN_DEVELOPMENT_GUIDE.md  # This guide
```

### Tool Signature

```javascript
export const tool_name = tool({
  description: string,    // Required: Clear, concise description
  args: {                 // Optional: Input parameters
    param_name: schema    // Pre-defined schema variable
  },
  async execute(args) {   // Required: Implementation
    // args contains all defined parameters
    // Must return a string (use JSON.stringify for objects)
    return string
  }
})
```

### Return Value Requirements

**CRITICAL:** OpenCode tools MUST return strings. Always use `JSON.stringify()` for objects:

```javascript
// ✅ CORRECT
return JSON.stringify({ success: true, data: result })

// ❌ WRONG - Will cause errors
return { success: true, data: result }
```

---

## Schema Definition Workarounds

### Pattern 1: Pre-Define All Schemas

```javascript
import { tool } from "@opencode-ai/plugin"

const z = tool.schema

// Define all schemas at the top
const stringSchema = z.string()
const optionalStringSchema = z.string().optional()
const numberSchema = z.number()
const optionalNumberSchema = z.number().optional()
const booleanSchema = z.boolean()
const unknownSchema = z.unknown().optional()

// Use in tools
export const my_tool = tool({
  args: {
    name: stringSchema,
    age: optionalNumberSchema,
    metadata: unknownSchema
  },
  async execute(args) { /* ... */ }
})
```

### Pattern 2: Unknown Schema for Complex Types

```javascript
// For objects, arrays, or any complex type
const unknownSchema = z.unknown().optional()

export const my_tool = tool({
  args: {
    headers: unknownSchema,      // Accepts any object
    data: unknownSchema,         // Accepts any structure
    options: unknownSchema       // Accepts any configuration
  },
  async execute(args) {
    // Manual type checking and validation
    if (args.headers && typeof args.headers === 'object') {
      // Use the headers
    }

    if (Array.isArray(args.data)) {
      // Process array
    }

    return JSON.stringify({ success: true })
  }
})
```

### Pattern 3: String Schema for JSON Input

```javascript
// Accept JSON as string and parse manually
const stringSchema = z.string()

export const my_tool = tool({
  args: {
    json_data: stringSchema  // User provides JSON as string
  },
  async execute(args) {
    let data
    try {
      data = JSON.parse(args.json_data)
    } catch (e) {
      return JSON.stringify({ error: "Invalid JSON" })
    }

    // Validate parsed data
    if (!data.required_field) {
      return JSON.stringify({ error: "Missing required_field" })
    }

    return JSON.stringify({ success: true, data })
  }
})
```

---

## Best Practices

### 1. Always Return JSON Strings

```javascript
// ✅ GOOD
async execute(args) {
  const result = { success: true, data: { items: [] } }
  return JSON.stringify(result)
}

// ❌ BAD
async execute(args) {
  return { success: true }  // Will cause errors
}
```

### 2. Provide Clear Descriptions

```javascript
// ✅ GOOD
export const huly_list_issues = tool({
  description: "List issues in a Huly project with optional filtering and pagination",
  // ...
})

// ❌ BAD
export const huly_list_issues = tool({
  description: "Gets issues",  // Too vague
  // ...
})
```

### 3. Handle Errors Gracefully

```javascript
async execute(args) {
  try {
    const res = await fetch(url)

    if (!res.ok) {
      return JSON.stringify({
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}: ${res.statusText}`
      })
    }

    const data = await res.json()
    return JSON.stringify({ ok: true, data })

  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error.message || "Unknown error"
    })
  }
}
```

### 4. Use Environment Variables for Configuration

```javascript
function getConfig(args) {
  return {
    baseUrl: args.baseUrl || process.env.API_BASE_URL || "http://localhost:3000",
    apiKey: args.apiKey || process.env.API_KEY,
    timeout: args.timeout || parseInt(process.env.API_TIMEOUT || "30000")
  }
}
```

### 5. Validate Required Parameters

```javascript
async execute(args) {
  // Validate required fields
  if (!args.project_identifier) {
    return JSON.stringify({
      success: false,
      error: "project_identifier is required"
    })
  }

  // Validate format
  if (!/^[A-Z]{1,5}$/.test(args.project_identifier)) {
    return JSON.stringify({
      success: false,
      error: "project_identifier must be 1-5 uppercase letters"
    })
  }

  // Proceed with execution
}
```

### 6. Document Parameter Usage

```javascript
export const my_tool = tool({
  description: "Detailed description of the tool's purpose and behavior",
  args: {
    // Document each parameter's purpose and format
    project_identifier: stringSchema,    // e.g., "PROJ" or "ABC"
    include_archived: optionalBooleanSchema,  // defaults to false
    limit: optionalNumberSchema,         // max results (1-100)
    baseUrl: optionalStringSchema        // override default API URL
  },
  async execute(args) { /* ... */ }
})
```

---

## Common Pitfalls

### Pitfall 1: Forgetting JSON.stringify

```javascript
// ❌ WRONG - Returns object
return { success: true }

// ✅ CORRECT - Returns JSON string
return JSON.stringify({ success: true })
```

### Pitfall 2: Inline Schema Chaining

```javascript
// ❌ WRONG - Runtime error
args: {
  name: z.string().optional()
}

// ✅ CORRECT - Pre-defined schema
const optionalStringSchema = z.string().optional()
args: {
  name: optionalStringSchema
}
```

### Pitfall 3: Not Handling Fetch Errors

```javascript
// ❌ WRONG - Unhandled promise rejection
const res = await fetch(url)
const data = await res.json()

// ✅ CORRECT - Proper error handling
try {
  const res = await fetch(url)
  if (!res.ok) {
    return JSON.stringify({ error: `HTTP ${res.status}` })
  }
  const data = await res.json()
} catch (error) {
  return JSON.stringify({ error: error.message })
}
```

### Pitfall 4: Assuming Object Schema Works

```javascript
// ❌ WRONG - Complex schemas fail
const dataSchema = z.object({
  name: z.string(),
  age: z.number()
})

// ✅ CORRECT - Use unknown and validate manually
const unknownSchema = z.unknown().optional()
```

### Pitfall 5: Not Testing with Real OpenCode

```javascript
// Always test your plugin in actual OpenCode environment
// What works in Node.js might not work in OpenCode's runtime
```

---

## Example Implementations

### Example 1: Simple GET Request

```javascript
import { tool } from "@opencode-ai/plugin"

const z = tool.schema
const stringSchema = z.string()
const optionalStringSchema = z.string().optional()

export const fetch_data = tool({
  description: "Fetch data from an API endpoint",
  args: {
    endpoint: stringSchema,
    baseUrl: optionalStringSchema
  },
  async execute(args) {
    const baseUrl = args.baseUrl || process.env.API_BASE_URL || "http://localhost:3000"
    const url = `${baseUrl}${args.endpoint}`

    try {
      const res = await fetch(url)

      if (!res.ok) {
        return JSON.stringify({
          success: false,
          status: res.status,
          error: res.statusText
        })
      }

      const data = await res.json()
      return JSON.stringify({
        success: true,
        data
      })

    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      })
    }
  }
})
```

### Example 2: POST with JSON Body

```javascript
import { tool } from "@opencode-ai/plugin"

const z = tool.schema
const stringSchema = z.string()
const unknownSchema = z.unknown().optional()

async function postData(baseUrl, endpoint, payload) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  return res.json()
}

export const create_item = tool({
  description: "Create a new item via API",
  args: {
    name: stringSchema,
    data: unknownSchema,
    baseUrl: stringSchema.optional()
  },
  async execute(args) {
    try {
      const baseUrl = args.baseUrl || process.env.API_BASE_URL || "http://localhost:3000"

      const payload = {
        name: args.name,
        ...(args.data && typeof args.data === 'object' ? args.data : {})
      }

      const result = await postData(baseUrl, "/api/items", payload)

      return JSON.stringify({
        success: true,
        data: result
      })

    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      })
    }
  }
})
```

### Example 3: Multiple Tools Sharing Helper

```javascript
import { tool } from "@opencode-ai/plugin"

const z = tool.schema
const stringSchema = z.string()
const optionalStringSchema = z.string().optional()
const unknownSchema = z.unknown().optional()

// Shared helper function
function getBaseUrl(input) {
  return input || process.env.API_BASE_URL || "http://localhost:3000"
}

async function apiCall(baseUrl, endpoint, method = "GET", body = null, headers = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) }
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const res = await fetch(`${baseUrl}${endpoint}`, options)

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  return res.json()
}

// Tool 1: List items
export const list_items = tool({
  description: "List all items",
  args: {
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    try {
      const data = await apiCall(
        getBaseUrl(args.baseUrl),
        "/api/items",
        "GET",
        null,
        args.headers
      )
      return JSON.stringify({ success: true, data })
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message })
    }
  }
})

// Tool 2: Get single item
export const get_item = tool({
  description: "Get a specific item by ID",
  args: {
    item_id: stringSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    try {
      const data = await apiCall(
        getBaseUrl(args.baseUrl),
        `/api/items/${args.item_id}`,
        "GET",
        null,
        args.headers
      )
      return JSON.stringify({ success: true, data })
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message })
    }
  }
})

// Tool 3: Create item
export const create_item = tool({
  description: "Create a new item",
  args: {
    name: stringSchema,
    data: unknownSchema,
    baseUrl: optionalStringSchema,
    headers: unknownSchema
  },
  async execute(args) {
    try {
      const payload = {
        name: args.name,
        ...(args.data && typeof args.data === 'object' ? args.data : {})
      }

      const data = await apiCall(
        getBaseUrl(args.baseUrl),
        "/api/items",
        "POST",
        payload,
        args.headers
      )
      return JSON.stringify({ success: true, data })
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message })
    }
  }
})

export default list_items
```

---

## Testing Checklist

Before deploying your plugin, verify:

- [ ] All schemas are pre-defined as variables (no inline chaining)
- [ ] All `execute()` functions return JSON strings via `JSON.stringify()`
- [ ] Error handling covers all `fetch()` calls and JSON parsing
- [ ] Required parameters are validated before use
- [ ] Environment variables have sensible defaults
- [ ] Tool descriptions are clear and actionable
- [ ] Complex objects use `z.unknown().optional()` instead of `z.object()` or `z.record()`
- [ ] All async operations use proper `try/catch` blocks
- [ ] HTTP errors return structured error responses
- [ ] The plugin has been tested in actual OpenCode environment (not just Node.js)

---

## Debugging Tips

### 1. Check OpenCode Console

OpenCode will show errors in its console. Look for:
- `TypeError: Cannot read property '_zod' of undefined` → Inline schema chaining
- `TypeError: ... is not a function` → Schema method not available
- Return value errors → Forgot `JSON.stringify()`

### 2. Test Incrementally

Start with a minimal tool and add complexity:

```javascript
// Step 1: Minimal tool
export const test = tool({
  description: "Test tool",
  async execute() {
    return JSON.stringify({ success: true })
  }
})

// Step 2: Add parameters
const stringSchema = z.string()
export const test = tool({
  description: "Test tool",
  args: { param: stringSchema },
  async execute(args) {
    return JSON.stringify({ success: true, param: args.param })
  }
})

// Step 3: Add actual logic...
```

### 3. Log Errors Properly

```javascript
async execute(args) {
  try {
    // Implementation
  } catch (error) {
    // Return detailed error info
    return JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack,  // Include for debugging
      args: args           // Show what was passed
    })
  }
}
```

### 4. Test External API Separately

Before integrating, test your API calls with `curl` or Postman to ensure the backend works correctly.

---

## Advanced Patterns

### Pattern: Pagination Support

```javascript
export const list_with_pagination = tool({
  description: "List items with pagination support",
  args: {
    page: optionalNumberSchema,      // defaults to 1
    limit: optionalNumberSchema,     // defaults to 50
    baseUrl: optionalStringSchema
  },
  async execute(args) {
    const page = args.page || 1
    const limit = args.limit || 50
    const baseUrl = getBaseUrl(args.baseUrl)

    const url = `${baseUrl}/api/items?page=${page}&limit=${limit}`

    try {
      const res = await fetch(url)
      const data = await res.json()

      return JSON.stringify({
        success: true,
        data: data.items,
        pagination: {
          page,
          limit,
          total: data.total,
          hasMore: data.hasMore
        }
      })
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message })
    }
  }
})
```

### Pattern: Retry Logic

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options)
      if (!res.ok && res.status >= 500) {
        // Retry on server errors
        throw new Error(`HTTP ${res.status}`)
      }
      return res
    } catch (error) {
      lastError = error
      if (i < maxRetries - 1) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)))
      }
    }
  }

  throw lastError
}
```

### Pattern: Response Caching

```javascript
const cache = new Map()

export const cached_tool = tool({
  description: "Tool with response caching",
  args: {
    key: stringSchema,
    baseUrl: optionalStringSchema
  },
  async execute(args) {
    // Check cache
    const cacheKey = `${args.key}_${args.baseUrl}`
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey)
      // Check if cache is still valid (e.g., 5 minutes)
      if (Date.now() - cached.timestamp < 300000) {
        return JSON.stringify({
          success: true,
          data: cached.data,
          cached: true
        })
      }
    }

    // Fetch fresh data
    try {
      const res = await fetch(`${getBaseUrl(args.baseUrl)}/api/${args.key}`)
      const data = await res.json()

      // Update cache
      cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      })

      return JSON.stringify({
        success: true,
        data,
        cached: false
      })
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message })
    }
  }
})
```

---

## Conclusion

OpenCode plugins are powerful but have specific limitations around schema definition. The key to success is:

1. **Always pre-define schemas** - Never use inline method chaining
2. **Return JSON strings** - Use `JSON.stringify()` for all return values
3. **Use `unknown` for complex types** - Manually validate instead of using `z.object()` or `z.record()`
4. **Handle errors gracefully** - Return structured error responses
5. **Test in OpenCode** - Don't assume Node.js behavior translates

By following these patterns and avoiding the documented pitfalls, you can build reliable OpenCode plugins that integrate seamlessly with external APIs and services.

---

## Additional Resources

- **Reference Implementation:** `.opencode/tool/huly.js` - Working example with all patterns
- **OpenCode Documentation:** Check official OpenCode docs for latest updates
- **Zod Documentation:** https://zod.dev/ - For understanding schema validation (with OpenCode limitations in mind)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-11
**Maintainer:** Huly MCP Integration Team
