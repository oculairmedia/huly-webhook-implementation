# Agent Instructions: Huly Project Update API

## Overview
The Huly platform now supports updating project names and descriptions through a REST API endpoint.

**Base URL:** `http://192.168.50.90:3458`

## Quick Reference

### Update Project Name and/or Description

**Endpoint:** `PUT /api/projects/:identifier`

**Required Headers:**
```
Content-Type: application/json
```

## Usage Examples

### 1. Update Project Name Only

```bash
curl -X PUT http://192.168.50.90:3458/api/projects/HULLY \
  -H "Content-Type: application/json" \
  -d '{"field": "name", "value": "My New Project Name"}'
```

**Response:**
```json
{
  "identifier": "HULLY",
  "updatedFields": ["name"],
  "updates": {
    "name": "My New Project Name"
  },
  "success": true
}
```

### 2. Update Project Description Only

```bash
curl -X PUT http://192.168.50.90:3458/api/projects/HULLY \
  -H "Content-Type: application/json" \
  -d '{"field": "description", "value": "This is the updated project description"}'
```

**Response:**
```json
{
  "identifier": "HULLY",
  "updatedFields": ["description"],
  "updates": {
    "description": "This is the updated project description"
  },
  "success": true
}
```

### 3. Update Both Name and Description Together

```bash
curl -X PUT http://192.168.50.90:3458/api/projects/HULLY \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Updated Project",
    "description": "Complete project description update"
  }'
```

**Response:**
```json
{
  "identifier": "HULLY",
  "updatedFields": ["name", "description"],
  "updates": {
    "name": "My Updated Project",
    "description": "Complete project description update"
  },
  "success": true
}
```

### 4. Clear a Description (Set to Empty)

```bash
curl -X PUT http://192.168.50.90:3458/api/projects/HULLY \
  -H "Content-Type: application/json" \
  -d '{"description": ""}'
```

## Request Format Options

The API supports two request body formats:

### Option A: Field/Value Format (Single Field)
```json
{
  "field": "name",
  "value": "New Name"
}
```
OR
```json
{
  "field": "description",
  "value": "New Description"
}
```

### Option B: Direct Format (One or Both Fields)
```json
{
  "name": "New Name"
}
```
OR
```json
{
  "description": "New Description"
}
```
OR
```json
{
  "name": "New Name",
  "description": "New Description"
}
```

## Getting Project Identifiers

Before updating, you need the project identifier. List all projects:

```bash
curl http://192.168.50.90:3458/api/projects
```

**Response Format:**
```json
{
  "PROJECT_ID": {
    "identifier": "PROJ",
    "name": "Project Name",
    "description": "Description",
    ...
  },
  ...
}
```

Extract identifiers:
```bash
# Get all project identifiers
curl -s http://192.168.50.90:3458/api/projects | jq -r 'keys[]'

# Get first project identifier
curl -s http://192.168.50.90:3458/api/projects | jq -r 'keys[0]'
```

## Error Responses

### Project Not Found (404)
```json
{
  "error": "Project NOTFOUND not found"
}
```

### Invalid Field (400)
```json
{
  "error": "Field 'invalid' not supported",
  "supportedFields": ["name", "description"]
}
```

### No Fields to Update (400)
```json
{
  "error": "No valid fields to update",
  "hint": "Provide either { field, value } or { name, description }"
}
```

### Server Not Ready (503)
```json
{
  "error": "Huly client not initialized"
}
```

## Validation Rules

1. **Project must exist** - The identifier must match an existing project
2. **At least one field required** - Must provide name, description, or both
3. **Name cannot be empty** - Name field requires a non-empty value
4. **Description can be empty** - Empty string is valid for description

## What Can Be Updated

| Field | Supported | Notes |
|-------|-----------|-------|
| ✅ name | Yes | Project display name |
| ✅ description | Yes | Project description text |
| ❌ identifier | No | Cannot change project short code |
| ❌ owners | No | Not yet implemented |
| ❌ private | No | Not yet implemented |
| ❌ archived | No | Use separate archive endpoint |

## Programming Language Examples

### JavaScript/Node.js
```javascript
const updateProject = async (identifier, updates) => {
  const response = await fetch(`http://192.168.50.90:3458/api/projects/${identifier}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });

  return await response.json();
};

// Usage
const result = await updateProject('HULLY', {
  name: 'New Project Name',
  description: 'New description'
});
console.log(result);
```

### Python
```python
import requests

def update_project(identifier, **updates):
    url = f"http://192.168.50.90:3458/api/projects/{identifier}"
    response = requests.put(url, json=updates)
    return response.json()

# Usage
result = update_project('HULLY',
                       name='New Project Name',
                       description='New description')
print(result)
```

### Python with requests (Field/Value format)
```python
import requests

def update_project_field(identifier, field, value):
    url = f"http://192.168.50.90:3458/api/projects/{identifier}"
    data = {"field": field, "value": value}
    response = requests.put(url, json=data)
    return response.json()

# Usage
result = update_project_field('HULLY', 'name', 'New Name')
print(result)
```

### Shell Script
```bash
#!/bin/bash

PROJECT_ID="$1"
NEW_NAME="$2"
NEW_DESC="$3"

curl -X PUT "http://192.168.50.90:3458/api/projects/${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"${NEW_NAME}\", \"description\": \"${NEW_DESC}\"}"
```

Usage: `./update_project.sh HULLY "New Name" "New Description"`

## Complete Workflow Example

```bash
# 1. List all projects to find the identifier
curl -s http://192.168.50.90:3458/api/projects | jq -r 'keys[]'

# Output:
# HULLY
# PROJ1
# MYPROJECT

# 2. Get current project details
curl -s http://192.168.50.90:3458/api/projects | jq '.HULLY'

# 3. Update the project
curl -X PUT http://192.168.50.90:3458/api/projects/HULLY \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Huly MCP Integration",
    "description": "Main integration project for MCP tools"
  }'

# 4. Verify the update
curl -s http://192.168.50.90:3458/api/projects | jq '.HULLY'
```

## Health Check

Before using the API, verify the service is running:

```bash
curl http://192.168.50.90:3458/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "connected": true,
  "timestamp": "2025-11-02T17:18:11.269Z"
}
```

## Alternative: MCP Tool Endpoint (Port 3457)

If you prefer using the MCP tool system:

```bash
curl -X POST http://192.168.50.90:3457/api/tools/huly_entity \
  -H "Content-Type: application/json" \
  -d '{
    "arguments": {
      "entity_type": "project",
      "operation": "update",
      "project_identifier": "HULLY",
      "data": {
        "name": "New Name",
        "description": "New Description"
      }
    }
  }'
```

**Note:** The direct REST API (port 3458) is faster and has a simpler payload format.

## Troubleshooting

### Connection Refused
- Check if the service is running: `docker ps | grep rest-api`
- Verify port 3458 is accessible: `netstat -tlnp | grep 3458`
- Check service health: `curl http://192.168.50.90:3458/health`

### Invalid JSON
- Ensure JSON is properly formatted
- Use single quotes around the data string in curl
- Escape double quotes inside the JSON: `\"`

### No Response
- Check network connectivity to 192.168.50.90
- Verify firewall allows port 3458
- Check Docker logs: `docker logs huly-huly-rest-api-1`

## Important Notes

1. **Use IP Address:** Always use `192.168.50.90` instead of `localhost`
2. **Port 3458:** This is the direct REST API (fastest)
3. **Port 3457:** Alternative MCP tool endpoint (more validation)
4. **Identifiers are case-sensitive:** Use exact case for project identifiers
5. **Changes are immediate:** No undo functionality - plan carefully
6. **No identifier changes:** Cannot change the project short code via this API

## Rate Limiting

Currently no rate limiting is enforced. For production use, consider:
- Implementing request throttling
- Adding authentication
- Logging all update operations

## Documentation References

- Full API Documentation: `/opt/stacks/huly-selfhost/huly-rest-api/docs/PROJECT_UPDATE_API.md`
- Complete Guide: `/opt/stacks/huly-selfhost/PROJECT_UPDATE_COMPLETE.md`
- Deployment Status: `/opt/stacks/huly-selfhost/DEPLOYMENT_STATUS.md`
