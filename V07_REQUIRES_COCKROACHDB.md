# v0.7 Migration Status - BLOCKED

## Issue Summary

The Huly v0.7 test stack **CANNOT run with MongoDB**. It requires CockroachDB.

## What We Fixed

✅ **QUEUE_CONFIG** - Changed from `kafka|kafka:9092` to `kafka:9092`
✅ **Duplicate ACCOUNT_DB_URL** - Removed duplicate environment variable
✅ **PROCEED_V7_MONGO** - Added flag (but this doesn't make MongoDB work, it just acknowledges the limitation)

## Root Cause

The v0.7 services are **designed for CockroachDB**, not MongoDB:

1. **Account Service** - Requires `PROCEED_V7_MONGO=true` to even start with MongoDB
2. **Workspace Service** - Expects `ACCOUNT_DB_URL` pointing to **CockroachDB**, not MongoDB
   - Error: "Please provide account db url" means it wants CockroachDB connection
   - Service crashes immediately when it doesn't find CockroachDB

## Official Migration Documentation States

> **WARNING: Do not upgrade directly from v6 to v7. Direct upgrades will lock your deployment with MongoDB-specific data.**

The proper migration path is:
1. Backup v0.6 data
2. Deploy **fresh v0.7 with CockroachDB** (not MongoDB!)
3. Restore using migration tool

## Current Test Stack Configuration

- ❌ Uses MongoDB instead of CockroachDB
- ❌ Missing CockroachDB containers
- ❌ Using `PROCEED_V7_MONGO=true` (deprecated compatibility flag)
- ⚠️ This setup will NEVER work properly

## Next Steps

### Option 1: Proper v0.7 Migration (Recommended)
1. Keep v0.6 production running
2. Set up NEW stack with CockroachDB
3. Follow official migration procedure

### Option 2: Stay on v0.6
- Current v0.6 production is stable at `http://pm.oculair.ca:8101`
- No urgency to migrate to v0.7
- Wait for proper CockroachDB infrastructure planning

## Summary

**The v0.7 test stack needs to be rebuilt from scratch with CockroachDB.**

Attempting to run v0.7 with MongoDB is futile - the services are fundamentally incompatible.

---

**Date**: 2025-11-19  
**Stack Location**: `/opt/stacks/huly-test-v07`  
**Status**: BLOCKED - Requires CockroachDB infrastructure
