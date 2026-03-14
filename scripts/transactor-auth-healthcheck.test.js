'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFailureLog,
  callAccountRpc,
  parseArgs,
  resolveConfig,
  runProbe,
  runRawProbe,
  stripTrailingSlash,
} = require('./transactor-auth-healthcheck.js');

test('stripTrailingSlash removes only trailing slashes', () => {
  assert.equal(stripTrailingSlash('http://account:3000///'), 'http://account:3000');
  assert.equal(stripTrailingSlash('ws://transactor-4:3333'), 'ws://transactor-4:3333');
});

test('parseArgs supports --key=value and positional candidate url', () => {
  const args = parseArgs([
    '--accounts-url=http://account:3000/',
    '--workspace',
    'agentspace',
    'ws://transactor-4:3333/',
  ]);

  assert.deepEqual(args, {
    accountsUrl: 'http://account:3000/',
    workspace: 'agentspace',
    candidateUrl: 'ws://transactor-4:3333/',
  });
});

test('resolveConfig normalizes urls and validates required inputs', () => {
  const config = resolveConfig(
    {
      ACCOUNTS_URL: 'http://account:3000/',
      HULY_EMAIL: 'user@example.com',
      HULY_PASSWORD: 'secret',
      HULY_WORKSPACE: 'agentspace',
    },
    ['--candidate-url', 'ws://transactor-4:3333/']
  );

  assert.equal(config.accountsUrl, 'http://account:3000');
  assert.equal(config.candidateUrl, 'ws://transactor-4:3333');
  assert.equal(config.nodeIdentity, 'ws://transactor-4:3333');
  assert.equal(config.timeoutMs, 5000);
  assert.deepEqual(config.errors, []);
});

test('runProbe authenticates, selects workspace in internal mode, and closes the client', async () => {
  const calls = [];
  let closed = false;

  const deps = {
    getAccountClient(accountsUrl, token, retryTimeoutMs) {
      calls.push(['getAccountClient', accountsUrl, token, retryTimeoutMs > 0]);

      if (token === undefined) {
        return {
          login(email, password) {
            calls.push(['login', email, password]);
            return Promise.resolve({ token: 'login-token' });
          },
        };
      }

      return {
        selectWorkspace(workspace, kind) {
          calls.push(['selectWorkspace', workspace, kind]);
          return Promise.resolve({ token: 'workspace-token' });
        },
      };
    },
    createClient(candidateUrl, token, model, connectTimeout) {
      calls.push(['createClient', candidateUrl, token, model, connectTimeout > 0]);
      return Promise.resolve({
        getHierarchy() {
          calls.push(['getHierarchy']);
          return { ok: true };
        },
        close() {
          closed = true;
          calls.push(['close']);
          return Promise.resolve();
        },
      });
    },
  };

  const result = await runProbe(
    {
      accountsUrl: 'http://account:3000',
      candidateUrl: 'ws://transactor-4:3333',
      email: 'user@example.com',
      password: 'secret',
      workspace: 'agentspace',
      timeoutMs: 5000,
    },
    deps
  );

  assert.equal(result.candidateUrl, 'ws://transactor-4:3333');
  assert.equal(closed, true);
  assert.deepEqual(
    calls.map((entry) => entry[0]),
    ['getAccountClient', 'login', 'getAccountClient', 'selectWorkspace', 'createClient', 'getHierarchy', 'close']
  );
  assert.deepEqual(calls[3], ['selectWorkspace', 'agentspace', 'internal']);
});

test('runProbe fails when workspace selection does not return a token', async () => {
  const deps = {
    getAccountClient(_accountsUrl, token) {
      if (token === undefined) {
        return {
          login() {
            return Promise.resolve({ token: 'login-token' });
          },
        };
      }

      return {
        selectWorkspace() {
          return Promise.resolve(undefined);
        },
      };
    },
    createClient() {
      throw new Error('should not connect without workspace token');
    },
  };

  await assert.rejects(
    runProbe(
      {
        accountsUrl: 'http://account:3000',
        candidateUrl: 'ws://transactor-1:3333',
        email: 'user@example.com',
        password: 'secret',
        workspace: 'agentspace',
        timeoutMs: 5000,
      },
      deps
    ),
    /did not return an internal token/
  );
});

test('buildFailureLog captures stage, identity, and failure count', () => {
  const error = new Error('boom');
  error.probeStage = 'websocket';

  const log = buildFailureLog(
    {
      candidateUrl: 'ws://transactor-1:3333',
      failureCount: 3,
      nodeIdentity: 'transactor-1',
      workspace: 'agentspace',
    },
    error,
    Date.now() - 25
  );

  assert.equal(log.stage, 'websocket');
  assert.equal(log.nodeIdentity, 'transactor-1');
  assert.equal(log.consecutiveFailureCount, 3);
  assert.equal(log.transactor, 'ws://transactor-1:3333');
  assert.equal(log.workspace, 'agentspace');
  assert.ok(log.durationMs >= 0);
});

test('callAccountRpc posts JSON-RPC and returns the result payload', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.method, init.headers.Authorization, JSON.parse(init.body)]);
    return {
      async json() {
        return { result: { token: 'abc' } };
      },
    };
  };

  const result = await callAccountRpc(
    fetchImpl,
    'http://account:3000',
    'selectWorkspace',
    { workspaceUrl: 'agentspace' },
    'bearer-token'
  );

  assert.deepEqual(result, { token: 'abc' });
  assert.deepEqual(calls[0], [
    'http://account:3000',
    'POST',
    'Bearer bearer-token',
    { method: 'selectWorkspace', params: { workspaceUrl: 'agentspace' } },
  ]);
});

test('runRawProbe performs hello and loadModel over WebSocket', async () => {
  const sent = [];
  let socketClosed = false;

  class FakeSocket {
    constructor(url) {
      this.url = url;
      setImmediate(() => this.onopen?.());
    }

    send(payload) {
      const message =
        typeof payload === 'string' && payload.startsWith('{')
          ? JSON.parse(payload)
          : payload;
      if (message === 'ping') {
        setImmediate(() => this.onmessage?.({ data: 'pong!' }));
        setImmediate(() =>
          this.onmessage?.({
            data: JSON.stringify({ result: [{ _id: 'tx-1' }] }),
          })
        );
        setImmediate(() =>
          this.onmessage?.({
            data: JSON.stringify({ id: 1, result: { full: false, hash: 'abc', transactions: [] } }),
          })
        );
        return;
      }

      sent.push(message);

      if (message.method === 'hello') {
        setImmediate(() =>
          this.onmessage?.({
            data: JSON.stringify({ id: -1, result: 'hello', lastHash: 'abc' }),
          })
        );
        return;
      }

      setImmediate(() =>
        this.onmessage?.({
          data: JSON.stringify({ result: 'ping' }),
        })
      );
    }

    close() {
      socketClosed = true;
    }
  }

  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === 'login') {
      return { async json() { return { result: { token: 'login-token' } }; } };
    }

    return {
      async json() {
        return { result: { token: 'workspace-token' } };
      },
    };
  };

  const result = await runRawProbe(
    {
      accountsUrl: 'http://account:3000',
      candidateUrl: 'ws://transactor-4:3333',
      email: 'user@example.com',
      password: 'secret',
      workspace: 'agentspace',
      timeoutMs: 5000,
    },
    { fetchImpl, WebSocketImpl: FakeSocket }
  );

  assert.equal(result.candidateUrl, 'ws://transactor-4:3333');
  assert.equal(socketClosed, true);
  assert.deepEqual(
    sent.map((message) => message.method),
    ['hello', 'loadModel']
  );
});
