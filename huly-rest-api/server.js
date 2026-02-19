/**
 * Huly REST API Server
 *
 * Provides REST endpoints for Huly platform operations, bypassing the MCP protocol
 * to provide better performance for bulk operations and batch issue fetching.
 */

import express from 'express';
import cors from 'cors';
import apiClientModule from '@hcengineering/api-client';
import accountClientModule from '@hcengineering/account-client';
import coreModule from '@hcengineering/core';
import trackerModule from '@hcengineering/tracker';
import WebSocket from 'ws';
import textModule from '@hcengineering/text';
import textMarkdownModule from '@hcengineering/text-markdown';

const apiClient = apiClientModule.default || apiClientModule;
const { connect } = apiClient;
const accountClient = accountClientModule.default || accountClientModule;
const { getClient: getAccountClient } = accountClient;
const core = coreModule.default || coreModule;
const { TxFactory, TxOperations } = coreModule;
const tracker = trackerModule.default || trackerModule;
const textPkg = textModule.default || textModule;
const textMdPkg = textMarkdownModule.default || textMarkdownModule;
const { jsonToMarkup } = textPkg;
const { markdownToMarkup } = textMdPkg;
const { makeCollabId } = coreModule;

const app = express();
const PORT = process.env.PORT || 3458;

/**
 * HULLY-259: uploadMarkup calls collaborator's createContent which rejects existing docs.
 * For updates, use collaborator's updateContent via client.markup.collaborator.updateMarkup.
 */
async function updateDescriptionMarkup(client, issue, text) {
  if (!text || text.trim() === '') return '';

  const markupOps = client.markup;
  if (!markupOps || !markupOps.collaborator) {
    return await client.uploadMarkup(tracker.class.Issue, issue._id, 'description', text.trim(), 'markdown');
  }

  const markup = jsonToMarkup(
    markdownToMarkup(text.trim(), {
      refUrl: markupOps.refUrl || '',
      imageUrl: markupOps.imageUrl || '',
    })
  );

  const collabId = makeCollabId(tracker.class.Issue, issue._id, 'description');
  await markupOps.collaborator.updateMarkup(collabId, markup);

  return issue.description || '';
}

// Middleware
app.use(cors());
app.use(express.json());

const config = {
  hulyUrl: process.env.HULY_URL || 'http://192.168.50.90:8101',
  transactorUrl: process.env.HULY_TRANSACTOR_URL,
  transactorUrls: (process.env.HULY_TRANSACTOR_URLS || process.env.HULY_TRANSACTOR_URL || '').split(';').filter(Boolean),
  email: process.env.HULY_EMAIL || 'emanuvaderland@gmail.com',
  password: process.env.HULY_PASSWORD,
  workspace: process.env.HULY_WORKSPACE || 'agentspace',
};

// Connection pool for parallel operations across multiple transactors
let hulyClient = null;
let txOps = null;
let clientPool = [];
let poolIndex = 0;
let cachedToken = null;
let healthCheckInterval = null;
const POOL_HEALTH_CHECK_INTERVAL = 30000;

// Connection resilience configuration
const CONNECTION_CONFIG = {
  // Timeout for each individual transactor connection attempt
  connectionTimeout: 30000, // 30 seconds
  // Minimum number of healthy transactors required to start
  minHealthyTransactors: 1,
  // Health check timeout
  healthCheckTimeout: 5000, // 5 seconds
  // Retry configuration for failed connections
  retryAttempts: 2,
  retryDelay: 2000, // 2 seconds between retries
};

class TTLCache {
  constructor(maxSize = 200, defaultTTL = 300000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.hits = 0;
    this.misses = 0;
    this.staleHits = 0;
    this._revalidating = new Set();
  }
  
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.data;
  }
  
  getRaw(key) {
    return this.cache.get(key) || null;
  }
  
  set(key, data, ttl) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expires: Date.now() + (ttl || this.defaultTTL), timestamp: Date.now() });
  }
  
  invalidate(pattern) {
    if (typeof pattern === 'string') {
      for (const key of this.cache.keys()) {
        if (key.startsWith(pattern)) this.cache.delete(key);
      }
    }
  }
  
  clear() { this.cache.clear(); }
  get size() { return this.cache.size; }
  get hitRate() {
    const total = this.hits + this.misses + this.staleHits;
    return total === 0 ? 0 : Math.round(((this.hits + this.staleHits) / total) * 100);
  }
  get stats() {
    return { size: this.cache.size, hits: this.hits, misses: this.misses, staleHits: this.staleHits, hitRate: this.hitRate };
  }
  isRevalidating(key) { return this._revalidating.has(key); }
  markRevalidating(key) { this._revalidating.add(key); }
  clearRevalidating(key) { this._revalidating.delete(key); }
}

const metadataCache = new TTLCache(500, 300000);
const CACHE_TTL = {
  projects: 180000,
  statuses: 600000,
  components: 300000,
  milestones: 300000,
  accounts: 600000,
  issueCount: 120000,
  descriptions: 300000,
};

const inflight = new Map();

async function coalescedFindAll(client, cls, query, options) {
  const key = JSON.stringify({ cls: String(cls), query, options });
  if (inflight.has(key)) {
    return inflight.get(key);
  }
  const promise = client.findAll(cls, query, options).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

async function getWithSWR(cacheKey, fetcher, { ttl, staleTTL } = {}) {
  ttl = ttl || 300000;
  staleTTL = staleTTL || ttl * 2;
  const cached = metadataCache.getRaw(cacheKey);
  
  if (cached && Date.now() < cached.expires) {
    metadataCache.hits++;
    return cached.data;
  }
  
  if (cached && Date.now() - cached.timestamp < staleTTL) {
    metadataCache.staleHits++;
    if (!metadataCache.isRevalidating(cacheKey)) {
      metadataCache.markRevalidating(cacheKey);
      fetcher()
        .then(data => metadataCache.set(cacheKey, data, ttl))
        .catch(() => {})
        .finally(() => metadataCache.clearRevalidating(cacheKey));
    }
    return cached.data;
  }
  
  metadataCache.misses++;
  const data = await fetcher();
  metadataCache.set(cacheKey, data, ttl);
  return data;
}

const QUERY_TIMEOUT = parseInt(process.env.HULY_QUERY_TIMEOUT_MS || '15000', 10);

async function findAllWithTimeout(client, cls, query, options, timeoutMs) {
  timeoutMs = timeoutMs || QUERY_TIMEOUT;
  try {
    return await Promise.race([
      client.findAll(cls, query, options),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Query timeout (${timeoutMs}ms)`)), timeoutMs)
      ),
    ]);
  } catch (err) {
    const cacheKey = `findAll:${String(cls)}:${JSON.stringify(query)}`;
    const stale = metadataCache.getRaw(cacheKey);
    if (stale) {
      console.warn(`[Huly REST] Query timed out, serving stale data for ${cacheKey}`);
      metadataCache.staleHits++;
      return stale.data;
    }
    throw err;
  }
}

async function getCachedStatuses(projectId) {
  return getWithSWR(`statuses:${projectId}`, async () => {
    const client = getNextClient();
    let statuses = await coalescedFindAll(client, tracker.class.IssueStatus, { space: projectId });
    if (statuses.length === 0) {
      statuses = await coalescedFindAll(client, tracker.class.IssueStatus, { space: 'core:space:Model' });
    }
    return statuses;
  }, { ttl: CACHE_TTL.statuses });
}

async function getCachedComponents(projectId) {
  return getWithSWR(`components:${projectId}`, async () => {
    return coalescedFindAll(getNextClient(), tracker.class.Component, { space: projectId });
  }, { ttl: CACHE_TTL.components });
}

async function getCachedMilestones(projectId) {
  return getWithSWR(`milestones:${projectId}`, async () => {
    return coalescedFindAll(getNextClient(), tracker.class.Milestone, { space: projectId });
  }, { ttl: CACHE_TTL.milestones });
}

async function getCachedProjects() {
  return getWithSWR('projects:all', async () => {
    return coalescedFindAll(getNextClient(), tracker.class.Project, {});
  }, { ttl: CACHE_TTL.projects });
}

async function getCachedAccounts() {
  return getWithSWR('accounts:all', async () => {
    return coalescedFindAll(getNextClient(), core.class.Account, {});
  }, { ttl: CACHE_TTL.accounts });
}

function createSocketFactory() {
  return (url) => {
    let targetUrl = url;
    if (config.transactorUrl) {
      targetUrl = url.replace(/wss?:\/\/[^\/]+/, config.transactorUrl);
      console.log('[Huly REST] WebSocket connecting to:', targetUrl, '(internal)');
    } else {
      console.log('[Huly REST] WebSocket connecting to:', url);
    }
    return new WebSocket(targetUrl);
  };
}

/**
 * Connect to a single transactor with timeout and retry logic
 * @param {string} transactorUrl - The transactor WebSocket URL
 * @param {string} token - Authentication token
 * @param {number} attempt - Current attempt number (for logging)
 * @returns {Promise<{client: object, transactorUrl: string} | null>}
 */
async function connectToTransactor(transactorUrl, token, attempt = 1) {
  const maxAttempts = CONNECTION_CONFIG.retryAttempts;
  
  for (let retry = 0; retry < maxAttempts; retry++) {
    const attemptNum = retry + 1;
    try {
      console.log(`[Huly REST] Connecting to ${transactorUrl} (attempt ${attemptNum}/${maxAttempts})...`);
      
      const connectionPromise = connect(config.hulyUrl, {
        token: token,
        workspace: config.workspace,
        socketFactory: (url) => {
          const internalUrl = `${transactorUrl}/${token}`;
          console.log(`[Huly REST]   -> WebSocket: ${internalUrl.slice(0, 80)}...`);
          return new WebSocket(internalUrl);
        },
      });
      
      // Race against timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Connection timeout after ${CONNECTION_CONFIG.connectionTimeout}ms`)), 
          CONNECTION_CONFIG.connectionTimeout);
      });
      
      const client = await Promise.race([connectionPromise, timeoutPromise]);
      
      // Verify the connection is healthy
      const isHealthy = await verifyTransactorHealth(client, transactorUrl);
      if (!isHealthy) {
        console.warn(`[Huly REST] ⚠ ${transactorUrl} connected but failed health check`);
        try { await client.close(); } catch (e) { /* ignore */ }
        throw new Error('Health check failed');
      }
      
      console.log(`[Huly REST] ✅ ${transactorUrl} connected and healthy`);
      return { client, transactorUrl };
      
    } catch (error) {
      console.warn(`[Huly REST] ⚠ ${transactorUrl} attempt ${attemptNum} failed: ${error.message}`);
      
      if (retry < maxAttempts - 1) {
        console.log(`[Huly REST]   Retrying in ${CONNECTION_CONFIG.retryDelay}ms...`);
        await new Promise(r => setTimeout(r, CONNECTION_CONFIG.retryDelay));
      }
    }
  }
  
  console.error(`[Huly REST] ❌ ${transactorUrl} failed after ${maxAttempts} attempts`);
  return null;
}

/**
 * Verify a transactor connection is healthy by running a simple query
 * @param {object} client - The connected client
 * @param {string} transactorUrl - For logging
 * @returns {Promise<boolean>}
 */
async function verifyTransactorHealth(client, transactorUrl) {
  try {
    const healthPromise = (async () => {
      // Try to access the hierarchy - this validates the connection is working
      const hierarchy = client.getHierarchy();
      if (!hierarchy) {
        throw new Error('Unable to access client hierarchy');
      }
      return true;
    })();
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), CONNECTION_CONFIG.healthCheckTimeout);
    });
    
    return await Promise.race([healthPromise, timeoutPromise]);
  } catch (error) {
    console.warn(`[Huly REST] Health check failed for ${transactorUrl}: ${error.message}`);
    return false;
  }
}

/**
 * Initialize client with internal Docker network connection for better performance.
 * 
 * The key insight: @hcengineering/api-client's connect() calls selectWorkspace() with
 * kind='external' by default, which returns external URLs (wss://pm.oculair.ca/...).
 * 
 * For Docker-internal connections, we need to:
 * 1. Login to get a token
 * 2. Call selectWorkspace(workspace, 'internal') to get internal endpoint + token
 * 3. Connect using the internal endpoint with internal-valid token
 * 
 * This avoids the extra network hop through external reverse proxy.
 */
async function initializeClient() {
  const maxAttempts = 10;
  const initialDelay = 3000;
  const backoffFactor = 1.5;
  const maxDelay = 15000;
  
  console.log('[Huly REST] Waiting 10s for services to initialize...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  let retryCount = 0;
  
  while (retryCount < maxAttempts) {
    try {
      console.log('[Huly REST] ========================================');
      console.log('[Huly REST] Connection attempt', retryCount + 1, 'of', maxAttempts);
      console.log('[Huly REST] URL:', config.hulyUrl);
      console.log('[Huly REST] Email:', config.email);
      console.log('[Huly REST] Workspace:', config.workspace);
      console.log('[Huly REST] Internal transactor URL:', config.transactorUrl || '(not configured)');
      console.log('[Huly REST] ========================================');

      if (config.transactorUrl) {
        await initializeInternalConnection();
      } else {
        await initializeExternalConnection();
      }

      console.log('[Huly REST] ✅ Successfully connected to Huly platform');
      
      if (hulyClient.client && typeof hulyClient.client.apply === 'function') {
        txOps = hulyClient.client;
        console.log('[Huly REST] ✅ TxOperations available for batch transactions');
      } else {
        console.log('[Huly REST] ⚠ TxOperations not accessible, using sequential mode');
      }
      
      console.log('[Huly REST] Verifying connection...');
      const testProjects = await hulyClient.findAll(tracker.class.Project, {}, { limit: 1 });
      console.log('[Huly REST] ✅ Connection verified, found', testProjects.length, 'test project(s)');
      
      return true;
    } catch (error) {
      retryCount++;
      console.error('[Huly REST] ❌ Connection attempt failed:', error.message);
      console.error('[Huly REST] Error name:', error.name);
      console.error('[Huly REST] Error stack:', error.stack?.split('\n').slice(0, 5));
      
      if (retryCount >= maxAttempts) {
        console.error('[Huly REST] ❌ All connection attempts failed');
        throw error;
      }
      
      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, retryCount - 1),
        maxDelay
      );
      
      console.log(`[Huly REST] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function initializeInternalConnection() {
  console.log('[Huly REST] Attempting internal connection via Docker network...');
  
  const accountUrl = `${config.hulyUrl}/_accounts`;
  console.log('[Huly REST] Account service URL:', accountUrl);
  
  const accountClientInstance = getAccountClient(accountUrl);
  const loginInfo = await accountClientInstance.login(config.email, config.password);
  console.log('[Huly REST] ✅ Login successful');
  
  const authenticatedAccountClient = getAccountClient(accountUrl, loginInfo.token);
  const wsLoginInfo = await authenticatedAccountClient.selectWorkspace(config.workspace, 'internal');
  
  if (!wsLoginInfo) {
    throw new Error(`Workspace ${config.workspace} not found`);
  }
  
  console.log('[Huly REST] ✅ Workspace selected (internal mode)');
  
  const transactorUrls = config.transactorUrls.length > 0 
    ? config.transactorUrls 
    : [config.transactorUrl];
  
  console.log('[Huly REST] Connecting to', transactorUrls.length, 'transactor(s) in parallel...');
  
  const connectionPromises = transactorUrls.map((url, idx) => 
    connectToTransactor(url, wsLoginInfo.token, idx + 1)
  );
  
  const results = await Promise.allSettled(connectionPromises);
  
  const successfulConnections = [];
  const failedTransactors = [];
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const url = transactorUrls[i];
    
    if (result.status === 'fulfilled' && result.value !== null) {
      successfulConnections.push(result.value);
    } else {
      const reason = result.status === 'rejected' ? result.reason?.message : 'Connection returned null';
      failedTransactors.push({ url, reason });
    }
  }
  
  console.log('[Huly REST] ----------------------------------------');
  console.log(`[Huly REST] Connection results: ${successfulConnections.length}/${transactorUrls.length} succeeded`);
  
  if (failedTransactors.length > 0) {
    console.warn('[Huly REST] Failed transactors:');
    for (const { url, reason } of failedTransactors) {
      console.warn(`[Huly REST]   ❌ ${url}: ${reason}`);
    }
  }
  
  if (successfulConnections.length < CONNECTION_CONFIG.minHealthyTransactors) {
    throw new Error(
      `Insufficient healthy transactors: ${successfulConnections.length}/${transactorUrls.length} ` +
      `(minimum required: ${CONNECTION_CONFIG.minHealthyTransactors})`
    );
  }
  
  clientPool = successfulConnections.map(c => c.client);
  hulyClient = clientPool[0];
  cachedToken = wsLoginInfo.token;
  
  console.log('[Huly REST] ✅ Connected to', clientPool.length, 'healthy transactor(s)');
  
  if (failedTransactors.length > 0) {
    console.log('[Huly REST] ⚠ Operating with reduced pool capacity');
    scheduleTransactorRecovery(failedTransactors, wsLoginInfo.token);
  }
}

function scheduleTransactorRecovery(failedTransactors, token) {
  const RECOVERY_INTERVAL = 60000; // Try to recover failed transactors every 60 seconds
  
  console.log(`[Huly REST] Scheduling recovery for ${failedTransactors.length} failed transactor(s)`);
  
  const recoveryInterval = setInterval(async () => {
    const stillFailed = [];
    
    for (const { url } of failedTransactors) {
      if (clientPool.some(c => c._transactorUrl === url)) {
        continue;
      }
      
      console.log(`[Huly REST] Attempting recovery for ${url}...`);
      const result = await connectToTransactor(url, token, 1);
      
      if (result) {
        result.client._transactorUrl = url;
        clientPool.push(result.client);
        console.log(`[Huly REST] ✅ Recovered ${url} - pool size now ${clientPool.length}`);
      } else {
        stillFailed.push({ url, reason: 'Recovery failed' });
      }
    }
    
    if (stillFailed.length === 0) {
      console.log('[Huly REST] ✅ All transactors recovered - stopping recovery scheduler');
      clearInterval(recoveryInterval);
    } else {
      failedTransactors.length = 0;
      failedTransactors.push(...stillFailed);
    }
  }, RECOVERY_INTERVAL);
  
  process.on('SIGTERM', () => clearInterval(recoveryInterval));
  process.on('SIGINT', () => clearInterval(recoveryInterval));
}

function isClientHealthy(client) {
  if (!client) return false;
  try {
    // SDK internals: PlatformClient.connection → Client → .getConnection() → ClientConnection.isConnected()
    // ClientConnection.isConnected() checks websocket.readyState === OPEN && helloReceived
    const conn = client.connection?.getConnection?.();
    if (conn && typeof conn.isConnected === 'function') {
      return conn.isConnected();
    }
    // Fallback: cached hierarchy check (doesn't detect dead websocket)
    const hierarchy = client.getHierarchy();
    return hierarchy !== null && hierarchy !== undefined;
  } catch {
    return false;
  }
}

function getNextClient() {
  if (clientPool.length === 0) return hulyClient;

  // Try up to poolSize clients to find a healthy one
  for (let i = 0; i < clientPool.length; i++) {
    poolIndex = (poolIndex + 1) % clientPool.length;
    if (isClientHealthy(clientPool[poolIndex])) {
      return clientPool[poolIndex];
    }
  }

  // All pool clients dead, fall back to primary
  if (isClientHealthy(hulyClient)) return hulyClient;

  console.error('[Huly REST] ❌ No healthy clients available');
  return hulyClient; // Return anyway, let caller handle the error
}

function startPoolHealthCheck() {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    const deadIndices = [];
    for (let i = 0; i < clientPool.length; i++) {
      if (!isClientHealthy(clientPool[i])) {
        deadIndices.push(i);
      }
    }

    // Also check primary client
    const primaryDead = !isClientHealthy(hulyClient);

    if (deadIndices.length === 0 && !primaryDead) return;

    const aliveCount = clientPool.length - deadIndices.length;
    console.log(
      `[Huly REST] Health check: ${deadIndices.length} dead pool client(s), ` +
      `primary ${primaryDead ? 'DEAD' : 'alive'} (${aliveCount}/${clientPool.length} pool alive)`
    );

    if (!cachedToken) {
      console.log('[Huly REST] No cached token, attempting fresh login for reconnection...');
      try {
        const accountUrl = `${config.hulyUrl}/_accounts`;
        const accountClientInstance = getAccountClient(accountUrl);
        const loginInfo = await accountClientInstance.login(config.email, config.password);
        const authenticatedClient = getAccountClient(accountUrl, loginInfo.token);
        const wsLoginInfo = await authenticatedClient.selectWorkspace(config.workspace, 'internal');
        cachedToken = wsLoginInfo.token;
      } catch (err) {
        console.error('[Huly REST] ❌ Failed to get fresh token:', err.message);
        return;
      }
    }

    // Reconnect dead pool clients
    for (const idx of deadIndices) {
      const url = config.transactorUrls[idx] || config.transactorUrl;
      if (!url) continue;

      console.log(`[Huly REST] Reconnecting pool client ${idx} (${url})...`);
      const result = await connectToTransactor(url, cachedToken, 1);
      if (result) {
        clientPool[idx] = result.client;
        console.log(`[Huly REST] ✅ Pool client ${idx} reconnected`);
      } else {
        console.error(`[Huly REST] ❌ Pool client ${idx} reconnection failed`);
      }
    }

    // Reconnect primary if dead
    if (primaryDead && clientPool.length > 0) {
      const healthyPoolClient = clientPool.find(c => isClientHealthy(c));
      if (healthyPoolClient) {
        hulyClient = healthyPoolClient;
        console.log('[Huly REST] ✅ Primary client restored from pool');
      }
    }
  }, POOL_HEALTH_CHECK_INTERVAL);

  if (healthCheckInterval.unref) healthCheckInterval.unref();
  console.log(`[Huly REST] Background health check started (every ${POOL_HEALTH_CHECK_INTERVAL / 1000}s)`);
}

/**
 * Initialize connection using standard external flow.
 * Used when HULY_TRANSACTOR_URL is not configured.
 */
async function initializeExternalConnection() {
  console.log('[Huly REST] Using external connection (no internal transactor configured)');
  
  hulyClient = await connect(config.hulyUrl, {
    email: config.email,
    password: config.password,
    workspace: config.workspace,
    socketFactory: createSocketFactory(),
  });
}

/**
 * Extract text from Huly description markup
 */
async function extractDescription(issue) {
  if (!issue.description) return '';

  // Check if description is a MarkupRef (blob reference)
  const isMarkupRef =
    typeof issue.description === 'string' &&
    (issue.description.match(/^[a-z0-9]{24}$/) ||
      issue.description.match(/^[a-z0-9]{24}-description-\d+$/));

  if (isMarkupRef && hulyClient) {
    try {
      const descriptionContent = await hulyClient.fetchMarkup(
        tracker.class.Issue,
        issue._id,
        'description',
        issue.description,
        'markdown'
      );
      return descriptionContent || '';
    } catch (error) {
      console.error(`[Huly REST] Error fetching markup for ${issue.identifier}:`, error.message);
      return '';
    }
  }

  // Fallback for plain string descriptions
  return typeof issue.description === 'string' ? issue.description : '';
}

/**
 * Batch format multiple issues with optimized queries
 * Reduces N+1 query problem by fetching all related entities in bulk
 */
async function batchFormatIssues(issues, project, options = {}) {
  if (!issues || issues.length === 0) {
    return [];
  }

  const { includeDescriptions = true, fields = null } = options;

  // 1. Collect all unique IDs from all issues
  const statusIds = [...new Set(issues.map(i => i.status).filter(Boolean))];
  const componentIds = [...new Set(issues.map(i => i.component).filter(Boolean))];
  const milestoneIds = [...new Set(issues.map(i => i.milestone).filter(Boolean))];
  const assigneeIds = [...new Set(issues.map(i => i.assignee).filter(Boolean))];
  const parentIds = [...new Set(issues
    .map(i => i.attachedTo)
    .filter(id => id && id !== 'tracker:ids:NoParent')
  )];

  // 2. Batch fetch all related entities (5 queries total instead of N*5)
  const [statuses, components, milestones, assignees, parents] = await Promise.all([
    statusIds.length > 0 
      ? getCachedStatuses(project._id).then(all => all.filter(s => statusIds.includes(s._id)))
      : [],
    componentIds.length > 0 
      ? getCachedComponents(project._id).then(all => all.filter(c => componentIds.includes(c._id)))
      : [],
    milestoneIds.length > 0 
      ? getCachedMilestones(project._id).then(all => all.filter(m => milestoneIds.includes(m._id)))
      : [],
    assigneeIds.length > 0 
      ? getCachedAccounts().then(all => all.filter(a => assigneeIds.includes(a._id)))
      : [],
    parentIds.length > 0 
      ? coalescedFindAll(getNextClient(), tracker.class.Issue, { _id: { $in: parentIds } })
      : []
  ]);

  // 3. Build lookup maps for O(1) access
  const statusMap = new Map(statuses.map(s => [s._id, s.name]));
  const componentMap = new Map(components.map(c => [c._id, c.label]));
  const milestoneMap = new Map(milestones.map(m => [m._id, m.label]));
  const assigneeMap = new Map(assignees.map(a => [a._id, a.email]));
  const parentMap = new Map(parents.map(p => [p._id, {
    identifier: p.identifier,
    title: p.title,
    _id: p._id
  }]));

  // 4. Format all issues using maps (no more database queries per issue)
  return Promise.all(issues.map(issue => 
    formatIssueFromMaps(issue, project, statusMap, componentMap, milestoneMap, assigneeMap, parentMap, includeDescriptions, fields)
  ));
}

/**
 * Format a single issue using pre-fetched lookup maps
 * Used by batchFormatIssues to avoid N+1 queries
 */
async function formatIssueFromMaps(issue, project, statusMap, componentMap, milestoneMap, assigneeMap, parentMap, includeDescriptions = true, fields = null) {
  const priorityNames = ['NoPriority', 'Urgent', 'High', 'Medium', 'Low'];
  
  const includeField = (name) => !fields || fields.includes(name);
  
  const result = {
    identifier: issue.identifier,
    title: issue.title,
  };
  
  if (includeField('description')) {
    result.description = includeDescriptions 
      ? await extractDescription(issue)
      : "";
  }
  
  if (includeField('status')) {
    result.status = statusMap.get(issue.status) || 'Unknown';
  }
  
  if (includeField('priority')) {
    result.priority = priorityNames[issue.priority] || 'NoPriority';
  }
  
  if (includeField('component')) {
    result.component = componentMap.get(issue.component) || null;
  }
  
  if (includeField('milestone')) {
    result.milestone = milestoneMap.get(issue.milestone) || null;
  }
  
  if (includeField('assignee')) {
    result.assignee = assigneeMap.get(issue.assignee) || null;
  }
  
  if (includeField('dueDate')) {
    result.dueDate = issue.dueDate ? new Date(issue.dueDate).toISOString() : null;
  }
  
  if (includeField('createdOn')) {
    result.createdOn = issue.createdOn;
  }
  
  if (includeField('modifiedOn')) {
    result.modifiedOn = issue.modifiedOn;
  }
  
  if (includeField('number')) {
    result.number = issue.number;
  }
  
  if (includeField('project')) {
    result.project = project.identifier;
  }
  
  if (includeField('parentIssue')) {
    result.parentIssue = parentMap.get(issue.attachedTo) || null;
  }
  
  if (includeField('subIssueCount')) {
    result.subIssueCount = issue.subIssues || 0;
  }
  
  return result;
}

/**
 * Format issue for REST API response
 * NOTE: For bulk operations, use batchFormatIssues() instead to avoid N+1 queries
 */
async function formatIssue(issue, project) {
  const priorityNames = ['NoPriority', 'Urgent', 'High', 'Medium', 'Low'];

  // Get status name
  let statusName = 'Unknown';
  try {
    if (issue.status) {
      const status = await hulyClient.findOne(tracker.class.IssueStatus, { _id: issue.status });
      statusName = status?.name || 'Unknown';
    }
  } catch (error) {
    console.error(`[Huly REST] Error fetching status for ${issue.identifier}:`, error.message);
  }

  // Get component label
  let componentLabel = null;
  if (issue.component) {
    try {
      const component = await hulyClient.findOne(tracker.class.Component, { _id: issue.component });
      componentLabel = component?.label || null;
    } catch (error) {
      console.error(`[Huly REST] Error fetching component for ${issue.identifier}:`, error.message);
    }
  }

  // Get milestone label
  let milestoneLabel = null;
  if (issue.milestone) {
    try {
      const milestone = await hulyClient.findOne(tracker.class.Milestone, { _id: issue.milestone });
      milestoneLabel = milestone?.label || null;
    } catch (error) {
      console.error(`[Huly REST] Error fetching milestone for ${issue.identifier}:`, error.message);
    }
  }

  // Get assignee email
  let assigneeEmail = null;
  if (issue.assignee) {
    try {
      const assignee = await hulyClient.findOne(core.class.Account, { _id: issue.assignee });
      assigneeEmail = assignee?.email || null;
    } catch (error) {
      console.error(`[Huly REST] Error fetching assignee for ${issue.identifier}:`, error.message);
    }
  }

  // Extract description
  const description = await extractDescription(issue);

  // Get parent issue info if this is a sub-issue
  let parentIssue = null;
  const isSubIssue = issue.attachedTo && issue.attachedTo !== 'tracker:ids:NoParent';
  if (isSubIssue) {
    try {
      const parent = await hulyClient.findOne(tracker.class.Issue, { _id: issue.attachedTo });
      if (parent) {
        parentIssue = {
          identifier: parent.identifier,
          title: parent.title,
          _id: parent._id,
        };
      }
    } catch (error) {
      console.error(`[Huly REST] Error fetching parent for ${issue.identifier}:`, error.message);
    }
  }

  return {
    identifier: issue.identifier,
    title: issue.title,
    description,
    status: statusName,
    priority: priorityNames[issue.priority] || 'NoPriority',
    component: componentLabel,
    milestone: milestoneLabel,
    assignee: assigneeEmail,
    dueDate: issue.dueDate ? new Date(issue.dueDate).toISOString() : null,
    createdOn: issue.createdOn,
    modifiedOn: issue.modifiedOn,
    number: issue.number,
    project: project.identifier,
    // Parent/child relationship fields
    parentIssue,
    subIssueCount: issue.subIssues || 0,
  };
}

// ============================================================================
// REST API Endpoints
// ============================================================================

app.get('/health', (req, res) => {
  const poolSize = clientPool.length;
  const expectedSize = config.transactorUrls.length || 1;
  const isHealthy = hulyClient !== null && poolSize >= CONNECTION_CONFIG.minHealthyTransactors;
  
  res.json({
    status: isHealthy ? 'ok' : 'degraded',
    connected: hulyClient !== null,
    transactorPool: {
      active: poolSize,
      expected: expectedSize,
      healthy: poolSize >= expectedSize,
      minRequired: CONNECTION_CONFIG.minHealthyTransactors,
    },
    cache: metadataCache.stats,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/detailed', async (req, res) => {
  const poolSize = clientPool.length;
  const expectedSize = config.transactorUrls.length || 1;
  
  let dbCheck = { status: 'unknown', latencyMs: null };
  if (hulyClient) {
    const start = Date.now();
    try {
      await hulyClient.findAll(tracker.class.Project, {}, { limit: 1 });
      dbCheck = { status: 'ok', latencyMs: Date.now() - start };
    } catch (e) {
      dbCheck = { status: 'error', error: e.message, latencyMs: Date.now() - start };
    }
  }
  
  res.json({
    status: hulyClient !== null ? 'ok' : 'error',
    connected: hulyClient !== null,
    transactorPool: {
      active: poolSize,
      expected: expectedSize,
      urls: config.transactorUrls,
    },
    database: dbCheck,
    config: {
      connectionTimeout: CONNECTION_CONFIG.connectionTimeout,
      minHealthyTransactors: CONNECTION_CONFIG.minHealthyTransactors,
    },
    cacheStats: metadataCache.stats,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/projects - List all projects
 */
app.get('/api/projects', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const projects = (await getCachedProjects())
      .slice()
      .sort((a, b) => (b.modifiedOn || 0) - (a.modifiedOn || 0));

    const issueCountMap = await getWithSWR('issueCount:all', async () => {
      const allIssues = await findAllWithTimeout(getNextClient(), tracker.class.Issue, {}, { projection: { space: 1 } });
      const counts = new Map();
      for (const issue of allIssues) {
        counts.set(issue.space, (counts.get(issue.space) || 0) + 1);
      }
      return counts;
    }, { ttl: CACHE_TTL.issueCount });

    const projectList = projects.map((project) => ({
      identifier: project.identifier,
      name: project.name,
      description: project.description || '',
      issueCount: issueCountMap.get(project._id) || 0,
      private: project.private || false,
      archived: project.archived || false,
    }));

    res.json({
      projects: projectList,
      count: projectList.length,
    });
  } catch (error) {
    console.error('[Huly REST] Error listing projects:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/projects/:identifier/issues - List issues in a project with optional timestamp filter
 * Query params:
 *   - modifiedSince: ISO timestamp to fetch only issues modified after this time (alias: modifiedAfter)
 *   - createdSince: ISO timestamp to fetch only issues created after this time
 *   - limit: Maximum number of issues to return (default 1000)
 */
app.get('/api/projects/:identifier/issues', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { modifiedSince, modifiedAfter, createdSince, limit = 1000, includeDescriptions = 'true', fields: fieldsParam } = req.query;
    
    // Support both modifiedSince and modifiedAfter (alias)
    const modifiedFilter = modifiedSince || modifiedAfter;
    const includeDescriptionsFlag = includeDescriptions === 'true' || includeDescriptions === true;
    const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : null;

    // Find project
    const project = await hulyClient.findOne(tracker.class.Project, { identifier });
    if (!project) {
      return res.status(404).json({ error: `Project ${identifier} not found` });
    }

    // Build query
    const query = { space: project._id };

    // Add modified timestamp filter if provided
    if (modifiedFilter) {
      const timestamp = new Date(modifiedFilter).getTime();
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid modifiedSince timestamp' });
      }
      query.modifiedOn = { $gte: timestamp };
    }

    // Add created timestamp filter if provided
    if (createdSince) {
      const timestamp = new Date(createdSince).getTime();
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid createdSince timestamp' });
      }
      query.createdOn = { $gte: timestamp };
    }

    // Fetch issues
    console.log(`[Huly REST] Fetching issues for project ${identifier}`);
    if (modifiedFilter) {
      console.log(`[Huly REST]   Modified since: ${modifiedFilter}`);
    }
    if (createdSince) {
      console.log(`[Huly REST]   Created since: ${createdSince}`);
    }

    const issues = await hulyClient.findAll(
      tracker.class.Issue,
      query,
      {
        sort: { modifiedOn: -1 },
        limit: parseInt(limit),
      }
    );

    console.log(`[Huly REST] Found ${issues.length} issues in ${identifier}`);

    const formattedIssues = await batchFormatIssues(issues, project, { includeDescriptions: includeDescriptionsFlag, fields });

    // Calculate sync metadata
    const latestModified = issues.length > 0 
      ? new Date(Math.max(...issues.map(i => i.modifiedOn))).toISOString()
      : null;

    // Build response with syncMeta always included for incremental sync support
    const response = {
      project: identifier,
      issues: formattedIssues,
      count: formattedIssues.length,
      syncMeta: {
        modifiedSince: modifiedFilter || null,
        createdSince: createdSince || null,
        latestModified,
        serverTime: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    console.error('[Huly REST] Error fetching issues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/projects/:identifier/tree - Get issue hierarchy as nested tree
 */
app.get('/api/projects/:identifier/tree', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    console.log(`[Huly REST] Building issue tree for project ${identifier}`);

    // Find project
    const project = await hulyClient.findOne(tracker.class.Project, { identifier });
    if (!project) {
      return res.status(404).json({ error: `Project ${identifier} not found` });
    }

    // Fetch all issues in project
    const issues = await hulyClient.findAll(
      tracker.class.Issue,
      { space: project._id },
      { sort: { number: 1 } }
    );

    console.log(`[Huly REST] Found ${issues.length} issues to build tree`);

    // Get all statuses for name lookup
    const statuses = await getCachedStatuses(project._id);
    const statusMap = new Map(statuses.map(s => [s._id, s.name]));

    const priorityNames = ['NoPriority', 'Urgent', 'High', 'Medium', 'Low'];

    // Build a map of issue ID to issue data
    const issueMap = new Map();
    for (const issue of issues) {
      issueMap.set(issue._id, {
        identifier: issue.identifier,
        title: issue.title,
        status: statusMap.get(issue.status) || 'Unknown',
        priority: priorityNames[issue.priority] || 'NoPriority',
        _id: issue._id,
        attachedTo: issue.attachedTo,
        children: [],
      });
    }

    // Build tree structure
    const rootNodes = [];
    for (const [id, node] of issueMap) {
      if (node.attachedTo && node.attachedTo !== 'tracker:ids:NoParent' && issueMap.has(node.attachedTo)) {
        // This is a child - add to parent's children
        const parent = issueMap.get(node.attachedTo);
        parent.children.push(node);
      } else {
        // This is a root node
        rootNodes.push(node);
      }
    }

    // Clean up internal fields from output
    const cleanNode = (node) => {
      const { _id, attachedTo, ...clean } = node;
      clean.children = node.children.map(cleanNode);
      return clean;
    };

    const tree = rootNodes.map(cleanNode);

    res.json({
      project: identifier,
      tree,
      totalCount: issues.length,
      rootCount: rootNodes.length,
    });
  } catch (error) {
    console.error('[Huly REST] Error building issue tree:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/projects/:identifier/activity - Get recent activity/changes for a project
 * Query params:
 *   - since: ISO timestamp to get activity after this time (default: 24 hours ago)
 *   - limit: Max activities to return (default 100, max 500)
 */
app.get('/api/projects/:identifier/activity', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { since, limit = 100 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 100, 500);

    // Default to 24 hours ago
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({ error: 'Invalid since timestamp' });
    }
    const sinceTimestamp = sinceDate.getTime();

    console.log(`[Huly REST] Fetching activity for project ${identifier} since ${sinceDate.toISOString()}`);

    // Find project
    const project = await hulyClient.findOne(tracker.class.Project, { identifier });
    if (!project) {
      return res.status(404).json({ error: `Project ${identifier} not found` });
    }

    // Get all statuses for name lookup
    const statuses = await getCachedStatuses(project._id);
    const statusMap = new Map(statuses.map(s => [s._id, s.name]));

    const priorityNames = ['NoPriority', 'Urgent', 'High', 'Medium', 'Low'];

    // Fetch recently modified issues
    const modifiedIssues = await hulyClient.findAll(
      tracker.class.Issue,
      { 
        space: project._id,
        modifiedOn: { $gte: sinceTimestamp }
      },
      { sort: { modifiedOn: -1 }, limit: limitNum }
    );

    // Fetch recently created issues
    const createdIssues = await hulyClient.findAll(
      tracker.class.Issue,
      {
        space: project._id,
        createdOn: { $gte: sinceTimestamp }
      },
      { sort: { createdOn: -1 } }
    );
    const createdIds = new Set(createdIssues.map(i => i._id));

    // Build activity list
    const activities = [];

    // Add created events
    for (const issue of createdIssues) {
      activities.push({
        type: 'issue.created',
        issue: issue.identifier,
        title: issue.title,
        timestamp: new Date(issue.createdOn).toISOString(),
        priority: priorityNames[issue.priority] || 'NoPriority',
        status: statusMap.get(issue.status) || 'Unknown',
      });
    }

    // Add modified events (excluding ones that were just created)
    for (const issue of modifiedIssues) {
      if (!createdIds.has(issue._id)) {
        // This is an update, not a create
        activities.push({
          type: 'issue.updated',
          issue: issue.identifier,
          title: issue.title,
          timestamp: new Date(issue.modifiedOn).toISOString(),
          priority: priorityNames[issue.priority] || 'NoPriority',
          status: statusMap.get(issue.status) || 'Unknown',
        });
      }
    }

    // Sort by timestamp descending
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Limit results
    const limitedActivities = activities.slice(0, limitNum);

    // Generate summary stats
    const summary = {
      created: activities.filter(a => a.type === 'issue.created').length,
      updated: activities.filter(a => a.type === 'issue.updated').length,
      total: activities.length,
    };

    // Count by status
    const byStatus = {};
    for (const activity of activities) {
      byStatus[activity.status] = (byStatus[activity.status] || 0) + 1;
    }

    console.log(`[Huly REST] Found ${activities.length} activities for ${identifier}`);

    res.json({
      project: identifier,
      since: sinceDate.toISOString(),
      activities: limitedActivities,
      count: limitedActivities.length,
      summary,
      byStatus,
    });
  } catch (error) {
    console.error('[Huly REST] Error fetching activity:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/projects/:identifier/components - List all components in a project
 */
app.get('/api/projects/:identifier/components', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;

    const project = await hulyClient.findOne(tracker.class.Project, { identifier });
    if (!project) {
      return res.status(404).json({ error: `Project ${identifier} not found` });
    }

    const components = await hulyClient.findAll(tracker.class.Component, { space: project._id });

    const formattedComponents = components.map(c => ({
      _id: c._id,
      label: c.label,
      description: c.description || null,
    }));

    res.json({
      project: identifier,
      components: formattedComponents,
      count: formattedComponents.length,
    });
  } catch (error) {
    console.error('[Huly REST] Error fetching components:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/issues - Global search across all projects
 * Query params:
 *   - query: Text search in title/description
 *   - status: Filter by status name
 *   - priority: Filter by priority (Urgent, High, Medium, Low)
 *   - assignee: Filter by assignee email
 *   - limit: Max results (default 50)
 */
app.get('/api/issues', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { query, status, priority, assignee, limit = 50, includeDescriptions = 'true', fields: fieldsParam } = req.query;

    console.log(`[Huly REST] Global issue search - query: "${query || ''}", status: ${status || 'any'}, priority: ${priority || 'any'}`);

    const includeDescriptionsFlag = includeDescriptions === 'true' || includeDescriptions === true;
    const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : null;

    // Build base query
    const issueQuery = {};

    // Priority filter
    if (priority) {
      const PRIORITY_MAP = { NoPriority: 0, Urgent: 1, High: 2, Medium: 3, Low: 4 };
      const priorityValue = PRIORITY_MAP[priority];
      if (priorityValue !== undefined) {
        issueQuery.priority = priorityValue;
      }
    }

    // Fetch all issues matching criteria
    let issues = await hulyClient.findAll(
      tracker.class.Issue,
      issueQuery,
      { sort: { modifiedOn: -1 }, limit: parseInt(limit) * 3 } // Fetch extra for filtering
    );

    // Get all projects for formatting
    const projects = await getCachedProjects();
    const projectMap = new Map(projects.map(p => [p._id, p]));

    // Filter by status if provided (need to resolve status names)
    if (status) {
      const projectStatuses = await Promise.all(projects.map(p => getCachedStatuses(p._id)));
      const coreStatuses = await getCachedStatuses('core:space:Model');
      const uniqueStatuses = new Map();
      for (const s of coreStatuses) uniqueStatuses.set(s._id, s);
      for (const list of projectStatuses) {
        for (const s of list) uniqueStatuses.set(s._id, s);
      }
      const allStatuses = Array.from(uniqueStatuses.values());
      const matchingStatusIds = allStatuses
        .filter(s => s.name.toLowerCase() === status.toLowerCase())
        .map(s => s._id);
      issues = issues.filter(i => matchingStatusIds.includes(i.status));
    }

    // Filter by assignee if provided
    if (assignee) {
      const account = await hulyClient.findOne(core.class.Account, { email: assignee });
      if (account) {
        issues = issues.filter(i => i.assignee === account._id);
      } else {
        issues = []; // No matching assignee
      }
    }

    // Filter by text query if provided
    if (query) {
      const lowerQuery = query.toLowerCase();
      issues = issues.filter(i => 
        i.title?.toLowerCase().includes(lowerQuery) ||
        i.identifier?.toLowerCase().includes(lowerQuery)
      );
    }

    // Limit results
    issues = issues.slice(0, parseInt(limit));

    console.log(`[Huly REST] Found ${issues.length} issues matching criteria`);

    const issuesByProject = new Map();
    for (const issue of issues) {
      const project = projectMap.get(issue.space);
      if (!project) continue;
      
      if (!issuesByProject.has(project._id)) {
        issuesByProject.set(project._id, { project, issues: [] });
      }
      issuesByProject.get(project._id).issues.push(issue);
    }

    const formattedIssues = [];
    for (const { project, issues: projectIssues } of issuesByProject.values()) {
      const formatted = await batchFormatIssues(projectIssues, project, { includeDescriptions: includeDescriptionsFlag, fields });
      formattedIssues.push(...formatted);
    }

    res.json({
      issues: formattedIssues,
      count: formattedIssues.length,
      query: query || null,
      filters: {
        status: status || null,
        priority: priority || null,
        assignee: assignee || null,
      },
    });
  } catch (error) {
    console.error('[Huly REST] Error in global search:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/issues/all - Paginated fetch of ALL issues across all projects
 * Query params:
 *   - limit: Max results per page (default 100, max 500)
 *   - offset: Number of issues to skip (default 0)
 *   - modifiedSince: ISO timestamp for incremental sync
 *   - createdSince: ISO timestamp for new issues only
 */
app.get('/api/issues/all', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { limit = 100, offset = 0, modifiedSince, createdSince, includeDescriptions = 'true', fields: fieldsParam } = req.query;
    const limitNum = Math.min(parseInt(limit) || 100, 500);
    const offsetNum = parseInt(offset) || 0;
    const includeDescriptionsFlag = includeDescriptions === 'true' || includeDescriptions === true;
    const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : null;

    console.log(`[Huly REST] Fetching all issues - limit: ${limitNum}, offset: ${offsetNum}`);
    if (modifiedSince) console.log(`[Huly REST]   Modified since: ${modifiedSince}`);
    if (createdSince) console.log(`[Huly REST]   Created since: ${createdSince}`);

    // Build query
    const query = {};

    if (modifiedSince) {
      const timestamp = new Date(modifiedSince).getTime();
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid modifiedSince timestamp' });
      }
      query.modifiedOn = { $gte: timestamp };
    }

    if (createdSince) {
      const timestamp = new Date(createdSince).getTime();
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid createdSince timestamp' });
      }
      query.createdOn = { $gte: timestamp };
    }

    // Get total count for pagination info
    const allMatchingIssues = await findAllWithTimeout(getNextClient(), tracker.class.Issue, query, {});
    const totalCount = allMatchingIssues.length;

    const paginatedIssues = allMatchingIssues
      .sort((a, b) => b.modifiedOn - a.modifiedOn)
      .slice(offsetNum, offsetNum + limitNum);

    // Get all projects for formatting
    const projects = await hulyClient.findAll(tracker.class.Project, {});
    const projectMap = new Map(projects.map(p => [p._id, p]));

    console.log(`[Huly REST] Found ${totalCount} total, returning ${paginatedIssues.length} (offset: ${offsetNum})`);

    const issuesByProject = new Map();
    for (const issue of paginatedIssues) {
      const project = projectMap.get(issue.space);
      if (!project) continue;
      
      if (!issuesByProject.has(project._id)) {
        issuesByProject.set(project._id, { project, issues: [] });
      }
      issuesByProject.get(project._id).issues.push(issue);
    }

    const formattedIssues = [];
    for (const { project, issues } of issuesByProject.values()) {
      const formatted = await batchFormatIssues(issues, project, { includeDescriptions: includeDescriptionsFlag, fields });
      formattedIssues.push(...formatted);
    }

    // Calculate sync metadata
    const latestModified = paginatedIssues.length > 0
      ? new Date(Math.max(...paginatedIssues.map(i => i.modifiedOn))).toISOString()
      : null;

    res.json({
      issues: formattedIssues,
      count: formattedIssues.length,
      pagination: {
        total: totalCount,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < totalCount,
        nextOffset: offsetNum + limitNum < totalCount ? offsetNum + limitNum : null,
      },
      syncMeta: {
        modifiedSince: modifiedSince || null,
        createdSince: createdSince || null,
        latestModified,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Huly REST] Error fetching all issues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/issues/bulk - Batch update multiple issues
 * Body: { updates: [ { identifier: "PROJ-1", changes: { status: "Done", priority: "High" } }, ... ] }
 */
app.patch('/api/issues/bulk', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { updates } = req.body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates array is required' });
    }

    if (updates.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 updates per request' });
    }

    console.log(`[Huly REST] Bulk updating ${updates.length} issues`);

    // Preload lookups for efficiency
    const projects = await getCachedProjects();
    const projectStatuses = await Promise.all(projects.map(p => getCachedStatuses(p._id)));
    const coreStatuses = await getCachedStatuses('core:space:Model');
    const uniqueStatuses = new Map();
    for (const s of coreStatuses) uniqueStatuses.set(s._id, s);
    for (const list of projectStatuses) {
      for (const s of list) uniqueStatuses.set(s._id, s);
    }
    const allStatuses = Array.from(uniqueStatuses.values());
    const projectMap = new Map(projects.map(p => [p._id, p]));

    const results = [];
    const errors = [];

    for (const update of updates) {
      const { identifier, changes } = update;

      if (!identifier || !changes || Object.keys(changes).length === 0) {
        errors.push({ identifier: identifier || 'unknown', error: 'identifier and changes are required' });
        continue;
      }

      try {
        // Find issue
        const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
        if (!issue) {
          errors.push({ identifier, error: 'Issue not found' });
          continue;
        }

        const project = projectMap.get(issue.space);
        const updateData = {};
        const appliedChanges = {};

        // Process each field
        for (const [field, value] of Object.entries(changes)) {
          switch (field) {
            case 'title':
              updateData.title = value;
              appliedChanges.title = value;
              break;

            case 'status':
              const targetStatus = allStatuses.find(s => s.name.toLowerCase() === value.toLowerCase());
              if (targetStatus) {
                updateData.status = targetStatus._id;
                appliedChanges.status = targetStatus.name;
              }
              break;

            case 'priority':
              const PRIORITY_MAP = { NoPriority: 0, Urgent: 1, High: 2, Medium: 3, Low: 4 };
              const priorityValue = PRIORITY_MAP[value];
              if (priorityValue !== undefined) {
                updateData.priority = priorityValue;
                appliedChanges.priority = value;
              }
              break;

            case 'dueDate':
              if (value === null || value === '') {
                updateData.dueDate = null;
                appliedChanges.dueDate = null;
              } else {
                const timestamp = new Date(value).getTime();
                if (!isNaN(timestamp)) {
                  updateData.dueDate = timestamp;
                  appliedChanges.dueDate = new Date(timestamp).toISOString();
                }
              }
              break;

            case 'assignee':
              if (value === null || value === '') {
                updateData.assignee = null;
                appliedChanges.assignee = null;
              } else {
                const account = await hulyClient.findOne(core.class.Account, { email: value });
                if (account) {
                  updateData.assignee = account._id;
                  appliedChanges.assignee = value;
                }
              }
              break;

            case 'description':
              if (value && value.trim()) {
                const descriptionRef = await hulyClient.uploadMarkup(
                  tracker.class.Issue,
                  issue._id,
                  'description',
                  value.trim(),
                  'markdown'
                );
                updateData.description = descriptionRef;
                appliedChanges.description = '(updated)';
              } else {
                updateData.description = '';
                appliedChanges.description = '';
              }
              break;
          }
        }

        // Apply updates
        if (Object.keys(updateData).length > 0) {
          await hulyClient.updateDoc(tracker.class.Issue, issue.space, issue._id, updateData);
          results.push({ identifier, updated: true, changes: appliedChanges });
        } else {
          results.push({ identifier, updated: false, changes: {} });
        }
      } catch (updateError) {
        errors.push({ identifier, error: updateError.message });
      }
    }

    console.log(`[Huly REST] Bulk update complete: ${results.length} succeeded, ${errors.length} failed`);
    metadataCache.invalidate('issueCount:');

    res.json({
      results,
      succeeded: results.filter(r => r.updated).length,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[Huly REST] Error in bulk update:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper: Run async functions with controlled concurrency
 */
async function parallelLimit(items, limit, fn) {
  const results = [];
  const executing = [];

  for (const [index, item] of items.entries()) {
    const promise = Promise.resolve().then(() => fn(item, index));
    results.push(promise);

    if (items.length >= limit) {
      const e = promise.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.allSettled(results);
}

function chunkArray(items, chunkSize) {
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  const chunks = [];
  for (let i = 0; i < items.length; i += safeChunkSize) {
    chunks.push(items.slice(i, i + safeChunkSize));
  }
  return chunks;
}

function getIssueCollectionMeta(issue) {
  const { attachedTo, attachedToClass, collection } = issue;
  if (!attachedTo || !attachedToClass || !collection) {
    return null;
  }
  return { attachedTo, attachedToClass, collection };
}

async function deleteIssuesInBatches(issues, { batchSize = 200, logPrefix = '[Huly REST]' } = {}) {
  if (!hulyClient) {
    throw new Error('Huly client not initialized');
  }

  const startedAt = Date.now();
  const missingMeta = [];
  
  const validIssues = issues.filter(issue => {
    const meta = getIssueCollectionMeta(issue);
    if (!meta) {
      missingMeta.push(issue.identifier ?? issue._id);
      return false;
    }
    return true;
  });

  if (missingMeta.length > 0) {
    console.log(`${logPrefix} Skipping ${missingMeta.length} issues (missing metadata)`);
  }

  if (validIssues.length === 0) {
    return { deleted: 0, failed: missingMeta.length, elapsedMs: Date.now() - startedAt };
  }

  let succeeded = 0;
  let opsFailed = 0;

  const numClients = clientPool.length || 1;
  const issuesPerClient = Math.ceil(validIssues.length / numClients);
  const clientChunks = chunkArray(validIssues, issuesPerClient);
  
  console.log(`${logPrefix} Distributing ${validIssues.length} issues across ${clientChunks.length} transactor(s)`);

  const deletePromises = clientChunks.map(async (clientIssues, clientIdx) => {
    const client = clientPool[clientIdx] || hulyClient;
    const clientTxOps = client.client;
    let clientSucceeded = 0;
    let clientFailed = 0;
    
    if (clientTxOps && typeof clientTxOps.apply === 'function') {
      const batches = chunkArray(clientIssues, batchSize);
      for (const [batchIdx, batch] of batches.entries()) {
        try {
          const ops = clientTxOps.apply(`bulk-delete-t${clientIdx}-b${batchIdx}`);
          for (const issue of batch) {
            const meta = getIssueCollectionMeta(issue);
            ops.removeCollection(
              tracker.class.Issue,
              issue.space,
              issue._id,
              meta.attachedTo,
              meta.attachedToClass,
              meta.collection
            );
          }
          const result = await ops.commit(false);
          if (result.result) {
            clientSucceeded += batch.length;
          } else {
            clientFailed += batch.length;
          }
        } catch (err) {
          console.log(`${logPrefix} T${clientIdx} batch ${batchIdx + 1} failed: ${err.message}`);
          clientFailed += batch.length;
        }
      }
    } else {
      for (const issue of clientIssues) {
        try {
          const meta = getIssueCollectionMeta(issue);
          await client.removeCollection(
            tracker.class.Issue,
            issue.space,
            issue._id,
            meta.attachedTo,
            meta.attachedToClass,
            meta.collection
          );
          clientSucceeded++;
        } catch (err) {
          clientFailed++;
        }
      }
    }
    
    return { succeeded: clientSucceeded, failed: clientFailed };
  });

  const results = await Promise.all(deletePromises);
  for (const r of results) {
    succeeded += r.succeeded;
    opsFailed += r.failed;
  }

  const totalFailed = opsFailed + missingMeta.length;
  console.log(`${logPrefix} Deleted ${succeeded}/${issues.length} issues (${totalFailed} failed) in ${Date.now() - startedAt}ms`);

  return { deleted: succeeded, failed: totalFailed, elapsedMs: Date.now() - startedAt };
}

/**
 * DELETE /api/issues/bulk - Batch delete multiple issues (OPTIMIZED - batched tx)
 * Body: {
 *   identifiers: ["PROJ-1", "PROJ-2", ...],
 *   cascade: true/false,
 *   batchSize: 50,
 *   fast: false  // Skip sub-issue handling for maximum speed
 * }
 */
app.delete('/api/issues/bulk', async (req, res) => {
  const startTime = Date.now();
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifiers, cascade = false, batchSize = 50, fast = false } = req.body;

    if (!identifiers || !Array.isArray(identifiers) || identifiers.length === 0) {
      return res.status(400).json({ error: 'identifiers array is required' });
    }

    if (identifiers.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 deletions per request' });
    }

    const safeBatchSize = Math.min(Math.max(batchSize, 1), 100);
    console.log(`[Huly REST] Bulk deleting ${identifiers.length} issues (cascade: ${cascade}, batchSize: ${safeBatchSize}, fast: ${fast})`);

    const allIssues = await hulyClient.findAll(tracker.class.Issue, {
      identifier: { $in: identifiers }
    });

    const issueMap = new Map();
    for (const issue of allIssues) {
      issueMap.set(issue.identifier, issue);
    }

    console.log(`[Huly REST] Found ${issueMap.size}/${identifiers.length} issues in ${Date.now() - startTime}ms`);

    const notFound = identifiers.filter(id => !issueMap.has(id));
    const issuesToDelete = Array.from(issueMap.values());
    let subIssuesHandled = 0;

    if (!fast && issuesToDelete.length > 0) {
      const issueIds = issuesToDelete.map(i => i._id);
      const subIssues = await hulyClient.findAll(tracker.class.Issue, {
        attachedTo: { $in: issueIds }
      });

      if (subIssues.length > 0) {
        if (cascade) {
          await deleteIssuesInBatches(subIssues, { batchSize: 50, logPrefix: '[Huly REST] SubIssue' });
          subIssuesHandled = subIssues.length;
        } else {
          await parallelLimit(
            subIssues,
            10,
            async (subIssue) => {
              const parentIssue = issueMap.get(subIssue.attachedTo) || issuesToDelete.find(i => i._id === subIssue.attachedTo);
              const newParent = parentIssue?.attachedTo && parentIssue.attachedTo !== 'tracker:ids:NoParent'
                ? parentIssue.attachedTo
                : tracker.ids.NoParent;
              const newParents = parentIssue?.parents && Array.isArray(parentIssue.parents)
                ? parentIssue.parents.slice(0, -1)
                : [];
              await hulyClient.updateDoc(tracker.class.Issue, subIssue.space, subIssue._id, {
                attachedTo: newParent,
                parents: newParents,
              });
            }
          );
          subIssuesHandled = subIssues.length;
        }
      }
    }

    metadataCache.invalidate('issueCount:');

    const deleteResult = await deleteIssuesInBatches(issuesToDelete, { batchSize: 50, logPrefix: '[Huly REST]' });
    metadataCache.invalidate('issueCount:');

    const elapsed = Date.now() - startTime;
    console.log(`[Huly REST] Bulk deleted ${deleteResult.deleted} issues in ${elapsed}ms`);

    res.json({
      deleted: issuesToDelete.slice(0, deleteResult.deleted).map(i => ({ identifier: i.identifier })),
      succeeded: deleteResult.deleted,
      failed: notFound.length + deleteResult.failed,
      subIssuesHandled,
      cascaded: cascade,
      errors: notFound.length > 0 ? notFound.map(id => ({ identifier: id, error: 'Issue not found' })) : undefined,
      elapsed_ms: elapsed,
    });
  } catch (error) {
    console.error('[Huly REST] Error in bulk delete:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/issues/bulk - Fetch multiple issues by identifiers
 * Query params:
 *   - ids: Comma-separated list of issue identifiers (e.g., "PROJ-1,PROJ-2,OTHER-5")
 */
app.get('/api/issues/bulk', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { ids, includeDescriptions = 'true', fields: fieldsParam } = req.query;

    if (!ids) {
      return res.status(400).json({ error: 'ids parameter is required (comma-separated identifiers)' });
    }

    const identifiers = ids.split(',').map(id => id.trim()).filter(id => id);
    const includeDescriptionsFlag = includeDescriptions === 'true' || includeDescriptions === true;
    const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : null;
    console.log(`[Huly REST] Bulk fetch for ${identifiers.length} issues: ${identifiers.join(', ')}`);

    if (identifiers.length === 0) {
      return res.status(400).json({ error: 'No valid identifiers provided' });
    }

    if (identifiers.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 issues per request' });
    }

    const projects = await hulyClient.findAll(tracker.class.Project, {});
    const projectMap = new Map(projects.map(p => [p._id, p]));

    const issues = await hulyClient.findAll(tracker.class.Issue, { 
      identifier: { $in: identifiers } 
    });
    
    const foundIdentifiers = new Set(issues.map(i => i.identifier));
    const notFound = identifiers.filter(id => !foundIdentifiers.has(id));

    const issuesByProject = new Map();
    for (const issue of issues) {
      const project = projectMap.get(issue.space);
      if (!project) {
        notFound.push(issue.identifier);
        continue;
      }
      
      if (!issuesByProject.has(project._id)) {
        issuesByProject.set(project._id, { project, issues: [] });
      }
      issuesByProject.get(project._id).issues.push(issue);
    }

    const results = [];
    for (const { project, issues: projectIssues } of issuesByProject.values()) {
      const formatted = await batchFormatIssues(projectIssues, project, { includeDescriptions: includeDescriptionsFlag, fields });
      results.push(...formatted);
    }

    console.log(`[Huly REST] Bulk fetch: found ${results.length}, not found ${notFound.length}`);

    res.json({
      issues: results,
      count: results.length,
      notFound: notFound.length > 0 ? notFound : undefined,
    });
  } catch (error) {
    console.error('[Huly REST] Error in bulk fetch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/issues/bulk-by-projects - Fetch issues from multiple projects in a single call
 * Body:
 *   - projects: Array of project identifiers (required)
 *   - modifiedSince: ISO timestamp to fetch only issues modified after this time (optional)
 *   - createdSince: ISO timestamp to fetch only issues created after this time (optional)
 *   - limit: Max issues per project (default: 1000)
 * 
 * Example:
 * {
 *   "projects": ["PROJ1", "PROJ2", "PROJ3"],
 *   "modifiedSince": "2026-01-01T00:00:00Z",
 *   "limit": 500
 * }
 */
app.post('/api/issues/bulk-by-projects', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { projects, modifiedSince, createdSince, limit = 1000, includeDescriptions = true, fields } = req.body;

    if (!projects || !Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({ error: 'projects array is required and must not be empty' });
    }

    if (projects.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 projects per request' });
    }

    console.log(`[Huly REST] Bulk fetch for ${projects.length} projects: ${projects.join(', ')}`);
    if (modifiedSince) {
      console.log(`[Huly REST]   Modified since: ${modifiedSince}`);
    }

    const limitNum = parseInt(limit);
    const modifiedTimestamp = modifiedSince ? new Date(modifiedSince).getTime() : null;
    const createdTimestamp = createdSince ? new Date(createdSince).getTime() : null;

    if (modifiedSince && isNaN(modifiedTimestamp)) {
      return res.status(400).json({ error: 'Invalid modifiedSince timestamp' });
    }
    if (createdSince && isNaN(createdTimestamp)) {
      return res.status(400).json({ error: 'Invalid createdSince timestamp' });
    }

    const allProjects = await hulyClient.findAll(tracker.class.Project, {});
    const projectMap = new Map(allProjects.map(p => [p.identifier, p]));

    const projectResults = {};
    let totalIssues = 0;
    let overallLatestModified = null;
    const notFound = [];

    // Parallelize project processing for better performance
    const projectPromises = projects.map(async (projectIdentifier) => {
      const project = projectMap.get(projectIdentifier);
      
      if (!project) {
        return { 
          projectIdentifier, 
          notFound: true 
        };
      }

      const query = { space: project._id };

      if (modifiedTimestamp) {
        query.modifiedOn = { $gte: modifiedTimestamp };
      }
      if (createdTimestamp) {
        query.createdOn = { $gte: createdTimestamp };
      }

      const issues = await hulyClient.findAll(
        tracker.class.Issue,
        query,
        {
          sort: { modifiedOn: -1 },
          limit: limitNum,
        }
      );

      const formattedIssues = await batchFormatIssues(issues, project, { includeDescriptions, fields });

      const latestModified = issues.length > 0 
        ? new Date(Math.max(...issues.map(i => i.modifiedOn))).toISOString()
        : null;

      return {
        projectIdentifier,
        project,
        issues: formattedIssues,
        latestModified,
        count: formattedIssues.length
      };
    });

    const results = await Promise.all(projectPromises);

    // Process results and build response
    for (const result of results) {
      if (result.notFound) {
        notFound.push(result.projectIdentifier);
        projectResults[result.projectIdentifier] = {
          issues: [],
          count: 0,
          error: 'Project not found'
        };
      } else {
        if (result.latestModified) {
          if (!overallLatestModified || result.latestModified > overallLatestModified) {
            overallLatestModified = result.latestModified;
          }
        }

        projectResults[result.projectIdentifier] = {
          issues: result.issues,
          count: result.count,
          syncMeta: {
            latestModified: result.latestModified,
            fetchedAt: new Date().toISOString()
          }
        };

        totalIssues += result.count;
      }
    }

    console.log(`[Huly REST] Bulk fetch complete: ${totalIssues} total issues from ${projects.length} projects`);

    res.json({
      projects: projectResults,
      totalIssues,
      projectCount: projects.length,
      syncMeta: {
        modifiedSince: modifiedSince || null,
        createdSince: createdSince || null,
        latestModified: overallLatestModified,
        serverTime: new Date().toISOString(),
      },
      notFound: notFound.length > 0 ? notFound : undefined,
    });
  } catch (error) {
    console.error('[Huly REST] Error in bulk-by-projects:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/issues/:identifier - Get single issue details
 */
app.get('/api/issues/:identifier', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;

    // Find issue
    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    // Get project
    const project = await hulyClient.findOne(tracker.class.Project, { _id: issue.space });
    if (!project) {
      return res.status(404).json({ error: 'Project not found for issue' });
    }

    // Format issue with full details
    const formattedIssue = await formatIssue(issue, project);

    res.json(formattedIssue);
  } catch (error) {
    console.error('[Huly REST] Error fetching issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/issues/:identifier/subissues - List sub-issues of a parent issue
 */
app.get('/api/issues/:identifier/subissues', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { includeDescriptions = 'true', fields: fieldsParam } = req.query;
    const includeDescriptionsFlag = includeDescriptions === 'true' || includeDescriptions === true;
    const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : null;
    console.log(`[Huly REST] Fetching sub-issues for ${identifier}`);

    // Find parent issue
    const parentIssue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!parentIssue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    // Get project for formatting
    const project = await hulyClient.findOne(tracker.class.Project, { _id: parentIssue.space });
    if (!project) {
      return res.status(404).json({ error: 'Project not found for issue' });
    }

    // Find all sub-issues (issues attached to this parent)
    const subIssues = await hulyClient.findAll(
      tracker.class.Issue,
      { attachedTo: parentIssue._id },
      { sort: { number: 1 } }
    );

    console.log(`[Huly REST] Found ${subIssues.length} sub-issues for ${identifier}`);

    const formattedSubIssues = await batchFormatIssues(subIssues, project, { includeDescriptions: includeDescriptionsFlag, fields });

    res.json({
      parentIssue: {
        identifier: parentIssue.identifier,
        title: parentIssue.title,
        subIssueCount: parentIssue.subIssues || 0,
      },
      subIssues: formattedSubIssues,
      count: formattedSubIssues.length,
    });
  } catch (error) {
    console.error('[Huly REST] Error fetching sub-issues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/issues/:identifier/comments - List comments on an issue
 */
app.get('/api/issues/:identifier/comments', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    console.log(`[Huly REST] Fetching comments for ${identifier}`);

    // Find issue
    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    // Find comments attached to this issue
    // Comments in Huly are stored as ChatMessage in the chunter module
    let comments = [];
    try {
      // Try to find Activity comments on the issue
      const activityMessages = await hulyClient.findAll(
        'chunter:class:ChatMessage',
        { attachedTo: issue._id },
        { sort: { createdOn: 1 } }
      );
      comments = activityMessages;
    } catch (e) {
      // Fallback: try different class name
      try {
        const activityMessages = await hulyClient.findAll(
          'activity:class:ActivityMessage',
          { attachedTo: issue._id },
          { sort: { createdOn: 1 } }
        );
        comments = activityMessages;
      } catch (e2) {
        console.log(`[Huly REST] Could not find comments for ${identifier}:`, e2.message);
      }
    }

    console.log(`[Huly REST] Found ${comments.length} comments for ${identifier}`);

    // Format comments
    const formattedComments = await Promise.all(
      comments.map(async (comment) => {
        // Get author info
        let authorEmail = null;
        if (comment.createdBy) {
          try {
            const account = await hulyClient.findOne(core.class.Account, { _id: comment.createdBy });
            authorEmail = account?.email || null;
          } catch (e) {
            // Ignore
          }
        }

        // Extract text content
        let text = '';
        if (typeof comment.message === 'string') {
          text = comment.message;
        } else if (comment.content) {
          text = typeof comment.content === 'string' ? comment.content : JSON.stringify(comment.content);
        }

        return {
          id: comment._id,
          text,
          author: authorEmail,
          createdOn: comment.createdOn ? new Date(comment.createdOn).toISOString() : null,
          modifiedOn: comment.modifiedOn ? new Date(comment.modifiedOn).toISOString() : null,
        };
      })
    );

    res.json({
      issue: identifier,
      comments: formattedComments,
      count: formattedComments.length,
    });
  } catch (error) {
    console.error('[Huly REST] Error fetching comments:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/issues/:identifier/comments - Create a comment on an issue
 */
app.post('/api/issues/:identifier/comments', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    console.log(`[Huly REST] Creating comment on ${identifier}`);

    // Find issue
    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    // Create comment using addCollection
    // Comments are ChatMessage attached to the issue
    const commentId = await hulyClient.addCollection(
      'chunter:class:ChatMessage',
      issue.space,
      issue._id,
      tracker.class.Issue,
      'comments',
      {
        message: text.trim(),
      }
    );
    metadataCache.invalidate('issueCount:');

    // Update issue's comment count
    await hulyClient.updateDoc(tracker.class.Issue, issue.space, issue._id, {
      comments: (issue.comments || 0) + 1,
    });
    metadataCache.invalidate('issueCount:');

    console.log(`[Huly REST] Created comment on ${identifier}`);

    res.status(201).json({
      issue: identifier,
      commentId,
      text: text.trim(),
      created: true,
    });
  } catch (error) {
    console.error('[Huly REST] Error creating comment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/issues/:identifier/subissues - Create a sub-issue under a parent
 */
app.post('/api/issues/:identifier/subissues', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier: parentIdentifier } = req.params;
    const { title, description, priority, component, milestone } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    console.log(`[Huly REST] Creating sub-issue under ${parentIdentifier}: "${title}"`);

    // Find parent issue
    const parentIssue = await hulyClient.findOne(tracker.class.Issue, { identifier: parentIdentifier });
    if (!parentIssue) {
      return res.status(404).json({ error: `Parent issue ${parentIdentifier} not found` });
    }

    // Get project from parent issue
    const project = await hulyClient.findOne(tracker.class.Project, { _id: parentIssue.space });
    if (!project) {
      return res.status(404).json({ error: 'Project not found for parent issue' });
    }

    // Map priority
    const PRIORITY_MAP = {
      NoPriority: 0,
      Urgent: 1,
      High: 2,
      Medium: 3,
      Low: 4,
    };
    const priorityValue = PRIORITY_MAP[priority] ?? PRIORITY_MAP.NoPriority;

    // Get default status
    const statuses = await getCachedStatuses(project._id);
    const backlogStatus = statuses.find(s => s.name === 'Backlog') || statuses[0];
    if (!backlogStatus) {
      return res.status(500).json({ error: 'No statuses found in project' });
    }

    // Generate issue number
    const lastIssue = await hulyClient.findOne(
      tracker.class.Issue,
      { space: project._id },
      { sort: { number: -1 } }
    );
    const number = (lastIssue?.number ?? 0) + 1;
    const newIdentifier = `${project.identifier}-${number}`;

    // Resolve component - inherit from parent if not specified
    let componentId = parentIssue.component;
    if (component) {
      const foundComponent = await hulyClient.findOne(tracker.class.Component, {
        space: project._id,
        label: component,
      });
      if (foundComponent) {
        componentId = foundComponent._id;
      }
    }

    // Resolve milestone - inherit from parent if not specified
    let milestoneId = parentIssue.milestone;
    if (milestone) {
      const foundMilestone = await hulyClient.findOne(tracker.class.Milestone, {
        space: project._id,
        label: milestone,
      });
      if (foundMilestone) {
        milestoneId = foundMilestone._id;
      }
    }

    // Build the parents array (required for Huly's OnIssueUpdate trigger)
    const parentInfo = {
      parentId: parentIssue._id,
      parentTitle: parentIssue.title,
      space: parentIssue.space,
      identifier: parentIssue.identifier,
    };
    const parentsArray = parentIssue.parents && Array.isArray(parentIssue.parents)
      ? [...parentIssue.parents, parentInfo]
      : [parentInfo];

    // Create sub-issue data
    const issueData = {
      title,
      description: description || '',
      assignee: null,
      component: componentId,
      milestone: milestoneId,
      number,
      identifier: newIdentifier,
      priority: priorityValue,
      rank: '',
      status: backlogStatus._id,
      doneState: null,
      dueTo: null,
      attachedTo: parentIssue._id,
      parents: parentsArray,
      comments: 0,
      subIssues: 0,
      estimation: 0,
      remainingTime: 0,
      reportedTime: 0,
      childInfo: [],
      relations: [],
      kind: tracker.taskTypes.Issue,
    };

    const issueId = await hulyClient.addCollection(
      tracker.class.Issue,
      project._id,
      parentIssue._id,
      tracker.class.Issue,
      'subIssues',
      issueData
    );
    metadataCache.invalidate('issueCount:');

    // Upload description if provided
    if (description && description.trim()) {
      try {
        const descriptionRef = await hulyClient.uploadMarkup(
          tracker.class.Issue,
          issueId,
          'description',
          description.trim(),
          'markdown'
        );
        await hulyClient.updateDoc(tracker.class.Issue, project._id, issueId, {
          description: descriptionRef,
        });
        metadataCache.invalidate('issueCount:');
      } catch (error) {
        console.error('[Huly REST] Error uploading description:', error.message);
      }
    }

    // Update parent's subIssues count
    await hulyClient.updateDoc(tracker.class.Issue, parentIssue.space, parentIssue._id, {
      subIssues: (parentIssue.subIssues || 0) + 1,
    });
    metadataCache.invalidate('issueCount:');

    console.log(`[Huly REST] Created sub-issue ${newIdentifier} under ${parentIdentifier}`);

    res.status(201).json({
      identifier: newIdentifier,
      title,
      project: project.identifier,
      status: backlogStatus.name,
      priority: Object.keys(PRIORITY_MAP).find(k => PRIORITY_MAP[k] === priorityValue) || 'NoPriority',
      parentIssue: {
        identifier: parentIssue.identifier,
        title: parentIssue.title,
      },
    });
  } catch (error) {
    console.error('[Huly REST] Error creating sub-issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/issues - Create a new issue
 */
app.post('/api/issues', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { project_identifier, title, description, priority, component, milestone } = req.body;

    if (!project_identifier || !title) {
      return res.status(400).json({ error: 'project_identifier and title are required' });
    }

    // Find project
    const project = await hulyClient.findOne(tracker.class.Project, { identifier: project_identifier });
    if (!project) {
      return res.status(404).json({ error: `Project ${project_identifier} not found` });
    }

    // Map priority
    const PRIORITY_MAP = {
      NoPriority: 0,
      Urgent: 1,
      High: 2,
      Medium: 3,
      Low: 4,
    };
    const priorityValue = PRIORITY_MAP[priority] ?? PRIORITY_MAP.NoPriority;

    // Get default status
    const statuses = await getCachedStatuses(project._id);
    const backlogStatus = statuses.find(s => s.name === 'Backlog') || statuses[0];
    if (!backlogStatus) {
      return res.status(500).json({ error: 'No statuses found in project' });
    }

    // Generate issue number
    const lastIssue = await hulyClient.findOne(
      tracker.class.Issue,
      { space: project._id },
      { sort: { number: -1 } }
    );
    const number = (lastIssue?.number ?? 0) + 1;
    const identifier = `${project.identifier}-${number}`;

    // Resolve component and milestone if provided
    let componentId = null;
    if (component) {
      const comp = await hulyClient.findOne(tracker.class.Component, { space: project._id, label: component });
      componentId = comp?._id || null;
    }

    let milestoneId = null;
    if (milestone) {
      const ms = await hulyClient.findOne(tracker.class.Milestone, { space: project._id, label: milestone });
      milestoneId = ms?._id || null;
    }

    // Create issue
    const issueData = {
      title,
      description: description || '',
      assignee: null,
      component: componentId,
      milestone: milestoneId,
      number,
      identifier,
      priority: priorityValue,
      rank: '',
      status: backlogStatus._id,
      doneState: null,
      dueTo: null,
      attachedTo: tracker.ids.NoParent,
      parents: [], // Empty array for top-level issues (required for OnIssueUpdate trigger)
      comments: 0,
      subIssues: 0,
      estimation: 0,
      remainingTime: 0,
      reportedTime: 0,
      childInfo: [],
      relations: [],
      kind: tracker.taskTypes.Issue,
    };

    const issueId = await hulyClient.addCollection(
      tracker.class.Issue,
      project._id,
      issueData.attachedTo,
      tracker.class.Issue,
      'subIssues',
      issueData
    );
    metadataCache.invalidate('issueCount:');

    // Upload description if provided
    if (description && description.trim()) {
      try {
        const descriptionRef = await hulyClient.uploadMarkup(
          tracker.class.Issue,
          issueId,
          'description',
          description.trim(),
          'markdown'
        );
        await hulyClient.updateDoc(tracker.class.Issue, project._id, issueId, {
          description: descriptionRef,
        });
        metadataCache.invalidate('issueCount:');
      } catch (error) {
        console.error('[Huly REST] Error uploading description:', error.message);
      }
    }

    res.status(201).json({
      identifier,
      title,
      project: project.identifier,
      status: backlogStatus.name,
      priority: Object.keys(PRIORITY_MAP).find(k => PRIORITY_MAP[k] === priorityValue) || 'NoPriority',
    });
  } catch (error) {
    console.error('[Huly REST] Error creating issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/issues/:identifier - Update an issue
 */
app.put('/api/issues/:identifier', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { field, value } = req.body;

    if (!field || value === undefined) {
      return res.status(400).json({ error: 'field and value are required' });
    }

    // Find issue
    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    const updateData = {};
    let displayValue = value;

    switch (field) {
      case 'title':
        updateData.title = value;
        break;

      case 'description':
        if (value && value.trim()) {
          try {
            const descriptionRef = await hulyClient.uploadMarkup(
              tracker.class.Issue,
              issue._id,
              'description',
              value.trim(),
              'markdown'
            );
            updateData.description = descriptionRef;
          } catch (error) {
            return res.status(500).json({ error: `Failed to update description: ${error.message}` });
          }
        } else {
          updateData.description = '';
        }
        break;

      case 'status':
        // Find status by name
        const statuses = await getCachedStatuses(issue.space);
        const targetStatus = statuses.find(s => s.name.toLowerCase() === value.toLowerCase());
        if (!targetStatus) {
          return res.status(400).json({
            error: `Status '${value}' not found`,
            availableStatuses: statuses.map(s => s.name),
          });
        }
        updateData.status = targetStatus._id;
        displayValue = targetStatus.name;
        break;

      case 'priority':
        const PRIORITY_MAP = {
          NoPriority: 0,
          Urgent: 1,
          High: 2,
          Medium: 3,
          Low: 4,
        };
        const priorityValue = PRIORITY_MAP[value];
        if (priorityValue === undefined) {
          return res.status(400).json({
            error: `Priority '${value}' not valid`,
            validPriorities: Object.keys(PRIORITY_MAP),
          });
        }
        updateData.priority = priorityValue;
        displayValue = value;
        break;

      default:
        return res.status(400).json({
          error: `Field '${field}' not supported`,
          supportedFields: ['title', 'description', 'status', 'priority'],
        });
    }

    // Apply update
    await hulyClient.updateDoc(tracker.class.Issue, issue.space, issue._id, updateData);
    metadataCache.invalidate('issueCount:');

    res.json({
      identifier,
      field,
      value: displayValue,
      updated: true,
    });
  } catch (error) {
    console.error('[Huly REST] Error updating issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/issues/:identifier - Delete an issue
 * Query params:
 *   - cascade: 'true' to delete sub-issues as well (default: false, which moves sub-issues to parent level)
 */
app.delete('/api/issues/:identifier', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { cascade = 'false' } = req.query;
    const shouldCascade = cascade === 'true';

    console.log(`[Huly REST] Deleting issue ${identifier} (cascade: ${shouldCascade})`);

    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    const subIssues = await hulyClient.findAll(tracker.class.Issue, { attachedTo: issue._id });
    const subIssueCount = subIssues.length;

    if (subIssueCount > 0) {
      if (shouldCascade) {
        console.log(`[Huly REST] Cascade deleting ${subIssueCount} sub-issues`);
        await deleteIssuesInBatches(subIssues, { batchSize: 50, logPrefix: '[Huly REST] SubIssue' });
      } else {
        console.log(`[Huly REST] Moving ${subIssueCount} sub-issues to parent level`);
        const newParent = issue.attachedTo && issue.attachedTo !== 'tracker:ids:NoParent'
          ? issue.attachedTo
          : tracker.ids.NoParent;
        const newParents = issue.parents && Array.isArray(issue.parents)
          ? issue.parents.slice(0, -1)
          : [];

        await parallelLimit(
          subIssues,
          10,
          async (subIssue) => {
            await hulyClient.updateDoc(tracker.class.Issue, subIssue.space, subIssue._id, {
              attachedTo: newParent,
              parents: newParents,
            });
          }
        );
        metadataCache.invalidate('issueCount:');
      }
    }

    await deleteIssuesInBatches([issue], { batchSize: 1, logPrefix: '[Huly REST]' });
    metadataCache.invalidate('issueCount:');

    console.log(`[Huly REST] Deleted issue ${identifier}`);

    res.json({
      identifier,
      deleted: true,
      subIssuesHandled: subIssueCount,
      cascaded: shouldCascade,
    });
  } catch (error) {
    console.error('[Huly REST] Error deleting issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/issues/:identifier - Update multiple fields at once
 * Body: { title?, description?, status?, priority?, component?, milestone?, assignee? }
 */
app.patch('/api/issues/:identifier', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update provided' });
    }

    console.log(`[Huly REST] Patching issue ${identifier} with fields:`, Object.keys(updates));

    // Find issue
    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    // Get project for component/milestone lookup
    const project = await hulyClient.findOne(tracker.class.Project, { _id: issue.space });
    if (!project) {
      return res.status(404).json({ error: 'Project not found for issue' });
    }

    const updateData = {};
    const appliedUpdates = {};
    const errors = [];

    // Process each field
    for (const [field, value] of Object.entries(updates)) {
      try {
        switch (field) {
          case 'title':
            updateData.title = value;
            appliedUpdates.title = value;
            break;

          case 'description':
            if (value && value.trim()) {
              const descriptionRef = await updateDescriptionMarkup(hulyClient, issue, value.trim());
              updateData.description = descriptionRef;
              appliedUpdates.description = value.trim().substring(0, 100) + (value.length > 100 ? '...' : '');
            } else {
              updateData.description = '';
              appliedUpdates.description = '';
            }
            break;

          case 'status':
            const statuses = await getCachedStatuses(issue.space);
            const targetStatus = statuses.find(s => s.name.toLowerCase() === value.toLowerCase());
            if (!targetStatus) {
              errors.push({ field: 'status', error: `Status '${value}' not found`, available: statuses.map(s => s.name) });
            } else {
              updateData.status = targetStatus._id;
              appliedUpdates.status = targetStatus.name;
            }
            break;

          case 'priority':
            const PRIORITY_MAP = {
              NoPriority: 0,
              Urgent: 1,
              High: 2,
              Medium: 3,
              Low: 4,
            };
            const priorityValue = PRIORITY_MAP[value];
            if (priorityValue === undefined) {
              errors.push({ field: 'priority', error: `Priority '${value}' not valid`, valid: Object.keys(PRIORITY_MAP) });
            } else {
              updateData.priority = priorityValue;
              appliedUpdates.priority = value;
            }
            break;

          case 'component':
            if (value === null || value === '') {
              updateData.component = null;
              appliedUpdates.component = null;
            } else {
              const component = await hulyClient.findOne(tracker.class.Component, { space: project._id, label: value });
              if (!component) {
                errors.push({ field: 'component', error: `Component '${value}' not found` });
              } else {
                updateData.component = component._id;
                appliedUpdates.component = value;
              }
            }
            break;

          case 'milestone':
            if (value === null || value === '') {
              updateData.milestone = null;
              appliedUpdates.milestone = null;
            } else {
              const milestone = await hulyClient.findOne(tracker.class.Milestone, { space: project._id, label: value });
              if (!milestone) {
                errors.push({ field: 'milestone', error: `Milestone '${value}' not found` });
              } else {
                updateData.milestone = milestone._id;
                appliedUpdates.milestone = value;
              }
            }
            break;

          case 'assignee':
            if (value === null || value === '') {
              updateData.assignee = null;
              appliedUpdates.assignee = null;
            } else {
              const account = await hulyClient.findOne(core.class.Account, { email: value });
              if (!account) {
                errors.push({ field: 'assignee', error: `Assignee '${value}' not found` });
              } else {
                updateData.assignee = account._id;
                appliedUpdates.assignee = value;
              }
            }
            break;

          case 'dueDate':
            if (value === null || value === '') {
              updateData.dueDate = null;
              appliedUpdates.dueDate = null;
            } else {
              const timestamp = new Date(value).getTime();
              if (isNaN(timestamp)) {
                errors.push({ field: 'dueDate', error: `Invalid date format: '${value}'` });
              } else {
                updateData.dueDate = timestamp;
                appliedUpdates.dueDate = new Date(timestamp).toISOString();
              }
            }
            break;

          default:
            errors.push({ field, error: `Field '${field}' not supported` });
        }
      } catch (fieldError) {
        errors.push({ field, error: fieldError.message });
      }
    }

    // Apply updates if we have any
    if (Object.keys(updateData).length > 0) {
      await hulyClient.updateDoc(tracker.class.Issue, issue.space, issue._id, updateData);
      metadataCache.invalidate('issueCount:');
      console.log(`[Huly REST] Applied updates to ${identifier}:`, Object.keys(appliedUpdates));
    }

    res.json({
      identifier,
      updated: Object.keys(appliedUpdates).length > 0,
      appliedUpdates,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[Huly REST] Error patching issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/issues/:identifier/parent - Move issue to become a sub-issue of another (or detach to top-level)
 * Body: { "parentIdentifier": "PROJ-123" }  // or null to detach to top-level
 */
app.patch('/api/issues/:identifier/parent', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { parentIdentifier } = req.body;

    console.log(`[Huly REST] Moving issue ${identifier} to parent: ${parentIdentifier || 'TOP-LEVEL'}`);

    // Find the issue to move
    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    // Get the project
    const project = await hulyClient.findOne(tracker.class.Project, { _id: issue.space });
    if (!project) {
      return res.status(404).json({ error: 'Project not found for issue' });
    }

    // Track old parent for updating subIssue counts
    const oldParentId = issue.attachedTo && issue.attachedTo !== 'tracker:ids:NoParent' ? issue.attachedTo : null;

    let newParentId = null;
    let newParentsArray = [];
    let newParentInfo = null;

    if (parentIdentifier) {
      // Moving to a new parent
      const newParent = await hulyClient.findOne(tracker.class.Issue, { identifier: parentIdentifier });
      if (!newParent) {
        return res.status(404).json({ error: `Parent issue ${parentIdentifier} not found` });
      }

      // Prevent circular references - can't make an issue a child of itself or its descendants
      if (newParent._id === issue._id) {
        return res.status(400).json({ error: 'Cannot make an issue a parent of itself' });
      }

      // Check if newParent is a descendant of issue (would create cycle)
      let checkParent = newParent;
      while (checkParent.attachedTo && checkParent.attachedTo !== 'tracker:ids:NoParent') {
        if (checkParent.attachedTo === issue._id) {
          return res.status(400).json({ error: 'Cannot create circular parent-child relationship' });
        }
        checkParent = await hulyClient.findOne(tracker.class.Issue, { _id: checkParent.attachedTo });
        if (!checkParent) break;
      }

      // Ensure same project
      if (newParent.space !== issue.space) {
        return res.status(400).json({ error: 'Cannot move issue to a parent in a different project' });
      }

      newParentId = newParent._id;

      // Build parents array
      const parentInfo = {
        parentId: newParent._id,
        parentTitle: newParent.title,
        space: newParent.space,
        identifier: newParent.identifier,
      };
      newParentsArray = newParent.parents && Array.isArray(newParent.parents)
        ? [...newParent.parents, parentInfo]
        : [parentInfo];

      newParentInfo = {
        identifier: newParent.identifier,
        title: newParent.title,
      };
    }

    // Update the issue
    await hulyClient.updateDoc(tracker.class.Issue, issue.space, issue._id, {
      attachedTo: newParentId || tracker.ids.NoParent,
      parents: newParentsArray,
    });
    metadataCache.invalidate('issueCount:');

    // Update old parent's subIssues count (decrement)
    if (oldParentId) {
      try {
        const oldParent = await hulyClient.findOne(tracker.class.Issue, { _id: oldParentId });
        if (oldParent && oldParent.subIssues > 0) {
          await hulyClient.updateDoc(tracker.class.Issue, oldParent.space, oldParent._id, {
            subIssues: oldParent.subIssues - 1,
          });
          metadataCache.invalidate('issueCount:');
        }
      } catch (e) {
        console.error(`[Huly REST] Error updating old parent subIssue count:`, e.message);
      }
    }

    // Update new parent's subIssues count (increment)
    if (newParentId) {
      try {
        const newParent = await hulyClient.findOne(tracker.class.Issue, { _id: newParentId });
        if (newParent) {
          await hulyClient.updateDoc(tracker.class.Issue, newParent.space, newParent._id, {
            subIssues: (newParent.subIssues || 0) + 1,
          });
          metadataCache.invalidate('issueCount:');
        }
      } catch (e) {
        console.error(`[Huly REST] Error updating new parent subIssue count:`, e.message);
      }
    }

    console.log(`[Huly REST] Moved ${identifier} to ${parentIdentifier || 'top-level'}`);

    res.json({
      identifier,
      moved: true,
      parentIssue: newParentInfo,
      isTopLevel: !newParentId,
    });
  } catch (error) {
    console.error('[Huly REST] Error moving issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update a project's name or description
 * PUT /api/projects/:identifier
 * Body: { field: 'name' | 'description', value: string }
 * OR: { name: string, description: string } (update both at once)
 */
app.put('/api/projects/:identifier', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { field, value, name, description } = req.body;

    // Find project
    const project = await hulyClient.findOne(tracker.class.Project, { identifier });
    if (!project) {
      return res.status(404).json({ error: `Project ${identifier} not found` });
    }

    const updateData = {};
    const updatedFields = [];

    // Support both styles: { field, value } or { name, description }
    if (field && value !== undefined) {
      // Single field update
      if (field === 'name') {
        updateData.name = value;
        updatedFields.push('name');
      } else if (field === 'description') {
        updateData.description = value;
        updatedFields.push('description');
      } else {
        return res.status(400).json({
          error: `Field '${field}' not supported`,
          supportedFields: ['name', 'description'],
        });
      }
    } else {
      // Bulk update style
      if (name !== undefined) {
        updateData.name = name;
        updatedFields.push('name');
      }
      if (description !== undefined) {
        updateData.description = description;
        updatedFields.push('description');
      }
    }

    // Validate we have something to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: 'No valid fields to update',
        hint: 'Provide either { field, value } or { name, description }',
      });
    }

    // Apply update
    await hulyClient.updateDoc(tracker.class.Project, core.space.Space, project._id, updateData);
    metadataCache.invalidate('projects:');

    console.log(`[Huly REST] Updated project ${identifier}:`, updatedFields.join(', '));

    res.json({
      identifier,
      updatedFields,
      updates: updateData,
      success: true,
    });
  } catch (error) {
    console.error('[Huly REST] Error updating project:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  try {
    // Initialize Huly client
    await initializeClient();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`[Huly REST] Server listening on port ${PORT}`);
      console.log(`[Huly REST] Health check: http://localhost:${PORT}/health`);
      console.log(`[Huly REST] API base URL: http://localhost:${PORT}/api`);
    });

    startPoolHealthCheck();
  } catch (error) {
    console.error('[Huly REST] Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Huly REST] Shutting down gracefully...');
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Huly REST] Shutting down gracefully...');
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  process.exit(0);
});

// Start the server
startServer();
