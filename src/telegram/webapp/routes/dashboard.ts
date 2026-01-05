/**
 * Dashboard API Routes
 *
 * Project dashboard with stats, activity, and status information.
 *
 * @module webapp/routes/dashboard
 */

import { Router, type Response } from 'express';
import { type AuthenticatedRequest } from '../middleware/auth.js';
import { getProjectRegistry } from '../../../core/project-registry.js';
import { createStore } from '../../../state/store.js';
import type { Requirement, Task, ClarifyingQuestion } from '../../../core/types.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
  requirements: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };
  tasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  execution: {
    isRunning: boolean;
    currentPhase: string | null;
    startedAt: string | null;
    estimatedCompletion: string | null;
  };
}

interface ActivityItem {
  id: string;
  type: 'requirement' | 'task' | 'plan' | 'execution';
  action: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Router Factory
// ============================================================================

export function createDashboardRouter(): Router {
  const router = Router({ mergeParams: true }); // mergeParams to access :projectId

  // Helper to get project store
  const getProjectStore = (projectId: string) => {
    const registry = getProjectRegistry();
    // Try UUID lookup first, then fall back to name/alias
    const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);
    if (!project) return null;
    return { store: createStore(project.path), project };
  };

  // --------------------------------------------------------------------------
  // Get Dashboard Overview
  // --------------------------------------------------------------------------

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;

      const context = getProjectStore(projectId);
      if (!context) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const { store, project } = context;

      // Get session
      const session = store.getSessionByPath(project.path);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Project not initialized' },
        });
        store.close();
        return;
      }

      // Get requirements stats
      const requirements = store.getRequirementsBySession(session.id);
      const requirementStats = {
        total: requirements.length,
        pending: requirements.filter((r: Requirement) => r.status === 'pending').length,
        inProgress: requirements.filter((r: Requirement) => r.status === 'in_progress').length,
        completed: requirements.filter((r: Requirement) => r.status === 'completed').length,
        failed: requirements.filter((r: Requirement) => r.status === 'failed').length,
      };

      // Get tasks stats (aggregate across all requirements)
      let allTasks: Array<{ status: string; startedAt: Date | null }> = [];
      for (const req of requirements) {
        const tasks = store.getTasksByRequirement(req.id);
        allTasks = allTasks.concat(tasks);
      }

      const taskStats = {
        total: allTasks.length,
        pending: allTasks.filter((t) => t.status === 'pending').length,
        running: allTasks.filter((t) => t.status === 'running').length,
        completed: allTasks.filter((t) => t.status === 'completed').length,
        failed: allTasks.filter((t) => t.status === 'failed').length,
      };

      // Get plan status (needed for phase calculation)
      const activePlan = store.getActivePlan(session.id);

      // Check execution status and determine current phase
      const runningTasks = allTasks.filter((t) => t.status === 'running');
      const firstRunningTask = runningTasks[0];

      // Determine actual phase based on state
      let currentPhase: string | null = null;
      if (runningTasks.length > 0) {
        currentPhase = 'coding';
      } else if (activePlan?.status === 'pending_approval') {
        currentPhase = 'planning';
      } else if (requirementStats.pending > 0 || requirementStats.inProgress > 0) {
        currentPhase = 'pending';
      } else if (requirementStats.failed > 0) {
        currentPhase = 'failed';
      } else if (requirementStats.completed > 0 && requirementStats.pending === 0) {
        currentPhase = 'completed';
      }

      const executionStats = {
        isRunning: runningTasks.length > 0,
        currentPhase,
        startedAt: firstRunningTask?.startedAt?.toISOString() ?? null,
        estimatedCompletion: null as string | null,
      };

      // Plan status for response
      const planStatus = activePlan?.status ?? 'none';
      const hasPendingQuestions = (activePlan?.questions ?? []).some(
        (q: ClarifyingQuestion) => !q.answer
      );

      // Check for worktrees
      const worktreeDir = path.join(project.path, '.git', 'worktrees');
      const hasActiveWorktrees = existsSync(worktreeDir);

      store.close();

      const stats: DashboardStats = {
        requirements: requirementStats,
        tasks: taskStats,
        execution: executionStats,
      };

      res.json({
        success: true,
        dashboard: {
          project: {
            id: project.id,
            name: project.name,
            path: project.path,
            status: project.status,
          },
          stats,
          plan: {
            status: planStatus,
            hasPendingQuestions,
          },
          worktrees: {
            hasActive: hasActiveWorktrees,
          },
          lastUpdated: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[API] Error getting dashboard:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get dashboard' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Get Activity Feed
  // --------------------------------------------------------------------------

  router.get('/activity', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;
      const { limit = '20', offset = '0' } = req.query as { limit?: string; offset?: string };

      const context = getProjectStore(projectId);
      if (!context) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const { store, project } = context;

      // Get session
      const session = store.getSessionByPath(project.path);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Project not initialized' },
        });
        store.close();
        return;
      }

      // Build activity feed from requirements and tasks
      const activity: ActivityItem[] = [];

      // Get requirements
      const requirements = store.getRequirementsBySession(session.id);
      for (const req of requirements) {
        activity.push({
          id: `req-created-${req.id}`,
          type: 'requirement',
          action: 'created',
          description: `Requirement added: ${req.rawInput.slice(0, 50)}${req.rawInput.length > 50 ? '...' : ''}`,
          timestamp: req.createdAt.toISOString(),
          metadata: { requirementId: req.id },
        });

        if (req.status === 'completed') {
          activity.push({
            id: `req-completed-${req.id}`,
            type: 'requirement',
            action: 'completed',
            description: `Requirement completed: ${req.rawInput.slice(0, 50)}${req.rawInput.length > 50 ? '...' : ''}`,
            timestamp: req.updatedAt.toISOString(),
            metadata: { requirementId: req.id },
          });
        }

        // Get tasks for this requirement
        const tasks = store.getTasksByRequirement(req.id);
        for (const task of tasks) {
          if (task.startedAt) {
            activity.push({
              id: `task-started-${task.id}`,
              type: 'task',
              action: 'started',
              description: `${task.agentType} agent started for requirement`,
              timestamp: task.startedAt.toISOString(),
              metadata: { taskId: task.id, agentType: task.agentType },
            });
          }

          if (task.completedAt) {
            activity.push({
              id: `task-completed-${task.id}`,
              type: 'task',
              action: task.status === 'completed' ? 'completed' : 'failed',
              description: `${task.agentType} agent ${task.status}`,
              timestamp: task.completedAt.toISOString(),
              metadata: { taskId: task.id, agentType: task.agentType, status: task.status },
            });
          }
        }
      }

      // Sort by timestamp descending
      activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply pagination
      const limitNum = parseInt(limit, 10);
      const offsetNum = parseInt(offset, 10);
      const paginatedActivity = activity.slice(offsetNum, offsetNum + limitNum);

      store.close();

      res.json({
        success: true,
        activity: paginatedActivity,
        pagination: {
          total: activity.length,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < activity.length,
        },
      });
    } catch (error) {
      console.error('[API] Error getting activity:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get activity' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Get Execution Logs
  // --------------------------------------------------------------------------

  router.get('/logs', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;
      const { lines = '100', taskId } = req.query as { lines?: string; taskId?: string };

      const context = getProjectStore(projectId);
      if (!context) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const { store, project } = context;

      // Get session
      const session = store.getSessionByPath(project.path);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Project not initialized' },
        });
        store.close();
        return;
      }

      // Get log entries
      const linesNum = Math.min(parseInt(lines, 10), 500);
      let logs: Array<{ timestamp: string; level: string; message: string; taskId?: string }> = [];

      // If taskId is specified, get logs for that task
      if (taskId) {
        const task = store.getTask(taskId);
        if (task) {
          // Get task output if available
          // Note: This would need the task execution log which may be stored differently
          logs.push({
            timestamp: task.startedAt?.toISOString() ?? new Date().toISOString(),
            level: 'info',
            message: `Task ${task.agentType} - Status: ${task.status}`,
            taskId: task.id,
          });
        }
      } else {
        // Get general session logs
        // This is a simplified version - actual logs would come from a log store
        const requirements = store.getRequirementsBySession(session.id);
        for (const req of requirements) {
          const tasks = store.getTasksByRequirement(req.id);
          for (const task of tasks) {
            if (task.startedAt) {
              logs.push({
                timestamp: task.startedAt.toISOString(),
                level: 'info',
                message: `[${task.agentType}] Started`,
                taskId: task.id,
              });
            }
            if (task.completedAt) {
              logs.push({
                timestamp: task.completedAt.toISOString(),
                level: task.status === 'completed' ? 'info' : 'error',
                message: `[${task.agentType}] ${task.status === 'completed' ? 'Completed' : 'Failed'}`,
                taskId: task.id,
              });
            }
          }
        }
      }

      // Sort by timestamp descending and limit
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      logs = logs.slice(0, linesNum);

      store.close();

      res.json({
        success: true,
        logs,
        hasMore: false, // Simplified - would need proper pagination
      });
    } catch (error) {
      console.error('[API] Error getting logs:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get logs' },
      });
    }
  });

  return router;
}
