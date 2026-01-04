/**
 * Admin API Routes
 *
 * Administrative endpoints for managing allowed paths, users, and webapp config.
 * Requires admin role for all operations.
 *
 * @module webapp/routes/admin
 */

import { Router, type Response } from 'express';
import { type AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { getAllowedPathsManager, type AllowedPath } from '../../../core/allowed-paths.js';
import { getGlobalStore, type AuthorizedUser } from '../../../core/global-store.js';

// ============================================================================
// Router Factory
// ============================================================================

export function createAdminRouter(): Router {
  const router = Router();

  // All admin routes require admin role
  router.use(requireRole('admin'));

  // --------------------------------------------------------------------------
  // Allowed Paths Management
  // --------------------------------------------------------------------------

  /**
   * List all allowed paths
   */
  router.get('/allowed-paths', (req: AuthenticatedRequest, res: Response) => {
    try {
      const manager = getAllowedPathsManager();
      const paths = manager.listPaths();

      res.json({
        success: true,
        paths: paths.map((p: AllowedPath) => ({
          id: p.id,
          path: p.path,
          description: p.description,
          addedBy: p.addedBy,
          createdAt: p.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[API] Error listing allowed paths:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list allowed paths' },
      });
    }
  });

  /**
   * Add a new allowed path
   */
  router.post('/allowed-paths', (req: AuthenticatedRequest, res: Response) => {
    try {
      const { path: pathStr, description } = req.body as {
        path: string;
        description?: string;
      };

      if (!pathStr?.trim()) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PATH', message: 'Path is required' },
        });
        return;
      }

      const manager = getAllowedPathsManager();

      // Check if path already exists
      const existing = manager.listPaths().find((p: AllowedPath) => p.path === pathStr);
      if (existing) {
        res.status(409).json({
          success: false,
          error: { code: 'PATH_EXISTS', message: 'Path is already registered' },
        });
        return;
      }

      const newPath = manager.addPath(pathStr, req.user!.telegramId, description);

      res.status(201).json({
        success: true,
        path: {
          id: newPath.id,
          path: newPath.path,
          description: newPath.description,
          addedBy: newPath.addedBy,
          createdAt: newPath.createdAt.toISOString(),
        },
      });
    } catch (error) {
      console.error('[API] Error adding allowed path:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to add allowed path' },
      });
    }
  });

  /**
   * Remove an allowed path
   */
  router.delete('/allowed-paths/:pathId', (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathId = req.params.pathId as string;

      const manager = getAllowedPathsManager();
      const removed = manager.removePath(pathId);

      if (!removed) {
        res.status(404).json({
          success: false,
          error: { code: 'PATH_NOT_FOUND', message: 'Allowed path not found' },
        });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error removing allowed path:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to remove allowed path' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // User Management
  // --------------------------------------------------------------------------

  /**
   * List all authorized users
   */
  router.get('/users', (req: AuthenticatedRequest, res: Response) => {
    try {
      const store = getGlobalStore();
      const users = store.listUsers();

      res.json({
        success: true,
        users: users.map((u: AuthorizedUser) => ({
          id: u.id,
          telegramId: u.telegramId,
          displayName: u.displayName,
          role: u.role,
          lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
          authorizedAt: u.authorizedAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[API] Error listing users:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list users' },
      });
    }
  });

  /**
   * Update user role
   */
  router.put('/users/:userId/role', (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { role } = req.body as { role: 'viewer' | 'operator' | 'admin' };

      const validRoles = ['viewer', 'operator', 'admin'];
      if (!role || !validRoles.includes(role)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_ROLE', message: `Role must be one of: ${validRoles.join(', ')}` },
        });
        return;
      }

      const store = getGlobalStore();

      // Find user by ID
      const users = store.listUsers();
      const user = users.find((u: AuthorizedUser) => u.id === userId);

      if (!user) {
        res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
        return;
      }

      // Update role
      store.updateUser(user.telegramId, { role });

      // Get updated user
      const updated = store.getUser(user.telegramId);

      res.json({
        success: true,
        user: {
          id: updated!.id,
          telegramId: updated!.telegramId,
          displayName: updated!.displayName,
          role: updated!.role,
        },
      });
    } catch (error) {
      console.error('[API] Error updating user role:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update user role' },
      });
    }
  });

  /**
   * Remove user
   */
  router.delete('/users/:userId', (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;

      const store = getGlobalStore();

      // Find user by ID
      const users = store.listUsers();
      const user = users.find((u: AuthorizedUser) => u.id === userId);

      if (!user) {
        res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
        return;
      }

      // Don't allow removing self
      if (user.telegramId === req.user!.telegramId) {
        res.status(400).json({
          success: false,
          error: { code: 'CANNOT_REMOVE_SELF', message: 'Cannot remove your own account' },
        });
        return;
      }

      store.removeUser(user.telegramId);

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error removing user:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to remove user' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // WebApp Configuration
  // --------------------------------------------------------------------------

  /**
   * Get webapp configuration
   */
  router.get('/config/webapp', (req: AuthenticatedRequest, res: Response) => {
    try {
      const store = getGlobalStore();
      const config = store.getWebAppConfig();

      res.json({
        success: true,
        config: {
          enabled: config.enabled,
          port: config.port,
          baseUrl: config.baseUrl,
        },
      });
    } catch (error) {
      console.error('[API] Error getting webapp config:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get webapp config' },
      });
    }
  });

  /**
   * Update webapp configuration
   */
  router.put('/config/webapp', (req: AuthenticatedRequest, res: Response) => {
    try {
      const { enabled, port, baseUrl } = req.body as {
        enabled?: boolean;
        port?: number;
        baseUrl?: string;
      };

      const store = getGlobalStore();

      if (enabled !== undefined) {
        store.setWebAppEnabled(enabled);
      }

      if (port !== undefined) {
        if (port < 1 || port > 65535) {
          res.status(400).json({
            success: false,
            error: { code: 'INVALID_PORT', message: 'Port must be between 1 and 65535' },
          });
          return;
        }
        store.setWebAppPort(port);
      }

      if (baseUrl !== undefined) {
        store.setWebAppBaseUrl(baseUrl || null);
      }

      const updatedConfig = store.getWebAppConfig();

      res.json({
        success: true,
        config: {
          enabled: updatedConfig.enabled,
          port: updatedConfig.port,
          baseUrl: updatedConfig.baseUrl,
        },
        message: 'Configuration updated. Restart daemon for changes to take effect.',
      });
    } catch (error) {
      console.error('[API] Error updating webapp config:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update webapp config' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // System Status
  // --------------------------------------------------------------------------

  /**
   * Get system status
   */
  router.get('/status', (req: AuthenticatedRequest, res: Response) => {
    try {
      const store = getGlobalStore();
      const config = store.getConfig();
      const users = store.listUsers();
      const pathsManager = getAllowedPathsManager();
      const paths = pathsManager.listPaths();

      res.json({
        success: true,
        status: {
          daemon: {
            running: true,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
          },
          bot: {
            configured: !!config.botToken,
            username: config.botToken ? 'configured' : null,
          },
          webapp: store.getWebAppConfig(),
          users: {
            total: users.length,
            admins: users.filter((u: AuthorizedUser) => u.role === 'admin').length,
            operators: users.filter((u: AuthorizedUser) => u.role === 'operator').length,
            viewers: users.filter((u: AuthorizedUser) => u.role === 'viewer').length,
          },
          allowedPaths: {
            total: paths.length,
          },
        },
      });
    } catch (error) {
      console.error('[API] Error getting system status:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get system status' },
      });
    }
  });

  return router;
}
