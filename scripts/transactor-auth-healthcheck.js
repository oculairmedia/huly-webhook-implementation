'use strict';

function stripTrailingSlash(value) {
  return typeof value === 'string' ? value.replace(/\/+$/, '') : value;
}

function parseArgs(argv = []) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      if (result.candidateUrl === undefined) {
        result.candidateUrl = token;
      }
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (inlineValue !== undefined) {
      result[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
      continue;
    }

    result[key] = 'true';
  }

  return result;
}

function resolveConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const timeoutMs = Number(
    args.timeoutMs ??
      env.TRANSACTOR_AUTH_HEALTHCHECK_TIMEOUT_MS ??
      env.HULY_PROBE_TIMEOUT_MS ??
      5000
  );

  const config = {
    accountsUrl: stripTrailingSlash(args.accountsUrl ?? env.ACCOUNTS_URL ?? env.HULY_ACCOUNTS_URL ?? ''),
    candidateUrl: stripTrailingSlash(
      args.candidateUrl ?? env.HULY_TRANSACTOR_URL ?? env.TRANSACTOR_URL ?? ''
    ),
    email: args.email ?? env.HULY_EMAIL ?? '',
    failureCount: Number(
      args.failureCount ??
        env.TRANSACTOR_PROBE_FAILURE_COUNT ??
        env.TRANSACTOR_AUTH_FAILURE_COUNT ??
        1
    ),
    nodeIdentity:
      args.nodeIdentity ??
      env.TRANSACTOR_NODE_IDENTITY ??
      stripTrailingSlash(args.candidateUrl ?? env.HULY_TRANSACTOR_URL ?? env.TRANSACTOR_URL ?? ''),
    password: args.password ?? env.HULY_PASSWORD ?? '',
    workspace: args.workspace ?? env.HULY_WORKSPACE ?? '',
    timeoutMs,
  };

  const errors = [];
  if (!config.accountsUrl) errors.push('ACCOUNTS_URL is required');
  if (!config.candidateUrl) errors.push('candidate transactor URL is required');
  if (!config.email) errors.push('HULY_EMAIL is required');
  if (!config.password) errors.push('HULY_PASSWORD is required');
  if (!config.workspace) errors.push('HULY_WORKSPACE is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    errors.push('timeout must be a positive number of milliseconds');
  }

  return { ...config, errors };
}

function stepTimeout(label, timeoutMs) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
  });
}

async function withTimeout(label, timeoutMs, task) {
  return await Promise.race([task, stepTimeout(label, timeoutMs)]);
}

async function runStage(stage, timeoutMs, task) {
  try {
    return await withTimeout(stage, timeoutMs, task);
  } catch (error) {
    error.probeStage = error.probeStage ?? stage;
    throw error;
  }
}

async function loadSdk() {
  const accountClientModule = await import('@hcengineering/account-client');
  const serverClientModule = await import('@hcengineering/server-client');
  const accountClient = accountClientModule.default || accountClientModule;
  const serverClient = serverClientModule.default || serverClientModule;

  if (typeof accountClient.getClient !== 'function') {
    throw new Error('Failed to load @hcengineering/account-client#getClient');
  }

  if (typeof serverClient.createClient !== 'function') {
    throw new Error('Failed to load @hcengineering/server-client#createClient');
  }

  return {
    getAccountClient: accountClient.getClient,
    createClient: serverClient.createClient,
  };
}

async function loadSdkIfAvailable() {
  try {
    return await loadSdk();
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' ||
      /Cannot find package|Failed to load @hcengineering/.test(error?.message ?? '')
    ) {
      return null;
    }
    throw error;
  }
}

async function runMutedStage(stage, timeoutMs, taskFactory) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  const sdkLogs = [];

  const capture = (...args) => {
    sdkLogs.push(args.map((value) => String(value)).join(' '));
  };

  console.error = capture;
  console.warn = capture;
  console.log = capture;

  try {
    return await Promise.race([taskFactory(), stepTimeout(stage, timeoutMs)]);
  } catch (error) {
    error.probeStage = error.probeStage ?? stage;
    error.sdkLogs = sdkLogs;
    throw error;
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    console.log = originalLog;
  }
}

function remaining(deadline) {
  return Math.max(1, deadline - Date.now());
}

async function runSdkProbe(config, sdk) {
  const deadline = Date.now() + config.timeoutMs;

  const anonymousAccountClient = sdk.getAccountClient(
    config.accountsUrl,
    undefined,
    remaining(deadline)
  );

  const loginInfo = await runStage(
    'login',
    remaining(deadline),
    anonymousAccountClient.login(config.email, config.password)
  );

  if (!loginInfo?.token) {
    throw new Error('Login succeeded without a token');
  }

  const authenticatedAccountClient = sdk.getAccountClient(
    config.accountsUrl,
    loginInfo.token,
    remaining(deadline)
  );

  const workspaceInfo = await runStage(
    'selectWorkspace',
    remaining(deadline),
    authenticatedAccountClient.selectWorkspace(config.workspace, 'internal')
  );

  if (!workspaceInfo?.token) {
    throw new Error(`Workspace ${config.workspace} did not return an internal token`);
  }

  let client;
  try {
    client = await runMutedStage(
      'websocket',
      remaining(deadline),
      () => sdk.createClient(config.candidateUrl, workspaceInfo.token, undefined, remaining(deadline))
    );

    const hierarchy = client?.getHierarchy?.();
    if (hierarchy == null) {
      const error = new Error('Connected client returned no hierarchy');
      error.probeStage = 'query';
      throw error;
    }

    return {
      accountsUrl: config.accountsUrl,
      candidateUrl: config.candidateUrl,
      workspace: config.workspace,
    };
  } finally {
    await client?.close?.();
  }
}

async function callAccountRpc(fetchImpl, accountsUrl, method, params, token) {
  const response = await fetchImpl(accountsUrl, {
    method: 'POST',
    headers: {
      Authorization: token ? `Bearer ${token}` : undefined,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ method, params }),
  });

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.message ?? `${method} failed`);
  }

  return payload?.result;
}

async function decodeSocketPayload(data) {
  if (typeof data === 'string') {
    return data;
  }

  if (data?.text) {
    return await data.text();
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  return String(data);
}

function buildProbeSessionId() {
  return `transactor-auth-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runRawSocketProbe(candidateUrl, token, timeoutMs, WebSocketImpl) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let stage = 'websocket';
    let lastHash = '';
    const socket = new WebSocketImpl(
      `${stripTrailingSlash(candidateUrl)}/${token}?sessionId=${buildProbeSessionId()}`
    );
    const timer = setTimeout(() => {
      fail(stage, `${stage} timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    timer.unref?.();

    function cleanup() {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    }

    function fail(probeStage, message) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch (_error) {
        // Ignore close errors during probe failure cleanup.
      }
      const error = new Error(message);
      error.probeStage = probeStage;
      reject(error);
    }

    function succeed() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch (_error) {
        // Ignore close errors during probe cleanup.
      }
      resolve(undefined);
    }

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          binary: false,
          compression: false,
          id: -1,
          method: 'hello',
          params: [],
        })
      );
    };

    socket.onmessage = async (event) => {
      try {
        const text = await decodeSocketPayload(event.data);

        if (text === 'pong!') {
          return;
        }

        const payload = JSON.parse(text);

        if (payload?.result === 'ping') {
          socket.send('ping');
          return;
        }

        if (stage === 'websocket') {
          if (payload?.id !== -1 || payload?.result !== 'hello') {
            fail('websocket', 'unexpected hello response from transactor');
            return;
          }

          lastHash = payload.lastHash ?? '';
          stage = 'query';
          socket.send(
            JSON.stringify({
              id: 1,
              method: 'loadModel',
              params: [0, lastHash],
              time: Date.now(),
            })
          );
          return;
        }

        if (payload?.id === undefined) {
          return;
        }

        if (payload?.error) {
          fail('query', payload.error.message ?? 'loadModel failed');
          return;
        }

        if (payload?.id !== 1 || payload?.result == null) {
          fail('query', 'unexpected loadModel response from transactor');
          return;
        }

        succeed();
      } catch (error) {
        fail(stage, error.message ?? 'failed to decode transactor response');
      }
    };

    socket.onerror = () => {
      fail(stage, `${stage} websocket error`);
    };

    socket.onclose = () => {
      if (!settled) {
        fail(stage, `${stage} websocket closed before completion`);
      }
    };
  });
}

async function runRawProbe(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const WebSocketImpl = deps.WebSocketImpl ?? globalThis.WebSocket;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Raw probe requires fetch support');
  }

  if (typeof WebSocketImpl !== 'function') {
    throw new Error('Raw probe requires WebSocket support');
  }

  const deadline = Date.now() + config.timeoutMs;
  const loginInfo = await runStage(
    'login',
    remaining(deadline),
    callAccountRpc(fetchImpl, config.accountsUrl, 'login', {
      email: config.email,
      password: config.password,
    })
  );

  if (!loginInfo?.token) {
    throw new Error('Login succeeded without a token');
  }

  const workspaceInfo = await runStage(
    'selectWorkspace',
    remaining(deadline),
    callAccountRpc(
      fetchImpl,
      config.accountsUrl,
      'selectWorkspace',
      {
        externalRegions: [],
        kind: 'internal',
        workspaceUrl: config.workspace,
      },
      loginInfo.token
    )
  );

  if (!workspaceInfo?.token) {
    throw new Error(`Workspace ${config.workspace} did not return an internal token`);
  }

  await runRawSocketProbe(
    config.candidateUrl,
    workspaceInfo.token,
    remaining(deadline),
    WebSocketImpl
  );

  return {
    accountsUrl: config.accountsUrl,
    candidateUrl: config.candidateUrl,
    workspace: config.workspace,
  };
}

async function runProbe(config, deps = null) {
  if (deps?.fetchImpl || deps?.WebSocketImpl) {
    return await runRawProbe(config, deps);
  }

  const sdk = deps ?? (await loadSdkIfAvailable());
  if (sdk?.getAccountClient && sdk?.createClient) {
    return await runSdkProbe(config, sdk);
  }

  return await runRawProbe(config, deps ?? {});
}

function buildFailureLog(config, error, startedAt) {
  return {
    consecutiveFailureCount: Number.isFinite(config.failureCount) ? config.failureCount : 1,
    durationMs: Date.now() - startedAt,
    error: error.message,
    nodeIdentity: config.nodeIdentity || config.candidateUrl || 'unknown',
    probe: 'transactor-auth-healthcheck',
    stage: error.probeStage || 'unknown',
    transactor: config.candidateUrl || 'unknown',
    workspace: config.workspace || 'unknown',
  };
}

function usage() {
  return [
    'Usage: node scripts/transactor-auth-healthcheck.js --candidate-url ws://transactor-4:3333',
    'Required env:',
    '  ACCOUNTS_URL, HULY_EMAIL, HULY_PASSWORD, HULY_WORKSPACE',
    'Optional env:',
    '  TRANSACTOR_AUTH_HEALTHCHECK_TIMEOUT_MS',
  ].join('\n');
}

async function main() {
  const config = resolveConfig();
  if (config.errors.length > 0) {
    console.error(config.errors.join('\n'));
    console.error('');
    console.error(usage());
    return 2;
  }

  const result = await runProbe(config);
  console.log(
    `transactor auth probe ok: ${result.candidateUrl} workspace=${result.workspace} accounts=${result.accountsUrl}`
  );
  return 0;
}

function isDirectRun() {
  if (typeof require !== 'undefined' && typeof module !== 'undefined') {
    return require.main === module;
  }

  if (typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv[1]) {
    return process.argv[1].endsWith('/transactor-auth-healthcheck.js');
  }

  return false;
}

if (isDirectRun()) {
  const startedAt = Date.now();
  const directConfig = resolveConfig();

  main()
    .then((code) => {
      if (code !== 0) {
        process.exit(code);
      }
    })
    .catch((error) => {
      console.error(JSON.stringify(buildFailureLog(directConfig, error, startedAt)));
      process.exit(1);
    });
}

const exported = {
  buildFailureLog,
  callAccountRpc,
  decodeSocketPayload,
  loadSdkIfAvailable,
  loadSdk,
  parseArgs,
  resolveConfig,
  runProbe,
  runRawProbe,
  runRawSocketProbe,
  runSdkProbe,
  runMutedStage,
  runStage,
  stripTrailingSlash,
  usage,
  withTimeout,
};

if (typeof module !== 'undefined') {
  module.exports = exported;
}
