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
 * Initialize Huly client connection
 */
async function initializeClient() {
  try {
    console.log('[Huly REST] Connecting to Huly platform...');
    console.log(`[Huly REST] URL: ${config.hulyUrl}`);
    console.log(`[Huly REST] Workspace: ${config.workspace}`);

    // Connect to the platform using the SDK
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
    return true;
  } catch (error) {
    console.error('[Huly REST] ❌ Failed to connect to Huly:', error.message);
    throw error;
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
 * Format issue for REST API response
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

  return {
    identifier: issue.identifier,
    title: issue.title,
    description,
    status: statusName,
    priority: priorityNames[issue.priority] || 'NoPriority',
    component: componentLabel,
    milestone: milestoneLabel,
    assignee: assigneeEmail,
    createdOn: issue.createdOn,
    modifiedOn: issue.modifiedOn,
    number: issue.number,
    project: project.identifier,
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
 *   - modifiedAfter: ISO timestamp to fetch only issues modified after this time
 *   - limit: Maximum number of issues to return (default 1000)
 */
app.get('/api/projects/:identifier/issues', async (req, res) => {
  try {
    if (!hulyClient) {
      return res.status(503).json({ error: 'Huly client not initialized' });
    }

    const { identifier } = req.params;
    const { modifiedAfter, limit = 1000 } = req.query;

    // Find project
    const project = await hulyClient.findOne(tracker.class.Project, { identifier });
    if (!project) {
      return res.status(404).json({ error: `Project ${identifier} not found` });
    }

    // Build query
    const query = { space: project._id };

    // Add timestamp filter if provided
    if (modifiedAfter) {
      const timestamp = new Date(modifiedAfter).getTime();
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid modifiedAfter timestamp' });
      }
      query.modifiedOn = { $gte: timestamp };
    }

    // Fetch issues
    console.log(`[Huly REST] Fetching issues for project ${identifier}`);
    if (modifiedAfter) {
      console.log(`[Huly REST]   Modified after: ${modifiedAfter}`);
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

    // Format issues (with full details including descriptions)
    const formattedIssues = await Promise.all(
      issues.map(issue => formatIssue(issue, project))
    );

    res.json({
      project: identifier,
      issues: formattedIssues,
      count: formattedIssues.length,
      filtered: !!modifiedAfter,
    });
  } catch (error) {
    console.error('[Huly REST] Error fetching issues:', error);
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
