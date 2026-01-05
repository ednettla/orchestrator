/**
 * Projects API Routes
 *
 * @module webapp/routes/projects
 */

import { Router, type Response } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { type AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { getProjectRegistry, type RegisteredProject } from '../../../core/project-registry.js';
import { getAllowedPathsManager } from '../../../core/allowed-paths.js';
import { createRequirementsRouter } from './requirements.js';
import { createPlansRouter } from './plans.js';
import { createDashboardRouter } from './dashboard.js';

// ============================================================================
// Router Factory
// ============================================================================

export function createProjectsRouter(): Router {
  const router = Router();
  const registry = getProjectRegistry();

  // --------------------------------------------------------------------------
  // List Projects
  // --------------------------------------------------------------------------

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status = 'active', limit = '50' } = req.query as { status?: string; limit?: string };

      const statusFilter = status === 'all' ? 'all' : (status as 'active' | 'archived');

      // Debug: Clear cache to ensure fresh data
      registry.clearCache();

      const projects = registry.listProjects({
        status: statusFilter,
        limit: parseInt(limit, 10),
        sortBy: 'lastAccessed',
      });

      console.log(`[API] /projects: Found ${projects.length} projects (status=${statusFilter})`);

      res.json({
        success: true,
        projects: projects.map((p: RegisteredProject) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          alias: p.alias,
          status: p.status,
          techStack: p.techStack,
          cloudServices: p.cloudServices,
          lastAccessedAt: p.lastAccessedAt.toISOString(),
          createdAt: p.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[API] Error listing projects:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list projects' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Get Single Project
  // --------------------------------------------------------------------------

  router.get('/:projectId', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;

      // Look up by ID first, then fall back to path/name/alias
      const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);

      if (!project) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      // Touch project to update last accessed
      registry.touchProject(project.path);

      // Get additional status info
      const orchestratorDir = path.join(project.path, '.orchestrator');
      const hasOrchestrator = existsSync(orchestratorDir);

      res.json({
        success: true,
        project: {
          id: project.id,
          name: project.name,
          path: project.path,
          alias: project.alias,
          status: project.status,
          techStack: project.techStack,
          cloudServices: project.cloudServices,
          lastAccessedAt: project.lastAccessedAt.toISOString(),
          createdAt: project.createdAt.toISOString(),
          initialized: hasOrchestrator,
        },
      });
    } catch (error) {
      console.error('[API] Error getting project:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get project' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Initialize Project (Admin only)
  // --------------------------------------------------------------------------

  router.post(
    '/init',
    requireRole('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { path: projectPath, name, techStack } = req.body as {
          path: string;
          name?: string;
          techStack?: Record<string, string>;
        };

        if (!projectPath) {
          res.status(400).json({
            success: false,
            error: { code: 'MISSING_PATH', message: 'Project path is required' },
          });
          return;
        }

        // Validate against allowed paths
        const pathsManager = getAllowedPathsManager();
        const validationError = pathsManager.validateForInit(projectPath);

        if (validationError) {
          res.status(403).json({
            success: false,
            error: { code: 'PATH_NOT_ALLOWED', message: validationError },
          });
          return;
        }

        // Import init command dynamically to avoid circular dependencies
        const { initProjectFromApi } = await import('../../project-bridge.js');

        const initOptions: { path: string; name?: string; techStack?: Record<string, string> } = {
          path: projectPath,
        };
        if (name) initOptions.name = name;
        if (techStack) initOptions.techStack = techStack;

        const result = await initProjectFromApi(initOptions);

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: { code: 'INIT_FAILED', message: result.error ?? 'Initialization failed' },
          });
          return;
        }

        res.json({
          success: true,
          project: result.project,
        });
      } catch (error) {
        console.error('[API] Error initializing project:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to initialize project' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Update Project
  // --------------------------------------------------------------------------

  router.put(
    '/:projectId',
    requireRole('operator'),
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const { alias } = req.body as { alias?: string };

        const project = registry.getProject(projectId);
        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        if (alias !== undefined) {
          registry.setAlias(project.path, alias || null);
        }

        const updated = registry.getProject(project.path);

        res.json({
          success: true,
          project: {
            id: updated!.id,
            name: updated!.name,
            path: updated!.path,
            alias: updated!.alias,
            status: updated!.status,
          },
        });
      } catch (error) {
        console.error('[API] Error updating project:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update project' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Archive/Unarchive Project
  // --------------------------------------------------------------------------

  router.post(
    '/:projectId/archive',
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;

        const project = registry.getProject(projectId);
        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        registry.archiveProject(project.path);

        res.json({ success: true });
      } catch (error) {
        console.error('[API] Error archiving project:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to archive project' },
        });
      }
    }
  );

  router.post(
    '/:projectId/unarchive',
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;

        const project = registry.getProject(projectId);
        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        registry.unarchiveProject(project.path);

        res.json({ success: true });
      } catch (error) {
        console.error('[API] Error unarchiving project:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to unarchive project' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Delete Project from Registry
  // --------------------------------------------------------------------------

  router.delete(
    '/:projectId',
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;

        const project = registry.getProject(projectId);
        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        registry.unregisterProject(project.path);

        res.json({ success: true });
      } catch (error) {
        console.error('[API] Error deleting project:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to delete project' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Nested Routes
  // --------------------------------------------------------------------------

  // Mount requirements, plans, dashboard under /:projectId
  router.use('/:projectId/requirements', createRequirementsRouter());
  router.use('/:projectId/plans', createPlansRouter());
  router.use('/:projectId/dashboard', createDashboardRouter());

  return router;
}
