# Use the existing working MCP image as base for dependencies
FROM huly-huly-mcp:latest AS working-deps

# Final image
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Copy working node_modules from the existing MCP image (has all Huly SDK packages)
COPY --from=working-deps /app/node_modules ./node_modules

# Install only the additional packages we need (express, cors, ws already in MCP)
# The Huly SDK packages are already copied from working-deps
RUN npm install express@^4.18.2 cors@^2.8.5 --no-save

# Copy application code
COPY server.js ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 3458

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=3458

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3458/health', (r) => {let d=''; r.on('data', (c) => d+=c); r.on('end', () => {if(JSON.parse(d).status==='ok') process.exit(0); process.exit(1)})})"

# Start server
CMD ["node", "server.js"]
