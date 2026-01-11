#!/bin/bash

echo "=== Testing include_descriptions parameter ==="
echo ""

echo "1. Testing with include_descriptions=true (should have descriptions):"
docker exec huly-test-huly-mcp-1 node -e "
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/tools/huly_query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const result = JSON.parse(data);
    const text = result.data?.result?.content?.[0]?.text || '';
    const lines = text.split('\\n').slice(0, 30);
    console.log(lines.join('\\n'));
  });
});

req.on('error', (e) => { console.error(e.message); });
req.write(JSON.stringify({
  arguments: {
    entity_type: 'issue',
    mode: 'list',
    project_identifier: 'HULLY',
    options: { limit: 2, include_descriptions: true }
  }
}));
req.end();
"

echo ""
echo "2. Testing with include_descriptions=false (should NOT have descriptions):"
docker exec huly-test-huly-mcp-1 node -e "
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/tools/huly_query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const result = JSON.parse(data);
    const text = result.data?.result?.content?.[0]?.text || '';
    const lines = text.split('\\n').slice(0, 30);
    console.log(lines.join('\\n'));
  });
});

req.on('error', (e) => { console.error(e.message); });
req.write(JSON.stringify({
  arguments: {
    entity_type: 'issue',
    mode: 'list',
    project_identifier: 'HULLY',
    options: { limit: 2, include_descriptions: false }
  }
}));
req.end();
"
