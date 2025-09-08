# Webhook Implementation Deployment Guide

This guide covers deploying the Huly platform with the enhanced webhook implementation including circuit breaker patterns and comprehensive UI management.

## 🚀 Quick Deploy with GitHub Actions (Recommended)

The fastest way to get webhook-enabled containers is through GitHub Actions:

### 1. Trigger the Build

```bash
# Push to trigger automatic build
git push origin webhook-implementation

# OR manually trigger with workflow dispatch
gh workflow run webhook-build.yml
```

### 2. Use Pre-built Images

The workflow builds and pushes images to GitHub Container Registry:

```bash
# Pull the webhook-enabled images
docker pull ghcr.io/oculairmedia/huly-selfhost/transactor:main-<commit-sha>
docker pull ghcr.io/oculairmedia/huly-selfhost/front:main-<commit-sha>
# ... and others
```

### 3. Deploy with Generated Configuration

Download the `docker-compose-webhook.yml` artifact from the workflow and deploy:

```bash
# Download and extract deployment artifacts from GitHub Actions
wget <artifact-download-url>

# Deploy with the webhook-enabled configuration
docker-compose -f docker-compose-webhook.yml up -d
```

## 🏗️ Local Development Build

For local development and testing:

### Prerequisites

- Node.js 18+ (version in `.nvmrc`)
- Docker and Docker Compose
- Rush.js (`npm install -g @microsoft/rush`)
- At least 8GB RAM and 4 CPU cores

### Build Process

```bash
# 1. Navigate to the hully source directory
cd "hully source"

# 2. Install dependencies
rush update

# 3. Build all packages  
rush build

# 4. Bundle for production
rush bundle

# 5. Build Docker images locally
rush docker:build

# 6. Go back to deployment directory
cd ..

# 7. Deploy using local images
docker-compose -f docker-compose-webhook.yml up -d
```

## 📊 What's Included in the Webhook Implementation

### Backend Components

- **Circuit Breaker Service** (`server-plugins/webhook-resources/src/circuitBreaker.ts`)
  - Three-state pattern (CLOSED, OPEN, HALF_OPEN)
  - Configurable failure thresholds
  - Health monitoring and recovery
  - Exponential backoff with jitter

- **Enhanced Delivery Service** (`server-plugins/webhook-resources/src/deliveryService.ts`)
  - Integration with circuit breaker
  - Graceful degradation handling
  - Comprehensive metrics tracking
  - HMAC-SHA256 signature generation

- **Webhook Models** (`models/webhook/src/index.ts`)
  - WebhookConfig, WebhookEvent, WebhookDeliveryAttempt
  - Complete type definitions
  - Event filtering and categorization

### Frontend Components

- **WebhookList.svelte**: Main management interface with status indicators
- **WebhookForm.svelte**: Comprehensive configuration form with event selection
- **WebhookTester.svelte**: Interactive testing with customizable payloads
- **WebhookEventLog.svelte**: Detailed event history with delivery tracking
- **WebhookStats.svelte**: Analytics dashboard with performance metrics
- **Presenter Components**: For displaying webhook data across the platform

## 🔧 Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Webhook-specific settings
WEBHOOK_ENABLED=true
WEBHOOK_CIRCUIT_BREAKER_ENABLED=true

# Optional webhook configuration
WEBHOOK_DEFAULT_TIMEOUT=30000
WEBHOOK_DEFAULT_RETRIES=3
WEBHOOK_RATE_LIMIT=100
WEBHOOK_RATE_LIMIT_PERIOD=3600000
```

### Webhook Configuration in Huly

After deployment, configure webhooks through the Huly admin interface:

1. **Access Admin Panel**: Navigate to System Settings → Webhooks
2. **Create Webhook**: Click "Create Webhook" button
3. **Configure Events**: Select which events to monitor
4. **Set URL**: Enter your webhook endpoint URL
5. **Security**: Generate HMAC secret for signature validation
6. **Advanced Settings**: Configure timeout, retries, rate limiting

### Available Event Types

The webhook implementation supports these event categories:

- **Issues**: `issue.created`, `issue.updated`, `issue.deleted`
- **Projects**: `project.created`, `project.updated`, `project.deleted`
- **Components**: `component.created`, `component.updated`, `component.deleted`
- **Milestones**: `milestone.created`, `milestone.updated`, `milestone.deleted`
- **Comments**: `comment.created`, `comment.updated`, `comment.deleted`

## 🔍 Monitoring and Troubleshooting

### Health Checks

```bash
# Check webhook service health
curl http://localhost:8101/api/webhooks/health

# Check circuit breaker status
curl http://localhost:8101/api/webhooks/circuit-status

# View delivery metrics
curl http://localhost:8101/api/webhooks/metrics
```

### Circuit Breaker States

- **CLOSED** (Green): Normal operation, requests flowing through
- **HALF_OPEN** (Yellow): Testing recovery, limited requests allowed
- **OPEN** (Red): Blocking requests, endpoint unhealthy

### Common Issues

**Build Failures:**
```bash
# Clean and rebuild
cd "hully source"
rush purge
rush update
rush build
```

**Container Issues:**
```bash
# Check container logs
docker-compose -f docker-compose-webhook.yml logs transactor
docker-compose -f docker-compose-webhook.yml logs front

# Restart services
docker-compose -f docker-compose-webhook.yml restart
```

**Webhook Delivery Failures:**
- Check webhook endpoint availability
- Verify HMAC signature configuration  
- Review circuit breaker status in admin panel
- Check network connectivity and DNS resolution

## 📈 Performance Considerations

### Resource Requirements

**Minimum:**
- 4GB RAM, 2 CPU cores
- 20GB disk space

**Recommended:**
- 8GB RAM, 4 CPU cores  
- 50GB disk space
- SSD storage for database

### Scaling

For high-volume webhook delivery:

1. **Horizontal Scaling**: Deploy multiple transactor instances
2. **Database Optimization**: Use MongoDB replica sets
3. **Load Balancing**: Add Nginx upstream configuration
4. **Monitoring**: Implement Prometheus/Grafana monitoring

## 🔐 Security Best Practices

1. **HMAC Signatures**: Always enable webhook secrets
2. **HTTPS**: Use SSL/TLS for webhook endpoints
3. **Rate Limiting**: Configure appropriate rate limits
4. **Network Security**: Implement firewalls and VPNs
5. **Secret Management**: Use environment variables for secrets

## 📚 Additional Resources

- **Circuit Breaker Pattern**: Martin Fowler's Circuit Breaker documentation
- **Webhook Security**: OWASP Webhook Security Guidelines  
- **Huly Documentation**: Official Huly platform documentation
- **Docker Best Practices**: Official Docker documentation

## 🆘 Support

If you encounter issues with the webhook implementation:

1. Check the container logs first
2. Review the circuit breaker status in admin panel
3. Test webhook endpoints manually with curl
4. Verify environment variable configuration
5. Check network connectivity between services

For development questions, refer to the comprehensive webhook guides in the `hully source` directory.