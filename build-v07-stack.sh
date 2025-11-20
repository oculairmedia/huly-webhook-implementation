#!/bin/bash
#
# Build script for Huly v0.7 stack
# Builds MCP server and REST API with SDK from Huly source
#

set -e  # Exit on error

echo "=========================================="
echo "Huly v0.7 Stack Builder"
echo "=========================================="
echo ""

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HULY_SOURCE_DIR="$SCRIPT_DIR/hully source"
MCP_DIR="$SCRIPT_DIR/huly-mcp-server"
REST_API_DIR="$SCRIPT_DIR/huly-rest-api"

# Check prerequisites
echo "[1/6] Checking prerequisites..."
if [ ! -d "$HULY_SOURCE_DIR" ]; then
    echo "ERROR: Huly source not found at: $HULY_SOURCE_DIR"
    exit 1
fi

if [ ! -d "$MCP_DIR" ]; then
    echo "ERROR: MCP server not found at: $MCP_DIR"
    exit 1
fi

if [ ! -d "$REST_API_DIR" ]; then
    echo "ERROR: REST API not found at: $REST_API_DIR"
    exit 1
fi

# Check and initialize git submodules
echo "  Checking git submodules..."
cd "$HULY_SOURCE_DIR"
if [ -f .gitmodules ]; then
    if [ ! -f "communication/packages/client-query/package.json" ]; then
        echo "  Initializing git submodules..."
        git submodule update --init --recursive
    fi
fi
cd "$SCRIPT_DIR"

echo "✅ All source directories found"
echo ""

# Build MCP Server
echo "[2/6] Building Huly MCP Server v0.7..."
cd "$MCP_DIR"

# Copy Huly source to MCP build context (tar preserves submodules)
echo "  Copying Huly source to build context..."
rm -rf "./hully source"
(cd "$HULY_SOURCE_DIR" && tar cf - .) | (mkdir -p "./hully source" && cd "./hully source" && tar xf -)

# Build MCP server (using single-stage Dockerfile.v07)
echo "  Building Docker image..."
docker build -t huly-huly-mcp:v0.7 -f Dockerfile.v07 .

# Cleanup
echo "  Cleaning up build context..."
rm -rf "./hully source"

echo "✅ MCP Server v0.7 built successfully"
echo ""

# Build REST API
echo "[3/6] Building Huly REST API v0.7..."
cd "$REST_API_DIR"

# Copy Huly source to REST API build context (tar preserves submodules)
echo "  Copying Huly source to build context..."
rm -rf "./hully source"
(cd "$HULY_SOURCE_DIR" && tar cf - .) | (mkdir -p "./hully source" && cd "./hully source" && tar xf -)

# Build REST API (using single-stage Dockerfile.v07)
echo "  Building Docker image..."
docker build -t huly-huly-rest-api:v0.7 -f Dockerfile.v07 .

# Cleanup
echo "  Cleaning up build context..."
rm -rf "./hully source"

echo "✅ REST API v0.7 built successfully"
echo ""

# Tag as latest
echo "[4/6] Tagging images as 'latest'..."
docker tag huly-huly-mcp:v0.7 huly-huly-mcp:latest
docker tag huly-huly-rest-api:v0.7 huly-huly-rest-api:latest
echo "✅ Images tagged"
echo ""

# List images
echo "[5/6] Built images:"
docker images | grep -E "REPOSITORY|huly-huly-(mcp|rest-api)"
echo ""

# Instructions
echo "[6/6] Next steps:"
echo ""
echo "To start the v0.7 stack:"
echo "  cd $SCRIPT_DIR"
echo "  docker-compose up -d"
echo ""
echo "To verify services:"
echo "  docker-compose ps"
echo "  curl http://localhost:8201/health"
echo "  curl http://localhost:8201/mcp/health"
echo ""
echo "✅ Build complete!"
