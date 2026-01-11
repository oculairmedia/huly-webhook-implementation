# Project Update REST API Endpoint

## Endpoint

**PUT** `/api/projects/:identifier`

Updates a project's name and/or description.

## Parameters

### Path Parameters

- `identifier` (required) - The project identifier (e.g., "MYPROJ", "HULLY")

### Request Body Options

The endpoint supports two request body styles:

#### Option 1: Single Field Update

```json
{
  "field": "name",
  "value": "New Project Name"
}
```

- `field` - Field to update: "name" or "description"
- `value` - New value for the field

#### Option 2: Bulk Update

```json
{
  "name": "New Project Name",
  "description": "New project description"
}
```

- `name` (optional) - New project name
- `description` (optional) - New project description
- **Note:** At least one field must be provided

## Response

### Success Response (200 OK)

```json
{
  "identifier": "MYPROJ",
  "updatedFields": ["name", "description"],
  "updates": {
    "name": "New Project Name",
    "description": "New project description"
  },
  "success": true
}
```

### Error Responses

#### Project Not Found (404)

```json
{
  "error": "Project MYPROJ not found"
}
```

#### Invalid Field (400)

```json
{
  "error": "Field 'invalid' not supported",
  "supportedFields": ["name", "description"]
}
```

#### No Fields to Update (400)

```json
{
  "error": "No valid fields to update",
  "hint": "Provide either { field, value } or { name, description }"
}
```

#### Server Not Ready (503)

```json
{
  "error": "Huly client not initialized"
}
```

## Usage Examples

### Update Project Name Only

```bash
curl -X PUT http://localhost:3458/api/projects/MYPROJ \
  -H "Content-Type: application/json" \
  -d '{
    "field": "name",
    "value": "My Renamed Project"
  }'
```

### Update Project Description Only

```bash
curl -X PUT http://localhost:3458/api/projects/MYPROJ \
  -H "Content-Type: application/json" \
  -d '{
    "field": "description",
    "value": "This is the new description for my project"
  }'
```

### Update Both Name and Description

```bash
curl -X PUT http://localhost:3458/api/projects/MYPROJ \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Updated Project",
    "description": "Updated description text"
  }'
```

### Using JavaScript Fetch

```javascript
const response = await fetch('http://localhost:3458/api/projects/MYPROJ', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'New Project Name',
    description: 'New description'
  })
});

const result = await response.json();
console.log(result);
// {
//   identifier: "MYPROJ",
//   updatedFields: ["name", "description"],
//   updates: { name: "New Project Name", description: "New description" },
//   success: true
// }
```

### Using Python Requests

```python
import requests

url = "http://localhost:3458/api/projects/MYPROJ"
data = {
    "name": "New Project Name",
    "description": "New description"
}

response = requests.put(url, json=data)
result = response.json()
print(result)
```

## Field Restrictions

### Supported Fields

- ✅ `name` - Project display name
- ✅ `description` - Project description text

### Not Supported (Will Return Error)

- ❌ `identifier` - Project short code (cannot be changed)
- ❌ `owners` - Project owners
- ❌ `private` - Private/public status
- ❌ `archived` - Archived status (use archive endpoint instead)

## Validation Rules

1. Project identifier must exist in the workspace
2. At least one field (name or description) must be provided
3. Empty strings are allowed for description
4. Name cannot be empty

## Integration with MCP Tool

This REST endpoint provides the same functionality as the MCP `huly_entity` tool:

**REST API:**
```bash
PUT /api/projects/MYPROJ
{ "name": "New Name" }
```

**MCP Tool Equivalent:**
```json
{
  "tool": "huly_entity",
  "arguments": {
    "entity_type": "project",
    "operation": "update",
    "project_identifier": "MYPROJ",
    "data": { "name": "New Name" }
  }
}
```

## Performance

- Direct Huly API connection (bypasses MCP protocol overhead)
- Typical response time: < 200ms
- Suitable for high-frequency updates

## Notes

- Changes take effect immediately
- No undo functionality - changes are permanent
- Project identifier cannot be changed via this endpoint
- Description supports plain text (no markdown rendering)
