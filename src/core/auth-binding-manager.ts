/**
 * Auth Binding Manager
 *
 * Manages project-level auth bindings that link projects to auth sources.
 * Provides credential resolution for a given project and service.
 *
 * @module auth-binding-manager
 */

import type { StateStore } from '../state/store.js';
import { getAuthSourceManager, type AuthSourceManager } from './auth-source-manager.js';
import type { MCPCredential } from './mcp-types.js';
import type {
  AuthService,
  AuthBinding,
  AuthCheckResult,
  AuthStatusSummary,
} from './auth-types.js';

// ============================================================================
// Auth Binding Manager
// ============================================================================

export class AuthBindingManager {
  private store: StateStore;
  private authSourceManager: AuthSourceManager;

  constructor(store: StateStore) {
    this.store = store;
    this.authSourceManager = getAuthSourceManager();
  }

  /**
   * Bind a service to an auth source for a session
   */
  bindService(sessionId: string, service: AuthService, authSourceName: string): AuthBinding {
    // Verify the auth source exists
    const authSource = this.authSourceManager.getAuthSource(authSourceName);
    if (!authSource) {
      throw new Error(`Auth source '${authSourceName}' not found`);
    }

    // Verify the auth source is for the correct service
    if (authSource.service !== service) {
      throw new Error(
        `Auth source '${authSourceName}' is for ${authSource.service}, not ${service}`
      );
    }

    return this.store.createAuthBinding({
      sessionId,
      service,
      authSourceName,
    });
  }

  /**
   * Unbind a service from a session
   */
  unbindService(sessionId: string, service: AuthService): boolean {
    return this.store.deleteAuthBinding(sessionId, service);
  }

  /**
   * Get the auth binding for a session and service
   */
  getBinding(sessionId: string, service: AuthService): AuthBinding | null {
    return this.store.getAuthBinding(sessionId, service);
  }

  /**
   * Get all auth bindings for a session
   */
  listBindings(sessionId: string): AuthBinding[] {
    return this.store.getAuthBindingsBySession(sessionId);
  }

  /**
   * Update the auth source binding for a session and service
   */
  updateBinding(
    sessionId: string,
    service: AuthService,
    authSourceName: string
  ): AuthBinding | null {
    // Verify the auth source exists and is for the correct service
    const authSource = this.authSourceManager.getAuthSource(authSourceName);
    if (!authSource) {
      throw new Error(`Auth source '${authSourceName}' not found`);
    }
    if (authSource.service !== service) {
      throw new Error(
        `Auth source '${authSourceName}' is for ${authSource.service}, not ${service}`
      );
    }

    return this.store.updateAuthBinding(sessionId, service, authSourceName);
  }

  /**
   * Resolve the credential for a session and service
   * Returns the credential from the bound auth source, or from the default if not bound
   */
  async resolveCredential(
    sessionId: string,
    service: AuthService
  ): Promise<MCPCredential | null> {
    // Check for explicit binding first
    const binding = this.store.getAuthBinding(sessionId, service);
    if (binding) {
      return this.authSourceManager.getCredentials(binding.authSourceName);
    }

    // Fall back to default auth source
    const defaultSource = this.authSourceManager.getDefaultAuthSource(service);
    if (defaultSource) {
      return this.authSourceManager.getCredentials(defaultSource.name);
    }

    return null;
  }

  /**
   * Resolve credentials for all services for a session
   */
  async resolveAllCredentials(
    sessionId: string
  ): Promise<Map<AuthService, MCPCredential | null>> {
    const services: AuthService[] = ['github', 'supabase', 'vercel'];
    const results = new Map<AuthService, MCPCredential | null>();

    for (const service of services) {
      const credential = await this.resolveCredential(sessionId, service);
      results.set(service, credential);
    }

    return results;
  }

  /**
   * Get the auth source name for a session and service
   */
  getAuthSourceName(sessionId: string, service: AuthService): string | null {
    const binding = this.store.getAuthBinding(sessionId, service);
    if (binding) {
      return binding.authSourceName;
    }

    const defaultSource = this.authSourceManager.getDefaultAuthSource(service);
    return defaultSource?.name ?? null;
  }

  /**
   * Check auth status for all services for a session
   */
  async checkAuthStatus(sessionId: string): Promise<AuthStatusSummary[]> {
    const services: AuthService[] = ['github', 'supabase', 'vercel'];
    const results: AuthStatusSummary[] = [];

    for (const service of services) {
      const sourceName = this.getAuthSourceName(sessionId, service);

      if (!sourceName) {
        results.push({
          service,
          sourceName: null,
          status: 'not_configured',
          lastChecked: null,
          expiresAt: null,
        });
        continue;
      }

      const authSource = this.authSourceManager.getAuthSource(sourceName);
      if (!authSource) {
        results.push({
          service,
          sourceName,
          status: 'not_configured',
          lastChecked: null,
          expiresAt: null,
          errorMessage: 'Auth source not found',
        });
        continue;
      }

      // Check if expired
      const now = new Date();
      if (authSource.expiresAt && authSource.expiresAt < now) {
        results.push({
          service,
          sourceName,
          status: 'expired',
          lastChecked: authSource.lastVerifiedAt,
          expiresAt: authSource.expiresAt,
          errorMessage: 'Token expired',
        });
        continue;
      }

      // Verify the auth source
      const checkResult = await this.authSourceManager.verifySource(sourceName);
      results.push({
        service,
        sourceName,
        status: checkResult.authenticated ? 'ok' : 'invalid',
        lastChecked: authSource.lastVerifiedAt,
        expiresAt: authSource.expiresAt,
        errorMessage: checkResult.error,
      });
    }

    return results;
  }

  /**
   * Check if a session has all required auth configured
   */
  hasRequiredAuth(sessionId: string, requiredServices: AuthService[]): boolean {
    for (const service of requiredServices) {
      const sourceName = this.getAuthSourceName(sessionId, service);
      if (!sourceName) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get services that are missing auth configuration
   */
  getMissingAuth(sessionId: string): AuthService[] {
    const services: AuthService[] = ['github', 'supabase', 'vercel'];
    const missing: AuthService[] = [];

    for (const service of services) {
      const sourceName = this.getAuthSourceName(sessionId, service);
      if (!sourceName) {
        missing.push(service);
      }
    }

    return missing;
  }

  /**
   * Auto-bind missing services to their defaults
   */
  autoBindDefaults(sessionId: string): AuthBinding[] {
    const missing = this.getMissingAuth(sessionId);
    const bindings: AuthBinding[] = [];

    for (const service of missing) {
      const defaultSource = this.authSourceManager.getDefaultAuthSource(service);
      if (defaultSource) {
        const binding = this.bindService(sessionId, service, defaultSource.name);
        bindings.push(binding);
      }
    }

    return bindings;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createAuthBindingManager(store: StateStore): AuthBindingManager {
  return new AuthBindingManager(store);
}
