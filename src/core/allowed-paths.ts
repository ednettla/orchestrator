/**
 * Allowed Paths Manager
 *
 * Manages pre-registered project directories for remote initialization.
 * Only paths registered by admins can be used to create new projects via Telegram.
 *
 * @module allowed-paths
 */

import { existsSync, accessSync, constants } from 'node:fs';
import path from 'node:path';
import { getGlobalStore } from './global-store.js';

// ============================================================================
// Types
// ============================================================================

export interface AllowedPath {
  id: string;
  path: string;
  description: string | null;
  addedBy: number; // telegram_id
  createdAt: Date;
}

// ============================================================================
// Allowed Paths Manager
// ============================================================================

export class AllowedPathsManager {
  /**
   * Add a new allowed path for project initialization
   */
  addPath(
    pathStr: string,
    addedBy: number,
    description?: string
  ): AllowedPath {
    const store = getGlobalStore();
    const normalizedPath = path.resolve(pathStr);

    // Validate the path exists and is accessible
    if (!existsSync(normalizedPath)) {
      throw new Error(`Path does not exist: ${normalizedPath}`);
    }

    try {
      accessSync(normalizedPath, constants.R_OK | constants.W_OK);
    } catch {
      throw new Error(`Path is not readable/writable: ${normalizedPath}`);
    }

    return store.addAllowedPath(normalizedPath, addedBy, description);
  }

  /**
   * Remove an allowed path
   */
  removePath(pathId: string): boolean {
    const store = getGlobalStore();
    return store.removeAllowedPath(pathId);
  }

  /**
   * Remove an allowed path by its path string
   */
  removePathByPath(pathStr: string): boolean {
    const store = getGlobalStore();
    const normalizedPath = path.resolve(pathStr);
    return store.removeAllowedPathByPath(normalizedPath);
  }

  /**
   * List all allowed paths
   */
  listPaths(): AllowedPath[] {
    const store = getGlobalStore();
    return store.listAllowedPaths();
  }

  /**
   * Check if a path is allowed for project initialization
   * Supports both exact matches and subdirectory matches
   */
  isAllowed(pathStr: string): boolean {
    const store = getGlobalStore();
    const normalizedPath = path.resolve(pathStr);
    const allowedPaths = store.listAllowedPaths();

    for (const allowed of allowedPaths) {
      // Exact match
      if (normalizedPath === allowed.path) {
        return true;
      }

      // Subdirectory match: path is under an allowed directory
      const relative = path.relative(allowed.path, normalizedPath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the allowed parent path for a given path
   * Returns the most specific (deepest) allowed path that contains the target
   */
  getAllowedParent(pathStr: string): AllowedPath | null {
    const store = getGlobalStore();
    const normalizedPath = path.resolve(pathStr);
    const allowedPaths = store.listAllowedPaths();

    let bestMatch: AllowedPath | null = null;
    let bestMatchDepth = -1;

    for (const allowed of allowedPaths) {
      // Exact match
      if (normalizedPath === allowed.path) {
        return allowed;
      }

      // Subdirectory match
      const relative = path.relative(allowed.path, normalizedPath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        const depth = allowed.path.split(path.sep).length;
        if (depth > bestMatchDepth) {
          bestMatch = allowed;
          bestMatchDepth = depth;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Get an allowed path by ID
   */
  getPath(pathId: string): AllowedPath | null {
    const store = getGlobalStore();
    return store.getAllowedPath(pathId);
  }

  /**
   * Get an allowed path by its path string
   */
  getPathByPath(pathStr: string): AllowedPath | null {
    const store = getGlobalStore();
    const normalizedPath = path.resolve(pathStr);
    return store.getAllowedPathByPath(normalizedPath);
  }

  /**
   * Validate a path for project initialization
   * Returns an error message if invalid, null if valid
   */
  validateForInit(pathStr: string): string | null {
    const normalizedPath = path.resolve(pathStr);

    // Check if path is allowed
    if (!this.isAllowed(normalizedPath)) {
      return `Path is not in allowed directories. Use '/paths' to see allowed paths.`;
    }

    // Check if path exists
    if (!existsSync(normalizedPath)) {
      return `Path does not exist: ${normalizedPath}`;
    }

    // Check if path is writable
    try {
      accessSync(normalizedPath, constants.R_OK | constants.W_OK);
    } catch {
      return `Path is not readable/writable: ${normalizedPath}`;
    }

    // Check if already has .orchestrator (already initialized)
    const orchestratorDir = path.join(normalizedPath, '.orchestrator');
    if (existsSync(orchestratorDir)) {
      return `Project already initialized at: ${normalizedPath}`;
    }

    return null;
  }
}

// ============================================================================
// Singleton & Exports
// ============================================================================

let instance: AllowedPathsManager | null = null;

export function getAllowedPathsManager(): AllowedPathsManager {
  if (!instance) {
    instance = new AllowedPathsManager();
  }
  return instance;
}
