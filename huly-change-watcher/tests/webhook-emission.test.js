import { jest } from '@jest/globals';
import { describe, it, expect, beforeEach } from '@jest/globals';
import http from 'http';

describe('Webhook Emission', () => {
  let mockWebhookServer;
  let receivedWebhooks = [];
  const WEBHOOK_PORT = 3461;

  beforeEach(async () => {
    receivedWebhooks = [];

    // Create a mock webhook receiver
    mockWebhookServer = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          receivedWebhooks.push({
            timestamp: Date.now(),
            body: JSON.parse(body)
          });
          res.writeHead(200);
          res.end(JSON.stringify({ received: true }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => mockWebhookServer.listen(WEBHOOK_PORT, resolve));
  });

  afterEach(async () => {
    if (mockWebhookServer) {
      await new Promise((resolve) => {
        // Force close all connections
        if (mockWebhookServer.closeAllConnections) {
          mockWebhookServer.closeAllConnections();
        }
        mockWebhookServer.close(() => {
          setTimeout(resolve, 100); // Give time for cleanup
        });
      });
      mockWebhookServer = null;
    }
  });

  it('should emit webhook for issue changes', async () => {
    const webhookUrl = `http://localhost:${WEBHOOK_PORT}/webhook`;
    const event = {
      type: 'issue.updated',
      timestamp: new Date().toISOString(),
      data: {
        id: 'issue-123',
        class: 'tracker:class:Issue',
        space: 'project-abc',
        identifier: 'PROJ-1',
        title: 'Fix bug',
        status: 'InProgress'
      }
    };

    // Simulate webhook emission
    const sendWebhook = (url, payload) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const urlObj = new URL(url);
        
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          },
          timeout: 5000
        };

        const req = http.request(options, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Webhook timeout'));
        });

        req.write(data);
        req.end();
      });
    };

    const response = await sendWebhook(webhookUrl, event);

    expect(response.status).toBe(200);
    expect(receivedWebhooks).toHaveLength(1);
    expect(receivedWebhooks[0].body.type).toBe('issue.updated');
    expect(receivedWebhooks[0].body.data.identifier).toBe('PROJ-1');
  });

  it('should emit webhook for project changes', async () => {
    const webhookUrl = `http://localhost:${WEBHOOK_PORT}/webhook`;
    const event = {
      type: 'project.updated',
      timestamp: new Date().toISOString(),
      data: {
        id: 'project-xyz',
        class: 'tracker:class:Project',
        name: 'New Project',
        identifier: 'NEWP',
        archived: false
      }
    };

    const sendWebhook = (url, payload) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const urlObj = new URL(url);
        
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          },
          timeout: 5000
        };

        const req = http.request(options, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });

        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };

    const response = await sendWebhook(webhookUrl, event);

    expect(response.status).toBe(200);
    expect(receivedWebhooks).toHaveLength(1);
    expect(receivedWebhooks[0].body.type).toBe('project.updated');
    expect(receivedWebhooks[0].body.data.name).toBe('New Project');
  });

  it('should handle webhook timeout gracefully', async () => {
    // Create a slow webhook server
    const slowServer = http.createServer((req, res) => {
      // Never respond - simulate timeout
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 10000);
    });

    await new Promise(resolve => slowServer.listen(3462, resolve));

    const webhookUrl = 'http://localhost:3462/webhook';
    const event = { type: 'test', data: {} };

    const sendWebhook = (url, payload) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const urlObj = new URL(url);
        
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 100 // Short timeout for test
        };

        const req = http.request(options, (res) => {
          resolve({ status: res.statusCode });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Webhook timeout'));
        });

        req.write(data);
        req.end();
      });
    };

    await expect(sendWebhook(webhookUrl, event)).rejects.toThrow('Webhook timeout');

    await new Promise(resolve => slowServer.close(resolve));
  });

  it('should handle webhook server errors', async () => {
    // Close the server to simulate connection refused
    await new Promise(resolve => mockWebhookServer.close(resolve));

    const webhookUrl = `http://localhost:${WEBHOOK_PORT}/webhook`;
    const event = { type: 'test', data: {} };

    const sendWebhook = (url, payload) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const urlObj = new URL(url);
        
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
          resolve({ status: res.statusCode });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };

    await expect(sendWebhook(webhookUrl, event)).rejects.toThrow();
  });
});
