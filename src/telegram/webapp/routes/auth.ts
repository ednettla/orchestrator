/**
 * Auth API Routes
 *
 * Endpoints for managing auth sources, errors, and paused pipelines.
 * Auth sources require admin role; errors and pipelines require operator.
 *
 * @module webapp/routes/auth
 */

import { Router, type Response } from 'express';
import { type AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { getGlobalStore } from '../../../core/global-store.js';
import type {
  AuthSource,
  AuthError,
  PausedPipeline,
  AuthService,
  AuthResolutionMethod,
} from '../../../core/auth-types.js';

// ============================================================================
// Router Factory
// ============================================================================

export function createAuthRouter(): Router {
  const router = Router();

  // --------------------------------------------------------------------------
  // Auth Sources (admin only)
  // --------------------------------------------------------------------------

  /**
   * List all auth sources
   */
  router.get('/sources', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const store = getGlobalStore();
      const { service } = req.query as { service?: AuthService };

      const sources = store.listAuthSources(service);

      res.json({
        success: true,
        sources: sources.map((s: AuthSource) => ({
          id: s.id,
          name: s.name,
          service: s.service,
          displayName: s.displayName,
          authType: s.authType,
          isDefault: s.isDefault,
          lastVerifiedAt: s.lastVerifiedAt?.toISOString() ?? null,
          expiresAt: s.expiresAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[API] Error listing auth sources:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list auth sources' },
      });
    }
  });

  /**
   * Get a specific auth source
   */
  router.get('/sources/:name', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const name = req.params.name as string;
      const store = getGlobalStore();

      const source = store.getAuthSource(name);

      if (!source) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Auth source not found' },
        });
        return;
      }

      res.json({
        success: true,
        source: {
          id: source.id,
          name: source.name,
          service: source.service,
          displayName: source.displayName,
          authType: source.authType,
          isDefault: source.isDefault,
          lastVerifiedAt: source.lastVerifiedAt?.toISOString() ?? null,
          expiresAt: source.expiresAt?.toISOString() ?? null,
          createdAt: source.createdAt.toISOString(),
          updatedAt: source.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      console.error('[API] Error getting auth source:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get auth source' },
      });
    }
  });

  /**
   * Update auth source settings (not credentials)
   */
  router.put('/sources/:name', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const name = req.params.name as string;
      const { displayName, isDefault } = req.body as {
        displayName?: string;
        isDefault?: boolean;
      };

      const store = getGlobalStore();

      const updated = store.updateAuthSource(name, { displayName, isDefault });

      if (!updated) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Auth source not found' },
        });
        return;
      }

      res.json({
        success: true,
        source: {
          id: updated.id,
          name: updated.name,
          service: updated.service,
          displayName: updated.displayName,
          authType: updated.authType,
          isDefault: updated.isDefault,
          lastVerifiedAt: updated.lastVerifiedAt?.toISOString() ?? null,
          expiresAt: updated.expiresAt?.toISOString() ?? null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      console.error('[API] Error updating auth source:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update auth source' },
      });
    }
  });

  /**
   * Set an auth source as default for its service
   */
  router.post('/sources/:name/set-default', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const name = req.params.name as string;
      const store = getGlobalStore();

      const success = store.setDefaultAuthSource(name);

      if (!success) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Auth source not found' },
        });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error setting default auth source:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to set default auth source' },
      });
    }
  });

  /**
   * Delete an auth source
   */
  router.delete('/sources/:name', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const name = req.params.name as string;
      const store = getGlobalStore();

      const success = store.deleteAuthSource(name);

      if (!success) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Auth source not found' },
        });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error deleting auth source:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete auth source' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Auth Errors (operator+)
  // --------------------------------------------------------------------------

  /**
   * Get unresolved auth errors for a project
   */
  router.get('/errors', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectPath, includeResolved, limit } = req.query as {
        projectPath?: string;
        includeResolved?: string;
        limit?: string;
      };

      if (!projectPath) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PROJECT', message: 'projectPath query parameter is required' },
        });
        return;
      }

      const store = getGlobalStore();

      let errors: AuthError[];
      if (includeResolved === 'true') {
        errors = store.getRecentAuthErrors(projectPath, parseInt(limit ?? '20', 10));
      } else {
        errors = store.getUnresolvedAuthErrors(projectPath);
      }

      res.json({
        success: true,
        errors: errors.map((e: AuthError) => ({
          id: e.id,
          projectPath: e.projectPath,
          service: e.service,
          errorType: e.errorType,
          errorMessage: e.errorMessage,
          pipelineJobId: e.pipelineJobId,
          occurredAt: e.occurredAt.toISOString(),
          resolvedAt: e.resolvedAt?.toISOString() ?? null,
          resolutionMethod: e.resolutionMethod,
        })),
      });
    } catch (error) {
      console.error('[API] Error listing auth errors:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list auth errors' },
      });
    }
  });

  /**
   * Resolve an auth error
   */
  router.post('/errors/:errorId/resolve', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const errorId = req.params.errorId as string;
      const { method } = req.body as { method: AuthResolutionMethod };

      const validMethods: AuthResolutionMethod[] = ['reauth', 'retry', 'manual', 'cancelled'];
      if (!method || !validMethods.includes(method)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_METHOD', message: `Method must be one of: ${validMethods.join(', ')}` },
        });
        return;
      }

      const store = getGlobalStore();
      const success = store.resolveAuthError(errorId, method);

      if (!success) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Auth error not found or already resolved' },
        });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error resolving auth error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve auth error' },
      });
    }
  });

  /**
   * Resolve all errors for a service in a project
   */
  router.post('/errors/resolve-all', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectPath, service, method } = req.body as {
        projectPath: string;
        service: AuthService;
        method: AuthResolutionMethod;
      };

      if (!projectPath || !service || !method) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'projectPath, service, and method are required' },
        });
        return;
      }

      const store = getGlobalStore();
      const count = store.resolveAuthErrorsForService(projectPath, service, method);

      res.json({
        success: true,
        resolvedCount: count,
      });
    } catch (error) {
      console.error('[API] Error resolving auth errors:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve auth errors' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Paused Pipelines (operator+)
  // --------------------------------------------------------------------------

  /**
   * List paused pipelines
   */
  router.get('/pipelines/paused', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status } = req.query as { status?: 'paused' | 'resumed' | 'cancelled' };

      const store = getGlobalStore();
      const pipelines = store.listPausedPipelines(status);

      res.json({
        success: true,
        pipelines: pipelines.map((p: PausedPipeline) => ({
          id: p.id,
          projectPath: p.projectPath,
          jobId: p.jobId,
          requirementId: p.requirementId,
          pausedPhase: p.pausedPhase,
          service: p.service,
          errorId: p.errorId,
          pausedAt: p.pausedAt.toISOString(),
          resumedAt: p.resumedAt?.toISOString() ?? null,
          status: p.status,
        })),
      });
    } catch (error) {
      console.error('[API] Error listing paused pipelines:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list paused pipelines' },
      });
    }
  });

  /**
   * Get a specific paused pipeline
   */
  router.get('/pipelines/paused/:pipelineId', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const pipelineId = req.params.pipelineId as string;

      const store = getGlobalStore();
      const pipeline = store.getPausedPipeline(pipelineId);

      if (!pipeline) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Paused pipeline not found' },
        });
        return;
      }

      res.json({
        success: true,
        pipeline: {
          id: pipeline.id,
          projectPath: pipeline.projectPath,
          jobId: pipeline.jobId,
          requirementId: pipeline.requirementId,
          pausedPhase: pipeline.pausedPhase,
          service: pipeline.service,
          errorId: pipeline.errorId,
          pausedAt: pipeline.pausedAt.toISOString(),
          resumedAt: pipeline.resumedAt?.toISOString() ?? null,
          status: pipeline.status,
        },
      });
    } catch (error) {
      console.error('[API] Error getting paused pipeline:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get paused pipeline' },
      });
    }
  });

  /**
   * Resume a paused pipeline
   */
  router.post('/pipelines/paused/:pipelineId/resume', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const pipelineId = req.params.pipelineId as string;

      const store = getGlobalStore();
      const success = store.resumePipeline(pipelineId);

      if (!success) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Paused pipeline not found or already resumed' },
        });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error resuming pipeline:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to resume pipeline' },
      });
    }
  });

  /**
   * Cancel a paused pipeline
   */
  router.post('/pipelines/paused/:pipelineId/cancel', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const pipelineId = req.params.pipelineId as string;

      const store = getGlobalStore();
      const success = store.cancelPipeline(pipelineId);

      if (!success) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Paused pipeline not found or already handled' },
        });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error cancelling pipeline:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel pipeline' },
      });
    }
  });

  /**
   * Resume all paused pipelines for a service
   */
  router.post('/pipelines/resume-by-service', requireRole('operator'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const { service } = req.body as { service: AuthService };

      if (!service) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_SERVICE', message: 'service is required' },
        });
        return;
      }

      const store = getGlobalStore();
      const count = store.resumePipelinesForService(service);

      res.json({
        success: true,
        resumedCount: count,
      });
    } catch (error) {
      console.error('[API] Error resuming pipelines by service:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to resume pipelines' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Auth Status Summary
  // --------------------------------------------------------------------------

  /**
   * Get auth status summary for display
   */
  router.get('/status', requireRole('viewer'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const store = getGlobalStore();

      const services: AuthService[] = ['github', 'supabase', 'vercel'];
      const status = services.map((service) => {
        const defaultSource = store.getDefaultAuthSource(service);

        if (!defaultSource) {
          return {
            service,
            sourceName: null,
            status: 'not_configured' as const,
            lastChecked: null,
            expiresAt: null,
          };
        }

        let statusValue: 'ok' | 'expired' | 'invalid' | 'not_configured' = 'ok';
        if (defaultSource.expiresAt && defaultSource.expiresAt < new Date()) {
          statusValue = 'expired';
        }

        return {
          service,
          sourceName: defaultSource.name,
          displayName: defaultSource.displayName,
          status: statusValue,
          lastChecked: defaultSource.lastVerifiedAt?.toISOString() ?? null,
          expiresAt: defaultSource.expiresAt?.toISOString() ?? null,
        };
      });

      // Get counts
      const pausedPipelines = store.listPausedPipelines('paused');

      res.json({
        success: true,
        authStatus: status,
        summary: {
          totalSources: store.listAuthSources().length,
          pausedPipelines: pausedPipelines.length,
          serviceStatus: {
            github: status.find(s => s.service === 'github')?.status ?? 'not_configured',
            supabase: status.find(s => s.service === 'supabase')?.status ?? 'not_configured',
            vercel: status.find(s => s.service === 'vercel')?.status ?? 'not_configured',
          },
        },
      });
    } catch (error) {
      console.error('[API] Error getting auth status:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get auth status' },
      });
    }
  });

  return router;
}
