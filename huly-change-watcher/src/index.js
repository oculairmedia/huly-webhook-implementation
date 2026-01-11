/**
 * Huly Change Watcher
 * 
 * Polls CockroachDB for changes to the task table and emits webhook events.
 * This avoids the need for expensive full-table polling by vibe-sync.
 */

const { Pool } = require('pg');

const config = {
  // CockroachDB connection
  db: {
    host: process.env.COCKROACH_HOST || 'cockroachdb',
    port: parseInt(process.env.COCKROACH_PORT || '26257'),
    database: process.env.COCKROACH_DATABASE || 'defaultdb',
    user: process.env.COCKROACH_USER || 'root',
    password: process.env.COCKROACH_PASSWORD || '',
    ssl: false
  },
  // Polling interval in ms
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000'),
  // Webhook endpoints to notify
  webhookUrls: (process.env.WEBHOOK_URLS || 'http://huly-vibe-sync:3000/webhook').split(','),
  // HTTP server port
  port: parseInt(process.env.PORT || '3459')
};

class ChangeWatcher {
  constructor() {
    this.pool = new Pool(config.db);
    this.lastChecked = Date.now();
    this.subscribers = new Set();
    this.webhookSubscribers = new Set(config.webhookUrls); // Dynamic webhook subscribers
    this.isRunning = false;
    this.stats = {
      checksPerformed: 0,
      changesDetected: 0,
      webhooksSent: 0,
      errors: 0
    };
  }

  async start() {
    console.log('Starting Huly Change Watcher...');
    console.log(`Poll interval: ${config.pollInterval}ms`);
    console.log(`Webhook URLs: ${config.webhookUrls.join(', ')}`);
    
    // Test DB connection
    try {
      const client = await this.pool.connect();
      console.log('Connected to CockroachDB');
      client.release();
    } catch (err) {
      console.error('Failed to connect to CockroachDB:', err.message);
      process.exit(1);
    }

    this.isRunning = true;
    this.poll();
  }

  async poll() {
    if (!this.isRunning) return;

    try {
      const changes = await this.checkForChanges();
      if (changes.length > 0) {
        console.log(`Detected ${changes.length} changes`);
        await this.emitWebhooks(changes);
      }
    } catch (err) {
      console.error('Poll error:', err.message);
      this.stats.errors++;
    }

    setTimeout(() => this.poll(), config.pollInterval);
  }

  async checkForChanges() {
    this.stats.checksPerformed++;
    const lastCheckedMs = this.lastChecked;
    this.lastChecked = Date.now();

    // Query for both tasks (issues) and spaces (projects) modified since last check
    // modifiedOn is stored as bigint (milliseconds timestamp)
    
    // Query 1: Task changes (issues, sub-issues, etc.)
    const taskQuery = `
      SELECT 
        _id as id,
        _class as class,
        space,
        "modifiedOn",
        "modifiedBy",
        data->>'identifier' as identifier,
        data->>'title' as title,
        data->>'status' as status,
        'task' as table_name
      FROM task
      WHERE "modifiedOn" > $1
      ORDER BY "modifiedOn" DESC
      LIMIT 100
    `;

    // Query 2: Space changes (projects)
    const spaceQuery = `
      SELECT 
        _id as id,
        _class as class,
        _id as space,
        "modifiedOn",
        "modifiedBy",
        data->>'identifier' as identifier,
        data->>'name' as title,
        data->>'archived' as status,
        'space' as table_name
      FROM space
      WHERE "modifiedOn" > $1
        AND _class = 'tracker:class:Project'
      ORDER BY "modifiedOn" DESC
      LIMIT 50
    `;

    const [taskResult, spaceResult] = await Promise.all([
      this.pool.query(taskQuery, [lastCheckedMs]),
      this.pool.query(spaceQuery, [lastCheckedMs])
    ]);
    
    const totalChanges = taskResult.rows.length + spaceResult.rows.length;
    if (totalChanges > 0) {
      this.stats.changesDetected += totalChanges;
    }

    // Map task changes
    const taskChanges = taskResult.rows.map(row => ({
      type: row.class === 'tracker:class:Issue' ? 'issue.updated' : 'task.updated',
      timestamp: Date.now(),
      data: {
        id: row.id,
        class: row.class,
        space: row.space,
        identifier: row.identifier,
        title: row.title,
        status: row.status,
        modifiedOn: row.modifiedOn,
        modifiedBy: row.modifiedBy
      }
    }));

    // Map project changes
    const projectChanges = spaceResult.rows.map(row => ({
      type: 'project.updated',
      timestamp: Date.now(),
      data: {
        id: row.id,
        class: row.class,
        identifier: row.identifier,
        name: row.title,
        archived: row.status === 'true',
        modifiedOn: row.modifiedOn,
        modifiedBy: row.modifiedBy
      }
    }));

    // Combine and sort by modifiedOn timestamp
    return [...taskChanges, ...projectChanges].sort((a, b) => 
      b.data.modifiedOn - a.data.modifiedOn
    );
  }

  async emitWebhooks(changes) {
    const payload = {
      source: 'huly-change-watcher',
      timestamp: Date.now(),
      events: changes
    };

    const promises = Array.from(this.webhookSubscribers).map(async (url) => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          this.stats.webhooksSent++;
          console.log(`Webhook sent to ${url}: ${changes.length} events`);
        } else {
          console.error(`Webhook failed for ${url}: ${response.status}`);
        }
      } catch (err) {
        console.error(`Webhook error for ${url}:`, err.message);
      }
    });

    // Also notify SSE subscribers
    this.notifySubscribers(changes);

    await Promise.allSettled(promises);
  }

  // Webhook subscription management
  addWebhookSubscriber(url) {
    this.webhookSubscribers.add(url);
    console.log(`Webhook subscriber added: ${url}`);
    return { success: true, subscriberCount: this.webhookSubscribers.size };
  }

  removeWebhookSubscriber(url) {
    const deleted = this.webhookSubscribers.delete(url);
    if (deleted) {
      console.log(`Webhook subscriber removed: ${url}`);
    }
    return { success: deleted, subscriberCount: this.webhookSubscribers.size };
  }

  listWebhookSubscribers() {
    return Array.from(this.webhookSubscribers);
  }

  // SSE support for real-time subscribers
  addSubscriber(res) {
    this.subscribers.add(res);
    res.on('close', () => this.subscribers.delete(res));
  }

  notifySubscribers(changes) {
    const data = JSON.stringify({ events: changes });
    for (const res of this.subscribers) {
      try {
        res.write(`data: ${data}\n\n`);
      } catch (err) {
        this.subscribers.delete(res);
      }
    }
  }

  getStats() {
    return {
      ...this.stats,
      sseSubscriberCount: this.subscribers.size,
      webhookSubscriberCount: this.webhookSubscribers.size,
      lastChecked: this.lastChecked,
      isRunning: this.isRunning
    };
  }

  stop() {
    this.isRunning = false;
    this.pool.end();
  }
}

// HTTP server for health checks and SSE subscriptions
const http = require('http');
const watcher = new ChangeWatcher();

const server = http.createServer((req, res) => {
  // Parse request body helper
  const getBody = (req) => {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  };

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ...watcher.getStats() }));
  } 
  else if (req.url === '/events') {
    // SSE endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('data: {"connected": true}\n\n');
    watcher.addSubscriber(res);
  } 
  else if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(watcher.getStats(), null, 2));
  }
  else if (req.url === '/subscribe' && req.method === 'POST') {
    getBody(req)
      .then(body => {
        if (!body.url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "url" field in request body' }));
          return;
        }
        const result = watcher.addWebhookSubscriber(body.url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  else if (req.url === '/unsubscribe' && req.method === 'POST') {
    getBody(req)
      .then(body => {
        if (!body.url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "url" field in request body' }));
          return;
        }
        const result = watcher.removeWebhookSubscriber(body.url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  else if (req.url === '/subscribers' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      webhookSubscribers: watcher.listWebhookSubscribers(),
      count: watcher.webhookSubscribers.size
    }));
  }
  else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(config.port, () => {
  console.log(`HTTP server listening on port ${config.port}`);
  console.log(`  Health: http://localhost:${config.port}/health`);
  console.log(`  Stats: http://localhost:${config.port}/stats`);
  console.log(`  Events SSE: http://localhost:${config.port}/events`);
  console.log(`  Subscribe: POST http://localhost:${config.port}/subscribe`);
  console.log(`  Unsubscribe: POST http://localhost:${config.port}/unsubscribe`);
  console.log(`  List Subscribers: GET http://localhost:${config.port}/subscribers`);
  watcher.start();
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  watcher.stop();
  server.close();
});
