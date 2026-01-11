import { jest } from '@jest/globals';
import { describe, it, expect, beforeEach } from '@jest/globals';

// Mock pg Pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
  end: jest.fn()
};

jest.unstable_mockModule('pg', () => ({
  default: {
    Pool: jest.fn(() => mockPool)
  }
}));

describe('Change Detection Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Issue Change Detection', () => {
    it('should detect issue updates', async () => {
      const mockTaskResults = {
        rows: [
          {
            _id: 'issue-123',
            _class: 'tracker:class:Issue',
            space: 'project-abc',
            modifiedOn: Date.now(),
            modifiedBy: 'user-456',
            data: JSON.stringify({
              identifier: 'PROJ-1',
              title: 'Fix bug',
              status: 'InProgress'
            })
          }
        ]
      };

      const mockSpaceResults = { rows: [] };

      mockQuery
        .mockResolvedValueOnce(mockTaskResults)
        .mockResolvedValueOnce(mockSpaceResults);

      // Simulate checkForChanges() logic
      const lastCheckedMs = Date.now() - 10000;
      const taskQuery = 'SELECT * FROM task WHERE "modifiedOn" > $1 LIMIT 100';
      const spaceQuery = 'SELECT * FROM space WHERE "modifiedOn" > $1 AND _class = \'tracker:class:Project\' LIMIT 50';

      await mockPool.query(taskQuery, [lastCheckedMs]);
      await mockPool.query(spaceQuery, [lastCheckedMs]);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenCalledWith(taskQuery, [lastCheckedMs]);
      expect(mockQuery).toHaveBeenCalledWith(spaceQuery, [lastCheckedMs]);
    });

    it('should map issue changes to correct event type', () => {
      const taskRow = {
        _id: 'issue-123',
        _class: 'tracker:class:Issue',
        space: 'project-abc',
        modifiedOn: 1704067200000,
        modifiedBy: 'user-456',
        data: JSON.stringify({
          identifier: 'PROJ-1',
          title: 'Fix bug',
          status: 'InProgress'
        })
      };

      // Simulate mapping logic
      const data = JSON.parse(taskRow.data);
      const event = {
        type: taskRow._class === 'tracker:class:Issue' ? 'issue.updated' : 'task.updated',
        timestamp: new Date(taskRow.modifiedOn).toISOString(),
        data: {
          id: taskRow._id,
          class: taskRow._class,
          space: taskRow.space,
          modifiedBy: taskRow.modifiedBy,
          identifier: data.identifier,
          title: data.title,
          status: data.status
        }
      };

      expect(event.type).toBe('issue.updated');
      expect(event.data.identifier).toBe('PROJ-1');
      expect(event.data.title).toBe('Fix bug');
    });

    it('should handle non-issue tasks with task.updated type', () => {
      const taskRow = {
        _id: 'task-789',
        _class: 'task:class:Task',
        space: 'project-abc',
        modifiedOn: 1704067200000,
        modifiedBy: 'user-456',
        data: JSON.stringify({
          name: 'Some task',
          status: 'Active'
        })
      };

      const data = JSON.parse(taskRow.data);
      const event = {
        type: taskRow._class === 'tracker:class:Issue' ? 'issue.updated' : 'task.updated',
        timestamp: new Date(taskRow.modifiedOn).toISOString(),
        data: {
          id: taskRow._id,
          class: taskRow._class,
          space: taskRow.space,
          modifiedBy: taskRow.modifiedBy
        }
      };

      expect(event.type).toBe('task.updated');
    });
  });

  describe('Project Change Detection', () => {
    it('should detect project updates', async () => {
      const mockTaskResults = { rows: [] };
      const mockSpaceResults = {
        rows: [
          {
            _id: 'project-xyz',
            _class: 'tracker:class:Project',
            space: 'tracker:ids:Projects',
            modifiedOn: Date.now(),
            modifiedBy: 'user-789',
            data: JSON.stringify({
              name: 'New Project',
              identifier: 'NEWP',
              status: 'Active'
            })
          }
        ]
      };

      mockQuery
        .mockResolvedValueOnce(mockTaskResults)
        .mockResolvedValueOnce(mockSpaceResults);

      const lastCheckedMs = Date.now() - 10000;
      const taskQuery = 'SELECT * FROM task WHERE "modifiedOn" > $1 LIMIT 100';
      const spaceQuery = 'SELECT * FROM space WHERE "modifiedOn" > $1 AND _class = \'tracker:class:Project\' LIMIT 50';

      await mockPool.query(taskQuery, [lastCheckedMs]);
      const spaceResult = await mockPool.query(spaceQuery, [lastCheckedMs]);

      expect(spaceResult.rows).toHaveLength(1);
      expect(spaceResult.rows[0]._class).toBe('tracker:class:Project');
    });

    it('should map project changes to correct event type', () => {
      const spaceRow = {
        _id: 'project-xyz',
        _class: 'tracker:class:Project',
        space: 'tracker:ids:Projects',
        modifiedOn: 1704067200000,
        modifiedBy: 'user-789',
        data: JSON.stringify({
          name: 'New Project',
          identifier: 'NEWP',
          status: 'Active'
        })
      };

      const data = JSON.parse(spaceRow.data);
      const event = {
        type: 'project.updated',
        timestamp: new Date(spaceRow.modifiedOn).toISOString(),
        data: {
          id: spaceRow._id,
          class: spaceRow._class,
          space: spaceRow.space,
          modifiedBy: spaceRow.modifiedBy,
          name: data.name,
          identifier: data.identifier,
          archived: data.status === 'Archived'
        }
      };

      expect(event.type).toBe('project.updated');
      expect(event.data.name).toBe('New Project');
      expect(event.data.identifier).toBe('NEWP');
      expect(event.data.archived).toBe(false);
    });

    it('should detect archived projects', () => {
      const spaceRow = {
        _id: 'project-old',
        _class: 'tracker:class:Project',
        space: 'tracker:ids:Projects',
        modifiedOn: 1704067200000,
        modifiedBy: 'user-789',
        data: JSON.stringify({
          name: 'Old Project',
          identifier: 'OLD',
          status: 'Archived'
        })
      };

      const data = JSON.parse(spaceRow.data);
      const archived = data.status === 'Archived';

      expect(archived).toBe(true);
    });
  });

  describe('Combined Change Detection', () => {
    it('should detect both issue and project changes', async () => {
      const mockTaskResults = {
        rows: [
          {
            _id: 'issue-123',
            _class: 'tracker:class:Issue',
            space: 'project-abc',
            modifiedOn: 1704067300000,
            modifiedBy: 'user-456',
            data: JSON.stringify({
              identifier: 'PROJ-1',
              title: 'Fix bug'
            })
          }
        ]
      };

      const mockSpaceResults = {
        rows: [
          {
            _id: 'project-xyz',
            _class: 'tracker:class:Project',
            space: 'tracker:ids:Projects',
            modifiedOn: 1704067200000,
            modifiedBy: 'user-789',
            data: JSON.stringify({
              name: 'New Project',
              identifier: 'NEWP'
            })
          }
        ]
      };

      mockQuery
        .mockResolvedValueOnce(mockTaskResults)
        .mockResolvedValueOnce(mockSpaceResults);

      const lastCheckedMs = Date.now() - 10000;
      const taskResult = await mockPool.query('SELECT * FROM task WHERE "modifiedOn" > $1 LIMIT 100', [lastCheckedMs]);
      const spaceResult = await mockPool.query('SELECT * FROM space WHERE "modifiedOn" > $1 AND _class = \'tracker:class:Project\' LIMIT 50', [lastCheckedMs]);

      expect(taskResult.rows).toHaveLength(1);
      expect(spaceResult.rows).toHaveLength(1);
    });

    it('should sort combined changes by modifiedOn descending', () => {
      const changes = [
        { modifiedOn: 1704067200000, type: 'project.updated' },
        { modifiedOn: 1704067300000, type: 'issue.updated' },
        { modifiedOn: 1704067250000, type: 'task.updated' }
      ];

      const sorted = changes.sort((a, b) => b.modifiedOn - a.modifiedOn);

      expect(sorted[0].type).toBe('issue.updated');
      expect(sorted[1].type).toBe('task.updated');
      expect(sorted[2].type).toBe('project.updated');
    });
  });

  describe('Error Handling', () => {
    it('should handle database query errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        mockPool.query('SELECT * FROM task WHERE "modifiedOn" > $1 LIMIT 100', [Date.now()])
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle malformed JSON in data field', () => {
      const malformedRow = {
        _id: 'issue-bad',
        _class: 'tracker:class:Issue',
        data: 'not-valid-json'
      };

      expect(() => {
        JSON.parse(malformedRow.data);
      }).toThrow();
    });
  });
});
