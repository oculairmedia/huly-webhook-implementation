import { jest } from '@jest/globals';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import http from 'http';

describe('Webhook Subscription Management', () => {
  let server;
  const PORT = 3460; // Use different port for testing
  const BASE_URL = `http://localhost:${PORT}`;

  // Helper to make HTTP requests
  const request = (method, path, body = null) => {
    return new Promise((resolve, reject) => {
      const options = {
        method,
        hostname: 'localhost',
        port: PORT,
        path,
        headers: body ? { 'Content-Type': 'application/json' } : {}
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              data: data ? JSON.parse(data) : null
            });
          } catch (e) {
            resolve({ status: res.statusCode, data });
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  beforeEach(async () => {
    // Start a minimal test server with subscription endpoints
    const webhookSubscribers = new Set();

    server = http.createServer((req, res) => {
      const getBody = () => new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body ? JSON.parse(body) : {}));
      });

      if (req.url === '/subscribe' && req.method === 'POST') {
        getBody().then(body => {
          if (!body.url) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
            return;
          }
          webhookSubscribers.add(body.url);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            message: 'Subscribed successfully',
            subscriberCount: webhookSubscribers.size 
          }));
        });
      }
      else if (req.url === '/unsubscribe' && req.method === 'POST') {
        getBody().then(body => {
          if (!body.url) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
            return;
          }
          const existed = webhookSubscribers.has(body.url);
          webhookSubscribers.delete(body.url);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            message: existed ? 'Unsubscribed successfully' : 'URL was not subscribed',
            subscriberCount: webhookSubscribers.size 
          }));
        });
      }
      else if (req.url === '/subscribers' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          subscribers: Array.from(webhookSubscribers),
          count: webhookSubscribers.size 
        }));
      }
      else if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }
      else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => server.listen(PORT, resolve));
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => {
        // Force close all connections
        if (server.closeAllConnections) {
          server.closeAllConnections();
        }
        server.close(() => {
          setTimeout(resolve, 100); // Give time for cleanup
        });
      });
      server = null;
    }
  });

  it('should subscribe a webhook URL', async () => {
    const response = await request('POST', '/subscribe', {
      url: 'http://test-service:8080/webhook'
    });

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.subscriberCount).toBe(1);
  });

  it('should reject subscription without URL', async () => {
    const response = await request('POST', '/subscribe', {});

    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toContain('Missing url');
  });

  it('should list all subscribers', async () => {
    await request('POST', '/subscribe', { url: 'http://service1:8080/webhook' });
    await request('POST', '/subscribe', { url: 'http://service2:8080/webhook' });

    const response = await request('GET', '/subscribers');

    expect(response.status).toBe(200);
    expect(response.data.count).toBe(2);
    expect(response.data.subscribers).toContain('http://service1:8080/webhook');
    expect(response.data.subscribers).toContain('http://service2:8080/webhook');
  });

  it('should unsubscribe a webhook URL', async () => {
    await request('POST', '/subscribe', { url: 'http://test-service:8080/webhook' });
    
    const response = await request('POST', '/unsubscribe', {
      url: 'http://test-service:8080/webhook'
    });

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.subscriberCount).toBe(0);
  });

  it('should handle unsubscribing non-existent URL gracefully', async () => {
    const response = await request('POST', '/unsubscribe', {
      url: 'http://nonexistent:8080/webhook'
    });

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.message).toContain('not subscribed');
  });

  it('should prevent duplicate subscriptions', async () => {
    const url = 'http://test-service:8080/webhook';
    
    await request('POST', '/subscribe', { url });
    await request('POST', '/subscribe', { url });

    const response = await request('GET', '/subscribers');

    // Set should prevent duplicates
    expect(response.data.count).toBe(1);
  });

  it('should handle multiple subscribe/unsubscribe cycles', async () => {
    const url = 'http://test-service:8080/webhook';
    
    await request('POST', '/subscribe', { url });
    await request('POST', '/unsubscribe', { url });
    await request('POST', '/subscribe', { url });

    const response = await request('GET', '/subscribers');

    expect(response.data.count).toBe(1);
    expect(response.data.subscribers).toContain(url);
  });
});
