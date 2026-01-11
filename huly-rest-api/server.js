/**
 * Huly REST API Server
 *
 * Provides REST endpoints for Huly platform operations, bypassing the MCP protocol
 * to provide better performance for bulk operations and batch issue fetching.
 */

import express from 'express';
import cors from 'cors';
import apiClientModule from '@hcengineering/api-client';
import coreModule from '@hcengineering/core';
import trackerModule from '@hcengineering/tracker';
import WebSocket from 'ws';

const apiClient = apiClientModule.default || apiClientModule;
const { connect } = apiClient;
const core = coreModule.default || coreModule;
const tracker = trackerModule.default || trackerModule;

const app = express();
const PORT = process.env.PORT || 3458;

// Middleware
app.use(cors());
app.use(express.json());

// Configuration from environment
const config = {
  hulyUrl: process.env.HULY_URL || 'https://pm.oculair.ca',
  email: process.env.HULY_EMAIL || 'emanuvaderland@gmail.com',
  password: process.env.HULY_PASSWORD,
  workspace: process.env.HULY_WORKSPACE || 'agentspace',
};

// Global client instance (will be initialized on startup)
let hulyClient = null;

/**
 * Initialize Huly client connection with retry logic
 */
async function initializeClient() {
  const maxAttempts = 10;
  const initialDelay = 3000;
  const backoffFactor = 1.5;
  const maxDelay = 15000;
  
  // Wait for services to be ready on initial startup
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
      console.log('[Huly REST] ========================================');

      // Connect to the platform using the SDK
      console.log('[Huly REST] Calling connect() from @hcengineering/api-client...');
      hulyClient = await connect(config.hulyUrl, {
        email: config.email,
        password: config.password,
        workspace: config.workspace,
        socketFactory: (url) => {
          console.log('[Huly REST] WebSocket connecting to:', url);
          return new WebSocket(url);
        },
      });

      console.log('[Huly REST] ✅ Successfully connected to Huly platform');
      
      // Verify connection works
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
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, retryCount - 1),
        maxDelay
      );
      
      console.log(`[Huly REST] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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
      ? hulyClient.findAll(tracker.class.IssueStatus, { _id: { $in: statusIds } })
      : [],
    componentIds.length > 0 
      ? hulyClient.findAll(tracker.class.Component, { _id: { $in: componentIds } })
      : [],
    milestoneIds.length > 0 
      ? hulyClient.findAll(tracker.class.Milestone, { _id: { $in: milestoneIds } })
      : [],
    assigneeIds.length > 0 
      ? hulyClient.findAll(core.class.Account, { _id: { $in: assigneeIds } })
      : [],
    parentIds.length > 0 
      ? hulyClient.findAll(tracker.class.Issue, { _id: { $in: parentIds } })
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

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connected: hulyClient !== null,
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

    const projects = await hulyClient.findAll(tracker.class.Project, {}, { sort: { modifiedOn: -1 } });

    const projectList = await Promise.all(
      projects.map(async (project) => {
        // Count issues in project
        const issues = await hulyClient.findAll(tracker.class.Issue, { space: project._id });

        return {
          identifier: project.identifier,
          name: project.name,
          description: project.description || '',
          issueCount: issues.length,
          private: project.private || false,
          archived: project.archived || false,
        };
      })
    );

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
    let statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: project._id });
    if (statuses.length === 0) {
      statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: 'core:space:Model' });
    }
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
    let statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: project._id });
    if (statuses.length === 0) {
      statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: 'core:space:Model' });
    }
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
    const projects = await hulyClient.findAll(tracker.class.Project, {});
    const projectMap = new Map(projects.map(p => [p._id, p]));

    // Filter by status if provided (need to resolve status names)
    if (status) {
      const allStatuses = await hulyClient.findAll(tracker.class.IssueStatus, {});
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
    const allMatchingIssues = await hulyClient.findAll(tracker.class.Issue, query, {});
    const totalCount = allMatchingIssues.length;

    // Fetch paginated issues
    const issues = await hulyClient.findAll(
      tracker.class.Issue,
      query,
      {
        sort: { modifiedOn: -1 },
        limit: limitNum,
        // Note: Huly SDK may not support skip directly, so we handle it in-memory if needed
      }
    );

    // Handle offset in-memory since SDK might not support skip
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
    const allStatuses = await hulyClient.findAll(tracker.class.IssueStatus, {});
    const projects = await hulyClient.findAll(tracker.class.Project, {});
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

/**
 * DELETE /api/issues/bulk - Batch delete multiple issues (OPTIMIZED - parallel)
 * Body: {
 *   identifiers: ["PROJ-1", "PROJ-2", ...],
 *   cascade: true/false,
 *   concurrency: 10,
 *   fast: false  // Skip sub-issue handling for maximum speed
 * }
 */
app.delete('/api/issues/bulk', async (req, res) => {
  const startTime = Date.now();
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifiers, cascade = false, concurrency = 10, fast = false } = req.body;

    if (!identifiers || !Array.isArray(identifiers) || identifiers.length === 0) {
      return res.status(400).json({ error: 'identifiers array is required' });
    }

    if (identifiers.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 deletions per request' });
    }

    const parallelism = Math.min(Math.max(concurrency, 1), 20); // Clamp between 1-20
    console.log(`[Huly REST] Bulk deleting ${identifiers.length} issues (cascade: ${cascade}, concurrency: ${parallelism}, fast: ${fast})`);

    // Step 1: Batch fetch all issues at once (single query)
    const allIssues = await hulyClient.findAll(tracker.class.Issue, {
      identifier: { $in: identifiers }
    });

    const issueMap = new Map();
    for (const issue of allIssues) {
      issueMap.set(issue.identifier, issue);
    }

    console.log(`[Huly REST] Found ${issueMap.size}/${identifiers.length} issues in ${Date.now() - startTime}ms`);

    const deleted = [];
    const errors = [];

    // Step 2: Delete issues in parallel with controlled concurrency
    const deleteOne = async (identifier) => {
      const issue = issueMap.get(identifier);
      if (!issue) {
        return { identifier, error: 'Issue not found' };
      }

      try {
        let subIssuesHandled = 0;

        // Fast mode: skip all sub-issue and parent handling
        if (!fast) {
          // Handle sub-issues (still need individual queries here)
          const subIssues = await hulyClient.findAll(tracker.class.Issue, { attachedTo: issue._id });

          if (subIssues.length > 0) {
            if (cascade) {
              // Delete sub-issues in parallel
              await Promise.all(subIssues.map(subIssue =>
                hulyClient.removeDoc(tracker.class.Issue, subIssue.space, subIssue._id)
              ));
              subIssuesHandled = subIssues.length;
            } else {
              // Move sub-issues to parent level in parallel
              const newParent = issue.attachedTo && issue.attachedTo !== 'tracker:ids:NoParent'
                ? issue.attachedTo
                : tracker.ids.NoParent;
              const newParents = issue.parents && Array.isArray(issue.parents)
                ? issue.parents.slice(0, -1)
                : [];
              await Promise.all(subIssues.map(subIssue =>
                hulyClient.updateDoc(tracker.class.Issue, subIssue.space, subIssue._id, {
                  attachedTo: newParent,
                  parents: newParents,
                })
              ));
              subIssuesHandled = subIssues.length;
            }
          }

          // Update parent's subIssues count if this is a sub-issue (fire and forget)
          if (issue.attachedTo && issue.attachedTo !== 'tracker:ids:NoParent') {
            hulyClient.findOne(tracker.class.Issue, { _id: issue.attachedTo })
              .then(parent => {
                if (parent && parent.subIssues > 0) {
                  return hulyClient.updateDoc(tracker.class.Issue, parent.space, parent._id, {
                    subIssues: parent.subIssues - 1,
                  });
                }
              })
              .catch(() => {}); // Ignore parent update errors
          }
        }

        // Delete the issue
        await hulyClient.removeDoc(tracker.class.Issue, issue.space, issue._id);
        return { identifier, subIssuesHandled, cascaded: cascade, success: true };

      } catch (deleteError) {
        return { identifier, error: deleteError.message };
      }
    };

    // Execute deletions with parallelism
    const results = await parallelLimit(identifiers, parallelism, deleteOne);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const val = result.value;
        if (val.success) {
          deleted.push({ identifier: val.identifier, subIssuesHandled: val.subIssuesHandled, cascaded: val.cascaded });
        } else {
          errors.push({ identifier: val.identifier, error: val.error });
        }
      } else {
        errors.push({ identifier: 'unknown', error: result.reason?.message || 'Unknown error' });
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Huly REST] Bulk deleted ${deleted.length}/${identifiers.length} issues in ${elapsed}ms`);

    res.json({
      deleted,
      succeeded: deleted.length,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
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

    // Update issue's comment count
    await hulyClient.updateDoc(tracker.class.Issue, issue.space, issue._id, {
      comments: (issue.comments || 0) + 1,
    });

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
    let statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: project._id });
    if (statuses.length === 0) {
      statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: 'core:space:Model' });
    }
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
      } catch (error) {
        console.error('[Huly REST] Error uploading description:', error.message);
      }
    }

    // Update parent's subIssues count
    await hulyClient.updateDoc(tracker.class.Issue, parentIssue.space, parentIssue._id, {
      subIssues: (parentIssue.subIssues || 0) + 1,
    });

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
    let statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: project._id });
    if (statuses.length === 0) {
      statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: 'core:space:Model' });
    }
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
        let statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: issue.space });
        if (statuses.length === 0) {
          statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: 'core:space:Model' });
        }
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

    // Find issue
    const issue = await hulyClient.findOne(tracker.class.Issue, { identifier });
    if (!issue) {
      return res.status(404).json({ error: `Issue ${identifier} not found` });
    }

    // Check for sub-issues
    const subIssues = await hulyClient.findAll(tracker.class.Issue, { attachedTo: issue._id });
    const subIssueCount = subIssues.length;

    if (subIssueCount > 0 && !shouldCascade) {
      // Move sub-issues to parent level (detach from this issue)
      console.log(`[Huly REST] Moving ${subIssueCount} sub-issues to parent level`);
      for (const subIssue of subIssues) {
        // Update sub-issue to have no parent (or inherit grandparent if exists)
        const newParent = issue.attachedTo && issue.attachedTo !== 'tracker:ids:NoParent' 
          ? issue.attachedTo 
          : tracker.ids.NoParent;
        
        // Update parents array
        const newParents = issue.parents && Array.isArray(issue.parents) 
          ? issue.parents.slice(0, -1) // Remove the deleted issue from parents chain
          : [];
        
        await hulyClient.updateDoc(tracker.class.Issue, subIssue.space, subIssue._id, {
          attachedTo: newParent,
          parents: newParents,
        });
      }
    } else if (subIssueCount > 0 && shouldCascade) {
      // Delete sub-issues recursively
      console.log(`[Huly REST] Cascade deleting ${subIssueCount} sub-issues`);
      for (const subIssue of subIssues) {
        await hulyClient.removeDoc(tracker.class.Issue, subIssue.space, subIssue._id);
      }
    }

    // If this is a sub-issue, update parent's subIssues count
    if (issue.attachedTo && issue.attachedTo !== 'tracker:ids:NoParent') {
      try {
        const parent = await hulyClient.findOne(tracker.class.Issue, { _id: issue.attachedTo });
        if (parent && parent.subIssues > 0) {
          await hulyClient.updateDoc(tracker.class.Issue, parent.space, parent._id, {
            subIssues: parent.subIssues - 1,
          });
        }
      } catch (error) {
        console.error(`[Huly REST] Error updating parent subIssue count:`, error.message);
      }
    }

    // Delete the issue
    await hulyClient.removeDoc(tracker.class.Issue, issue.space, issue._id);

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
              const descriptionRef = await hulyClient.uploadMarkup(
                tracker.class.Issue,
                issue._id,
                'description',
                value.trim(),
                'markdown'
              );
              updateData.description = descriptionRef;
              appliedUpdates.description = value.trim().substring(0, 100) + (value.length > 100 ? '...' : '');
            } else {
              updateData.description = '';
              appliedUpdates.description = '';
            }
            break;

          case 'status':
            let statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: issue.space });
            if (statuses.length === 0) {
              statuses = await hulyClient.findAll(tracker.class.IssueStatus, { space: 'core:space:Model' });
            }
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

    // Update old parent's subIssues count (decrement)
    if (oldParentId) {
      try {
        const oldParent = await hulyClient.findOne(tracker.class.Issue, { _id: oldParentId });
        if (oldParent && oldParent.subIssues > 0) {
          await hulyClient.updateDoc(tracker.class.Issue, oldParent.space, oldParent._id, {
            subIssues: oldParent.subIssues - 1,
          });
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
  } catch (error) {
    console.error('[Huly REST] Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Huly REST] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Huly REST] Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
