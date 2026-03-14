# PRD: Huly Transactor Self-Healing and Authenticated Health Recovery

## Document Control

- Status: Draft
- Date: 2026-03-13
- Scope: `/opt/stacks/huly-test-v07`
- Primary systems:
  - Huly transactors
  - Huly REST API
  - Huly MCP server
  - Account and workspace services

## Executive Summary

The current Huly deployment can survive total process death better than it can survive partial transactor corruption after CockroachDB and Kafka disruptions. In the observed failure mode, transactor processes remained alive, Docker continued to report them healthy, and clients kept routing traffic toward broken nodes that could still accept sockets but could no longer complete authenticated workspace sessions.

The permanent fix is not "retry harder." The fix is to make authenticated workspace connectivity the system's definition of health, to route all internal clients through a single canonical transactor endpoint, and to ensure partially corrupted transactors are automatically removed from service and restarted.

## Problem Statement

The current deployment has three coupled problems:

1. Transactor health is measured at the port level, not at the authenticated session level.
2. Core Huly services and custom clients disagree about the internal transactor topology.
3. Route and pool logic in the REST and MCP layers amplify partial failures into hangs and timeouts.

This creates a "split-brain health" condition:

- Docker says transactors are healthy.
- Huly account selection still advertises a preferred internal transactor.
- REST and MCP try to build their own multi-transactor pools.
- Only a subset of transactors may actually be capable of serving authenticated sessions.
- Some routes still pin to a stale primary client even when a healthy pooled client exists.

## Observed Failure

On 2026-03-13 around 20:01 EDT (`2026-03-14T00:01Z`):

- CockroachDB restarted and logged disk slowness.
- Transactors logged Cockroach connection failures including `ECONNREFUSED`, `ECONNRESET`, `CONNECTION_DESTROYED`, and `CONNECTION_ENDED`.
- Transactors also logged Kafka leader and coordinator churn.
- The transactor containers did not OOM, did not exit, and therefore did not restart.
- Authenticated Huly SDK connections succeeded against only a subset of transactors.
- The REST API degraded to one active pooled client while still reporting `connected: true`.
- `/api/issues/:identifier` hung because it used the primary client directly.
- `/api/projects` timed out because it performs a full issue scan on the request path.

## Root Cause

### 1. Healthcheck depth is incorrect

The transactor healthcheck in [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L211) only proves that the process is listening on port `3333`. It does not prove:

- login works
- workspace selection works
- the transactor can complete an authenticated WebSocket session
- the transactor can still serve queries after DB/Kafka disruption

### 2. Internal topology is inconsistent

Core Huly services still advertise a single canonical internal transactor through:

- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L500)
- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L527)

But custom clients override that by enumerating raw transactor instances in:

- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L734)
- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L779)

This means the platform itself and the custom clients do not agree on what the internal transactor endpoint actually is.

### 3. REST and MCP use different connection models

The REST API uses an internal login flow:

- workspace selection via [`server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L463)
- manual multi-transactor connection via [`server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L471)

The MCP server uses generic `api-client` connect with URL rewriting:

- [`HulyClient.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClient.js#L129)

These are not equivalent failure domains.

### 4. Route-level resilience is incomplete

- `/api/issues/:identifier` uses `hulyClient` directly in [`server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L2275)
- `/api/projects` scans all issues in [`server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L1062)
- query timeouts are enforced in [`server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L220)
- pool health is summarized too optimistically in [`server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L1005)

## Product Goals

1. A partially corrupted transactor must be detected within 60 seconds.
2. A broken transactor must be removed from service automatically without operator intervention.
3. A broken transactor must be restarted automatically if it cannot recover.
4. All internal Huly clients must route through one canonical internal transactor endpoint model.
5. REST and MCP must use the same authenticated internal connection strategy.
6. Single-node failure must not cause request hangs.
7. Health endpoints must reflect user-visible service truth, not mere process liveness.

## Non-Goals

1. Rewriting Huly transactor internals from scratch.
2. Building a globally distributed, multi-region failover system.
3. Solving every Cockroach or Kafka failure mode in this document.
4. Preserving the current raw multi-node client pool design if it conflicts with correctness.

## Guiding Principles

1. Session health beats socket health.
2. One canonical endpoint beats many hard-coded guesses.
3. Recovery should remove bad nodes before retrying them.
4. Routes must prefer bounded failure over hanging indefinitely.
5. A self-healing mechanism that only reacts to process death is insufficient.

## Proposed Solution

## Solution Overview

Implement four coordinated layers:

1. Canonical internal transactor endpoint
2. Authenticated health probe and watchdog restart
3. Unified internal connection flow for REST and MCP
4. Route and pool hardening in REST and MCP

## 1. Canonical Internal Transactor Endpoint

### Requirement

All internal Huly-facing services must stop enumerating raw transactor nodes directly.

### Design

Introduce one canonical internal endpoint:

- `ws://transactor-router:3333` for internal service-to-transactor traffic

Then update:

- account service
- workspace service
- REST API
- MCP server

to use that single internal endpoint.

### Options

#### Option A: Immediate stabilization

Use a single known-good transactor as the canonical endpoint temporarily.

Pros:
- Fastest path
- Lowest code complexity
- Good emergency stabilization step

Cons:
- No real failover
- Still fragile if that node fails

#### Option B: Durable target

Add a lightweight internal router or proxy that forwards only to auth-healthy transactors.

Pros:
- Stable service name
- Decouples clients from raw transactor instance lists
- Enables controlled failover

Cons:
- More moving parts
- Requires health membership management

### Recommendation

Use Option A as an immediate mitigation and Option B as the permanent design.

## 2. Authenticated Health Probe and Watchdog

### Requirement

A transactor is healthy only if it can complete:

1. login
2. `selectWorkspace(workspace, 'internal')`
3. authenticated WebSocket connect
4. `getHierarchy()`

### Design

Create a health probe script with the following behavior:

1. authenticate using the configured Huly credentials
2. select the target workspace in internal mode
3. open a WebSocket session against the candidate transactor
4. verify a cheap client call succeeds
5. exit non-zero on failure

### Watchdog behavior

If the probe fails `N` consecutive times:

- mark the node unhealthy for routing
- terminate PID 1 inside the container
- let Docker restart the transactor

### Why this is necessary

The current healthcheck in [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L211) only proves port liveness. It does not detect the exact failure mode already observed.

## 3. Unify REST and MCP on the Same Internal Connection Flow

### Current mismatch

REST:

- explicit login
- explicit `selectWorkspace(..., 'internal')`
- explicit token-based internal connect

MCP:

- `api-client` email/password connect
- URL rewrite trick in [`HulyClient.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClient.js#L135)

### Target

Both REST and MCP must use the same internal session establishment flow:

1. login
2. `selectWorkspace(..., 'internal')`
3. use returned token plus canonical internal endpoint
4. verify session health before admitting client to pool

### Required changes

- Replace MCP `HulyClient._attemptConnection()` with the REST-style internal handshake
- Remove public URL rewrite dependence from MCP
- Make REST use the selected workspace endpoint as the canonical primary source of truth

## 4. Hardening REST and MCP Pools

### REST hardening

Required changes in [`server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js):

1. Do not use `config.transactorUrls` as the source of truth after workspace selection.
2. Prefer the canonical routed endpoint or selected internal endpoint.
3. Make `/health` fail when authenticated query health is degraded, not merely when `hulyClient !== null`.
4. Make `/api/issues/:identifier` use healthy pooled clients instead of raw `hulyClient`.
5. Remove the full issue scan from `/api/projects` request path.

### MCP hardening

Required changes in [`HulyClientPool.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClientPool.js):

1. Stop assuming every configured transactor URL is equally valid.
2. Treat the canonical routed endpoint as primary.
3. If explicit failover URLs remain, keep them behind probe-based admission.
4. If a reconnect cycle repeatedly fails across all candidates, emit a hard degraded state instead of endlessly thrashing.

## Functional Requirements

### FR-1: Transactor health

- The health probe must complete in under 5 seconds under normal conditions.
- A transactor failing 3 consecutive authenticated probes must be marked unhealthy.
- An unhealthy transactor must be restarted automatically within 90 seconds.

### FR-2: Client routing

- Internal clients must connect through one canonical internal endpoint.
- REST and MCP must not maintain separate beliefs about preferred raw transactor nodes.

### FR-3: Request handling

- No read route may hang indefinitely waiting on a stale primary client.
- Single issue read must fail fast or succeed from a healthy client.
- Project listing must not depend on full-table issue scans during user requests.

### FR-4: Observability

- Expose count of auth-healthy transactors
- Expose probe success and failure rates
- Expose restart counts due to watchdog intervention
- Expose per-route timeout and fallback counters

## Non-Functional Requirements

1. No manual intervention required for single transactor corruption.
2. Mean time to recover from partial transactor corruption under 2 minutes.
3. Health endpoints must reflect user-visible degradations within 1 probe interval.
4. No route may wait longer than its configured timeout without a structured error.

## Detailed Engineering Plan

## Phase 0: Emergency stabilization

1. Pin REST and MCP to the one currently known-good internal transactor or temporary router.
2. Remove raw `HULY_TRANSACTOR_URLS` from production traffic path.
3. Keep existing multi-node topology out of the client config until health-based routing exists.

## Phase 1: Authenticated watchdog

1. Add `scripts/transactor-auth-healthcheck.js`
2. Replace transactor curl healthcheck with authenticated probe
3. Add restart-on-consecutive-failure behavior
4. Add structured logs for probe failures

## Phase 2: Canonical router

1. Add `transactor-router` service
2. Back it with only auth-healthy members
3. Point account/workspace to `ws://transactor-router:3333`
4. Point REST/MCP to the same endpoint

## Phase 3: Client convergence

1. Refactor MCP `HulyClient` to use internal login flow
2. Refactor REST initialization to trust selected internal endpoint or router
3. Remove raw transactor list from default runtime path

## Phase 4: Route resilience

1. Change `/api/issues/:identifier` to use pool selection
2. Change `/health` and `/health/detailed` to run real cheap authenticated checks
3. Move project issue counts off the request path

## File-Level Change Map

### Compose and deployment

- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L211)
- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L500)
- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L527)
- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L734)
- [`docker-compose.yml`](/opt/stacks/huly-test-v07/docker-compose.yml#L779)

### REST API

- [`huly-rest-api/server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L295)
- [`huly-rest-api/server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L463)
- [`huly-rest-api/server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L582)
- [`huly-rest-api/server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L1005)
- [`huly-rest-api/server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L1062)
- [`huly-rest-api/server.js`](/opt/stacks/huly-test-v07/huly-rest-api/server.js#L2275)

### MCP server

- [`huly-mcp-server/src/core/HulyClient.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClient.js#L129)
- [`huly-mcp-server/src/core/HulyClient.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClient.js#L193)
- [`huly-mcp-server/src/core/HulyClientPool.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClientPool.js#L63)
- [`huly-mcp-server/src/core/HulyClientPool.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClientPool.js#L124)
- [`huly-mcp-server/src/core/HulyClientPool.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClientPool.js#L193)
- [`huly-mcp-server/src/core/HulyClientPool.js`](/opt/stacks/huly-test-v07/huly-mcp-server/src/core/HulyClientPool.js#L280)

## Acceptance Criteria

The solution is complete when all of the following are true:

1. Killing Cockroach or causing a brief Kafka coordination fault no longer leaves transactors permanently "healthy but unusable."
2. A transactor that can no longer complete authenticated workspace sessions is removed from service automatically.
3. Docker health for transactors flips unhealthy for the observed partial-corruption state.
4. REST `/health` reports degraded when only a stale or unusable primary remains.
5. REST `/api/issues/:identifier` either succeeds through a healthy client or fails fast with a bounded timeout.
6. REST `/api/projects` no longer performs a full issue scan on every request.
7. MCP recovers automatically after a single transactor becomes unusable.
8. All internal components agree on one canonical internal transactor endpoint model.

## Test Plan

## Unit tests

1. Probe success and failure classification
2. Consecutive failure threshold logic
3. Router membership add and remove behavior
4. MCP internal connection flow success and failover behavior
5. REST route pool selection for single issue read

## Integration tests

1. Start stack with one healthy transactor and verify normal reads
2. Simulate transactor socket-only health while auth connect fails
3. Verify healthcheck transitions to unhealthy
4. Verify watchdog restart occurs
5. Verify REST and MCP recover without manual intervention

## Chaos tests

1. Restart CockroachDB under read load
2. Induce Kafka leader churn
3. Drop transactor DB connectivity temporarily
4. Confirm nodes re-enter service only after authenticated probe passes

## Manual validation commands

1. `docker compose ps`
2. `docker logs <transactor>`
3. `curl /health`
4. `curl /health/detailed`
5. internal auth probe script against each transactor
6. single issue and project list request timing before and after

## Risks

1. A router without authenticated membership control would only move the problem.
2. Aggressive watchdog restart thresholds could cause flapping under transient network jitter.
3. MCP and REST connection refactors could introduce auth regressions if done separately.
4. If transactor corruption is caused by an upstream Huly defect, watchdog restart is required even after all client fixes.

## Open Questions

1. Should the permanent router live inside Compose or inside the Huly application layer?
2. Should bad transactors be killed immediately on probe failure, or only after `N` failures plus a grace period?
3. Do we want one watchdog per transactor container or one external supervisor service?
4. Should account/workspace continue to publish a concrete transactor endpoint, or should they only publish the router?

## Recommendation

Do not keep the current raw multi-transactor client pool as the permanent design.

The durable fix is:

1. canonical routed internal endpoint
2. authenticated transactor health probe
3. watchdog restart for partial corruption
4. unified internal connection flow for REST and MCP
5. route-level removal of stale primary assumptions

Anything short of that will keep the same class of failure alive, even if individual timeout values or retries are adjusted.
