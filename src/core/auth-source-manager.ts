/**
 * Auth Source Manager
 *
 * Manages named credential sets (auth sources) stored globally.
 * Handles encryption/decryption of credentials and verification.
 *
 * @module auth-source-manager
 */

import { getGlobalStore, type GlobalStore } from './global-store.js';
import { CredentialManager } from './credential-manager.js';
import type { MCPCredential } from './mcp-types.js';
import type {
  AuthService,
  AuthSource,
  AuthType,
  CreateAuthSourceParams,
  UpdateAuthSourceParams,
  AuthCheckResult,
} from './auth-types.js';

// ============================================================================
// Auth Source Manager
// ============================================================================

export class AuthSourceManager {
  private globalStore: GlobalStore;
  private credentialManager: CredentialManager;
  private initialized = false;

  constructor() {
    this.globalStore = getGlobalStore();
    this.credentialManager = new CredentialManager();
  }

  /**
   * Initialize the credential manager
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.credentialManager.initialize();
      this.initialized = true;
    }
  }

  /**
   * Create a new auth source with encrypted credentials
   */
  async createAuthSource(
    name: string,
    service: AuthService,
    displayName: string,
    authType: AuthType,
    credential: MCPCredential,
    options: { isDefault?: boolean; expiresAt?: Date } = {}
  ): Promise<AuthSource> {
    await this.initialize();

    // Check if name already exists
    const existing = this.globalStore.getAuthSource(name);
    if (existing) {
      throw new Error(`Auth source '${name}' already exists`);
    }

    // Create the auth source
    const authSource = this.globalStore.createAuthSource({
      name,
      service,
      displayName,
      authType,
      credential,
      isDefault: options.isDefault,
      expiresAt: options.expiresAt,
    });

    return authSource;
  }

  /**
   * Get an auth source by name (without credentials)
   */
  getAuthSource(name: string): AuthSource | null {
    return this.globalStore.getAuthSource(name);
  }

  /**
   * Get an auth source by ID
   */
  getAuthSourceById(id: string): AuthSource | null {
    return this.globalStore.getAuthSourceById(id);
  }

  /**
   * List all auth sources, optionally filtered by service
   */
  listAuthSources(service?: AuthService): AuthSource[] {
    return this.globalStore.listAuthSources(service);
  }

  /**
   * Get the default auth source for a service
   */
  getDefaultAuthSource(service: AuthService): AuthSource | null {
    return this.globalStore.getDefaultAuthSource(service);
  }

  /**
   * Update an auth source
   */
  updateAuthSource(name: string, updates: UpdateAuthSourceParams): AuthSource | null {
    return this.globalStore.updateAuthSource(name, updates);
  }

  /**
   * Set an auth source as the default for its service
   */
  setDefaultAuthSource(name: string): boolean {
    return this.globalStore.setDefaultAuthSource(name);
  }

  /**
   * Delete an auth source
   */
  deleteAuthSource(name: string): boolean {
    return this.globalStore.deleteAuthSource(name);
  }

  /**
   * Get the decrypted credentials for an auth source
   */
  async getCredentials(name: string): Promise<MCPCredential | null> {
    await this.initialize();

    const credentialData = this.globalStore.getAuthSourceCredentialData(name);
    if (!credentialData) {
      return null;
    }

    try {
      // The credential data is stored as JSON, parse it
      return JSON.parse(credentialData) as MCPCredential;
    } catch {
      return null;
    }
  }

  /**
   * Update the credentials for an auth source
   */
  async updateCredentials(name: string, credential: MCPCredential): Promise<boolean> {
    await this.initialize();

    const credentialData = JSON.stringify(credential);
    const updated = this.globalStore.updateAuthSourceCredential(name, credentialData);

    if (updated) {
      // Update the verification timestamp
      this.globalStore.updateAuthSource(name, {
        lastVerifiedAt: new Date(),
        expiresAt: credential.expiresAt ? new Date(credential.expiresAt) : undefined,
      });
    }

    return updated;
  }

  /**
   * Verify an auth source by checking if the credentials are valid
   * This is a placeholder - actual verification requires service-specific logic
   */
  async verifySource(name: string): Promise<AuthCheckResult> {
    const authSource = this.getAuthSource(name);
    if (!authSource) {
      return {
        authenticated: false,
        service: 'github', // Default, will be overwritten if source exists
        sourceName: name,
        error: 'Auth source not found',
      };
    }

    const credentials = await this.getCredentials(name);
    if (!credentials) {
      return {
        authenticated: false,
        service: authSource.service,
        sourceName: name,
        error: 'No credentials found',
      };
    }

    // Check if token is expired
    if (authSource.expiresAt && authSource.expiresAt < new Date()) {
      return {
        authenticated: false,
        service: authSource.service,
        sourceName: name,
        error: 'Token expired',
        errorType: 'expired',
        expiresAt: authSource.expiresAt,
        needsRefresh: true,
      };
    }

    // Check if token is about to expire (within 5 minutes)
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (authSource.expiresAt && authSource.expiresAt < fiveMinutesFromNow) {
      return {
        authenticated: true,
        service: authSource.service,
        sourceName: name,
        expiresAt: authSource.expiresAt,
        needsRefresh: true,
      };
    }

    // Update last verified timestamp
    this.globalStore.updateAuthSource(name, { lastVerifiedAt: new Date() });

    return {
      authenticated: true,
      service: authSource.service,
      sourceName: name,
      expiresAt: authSource.expiresAt ?? undefined,
    };
  }

  /**
   * Check if an auth source exists
   */
  exists(name: string): boolean {
    return this.globalStore.getAuthSource(name) !== null;
  }

  /**
   * Get auth sources that need refresh (expiring soon or expired)
   */
  getSourcesNeedingRefresh(): AuthSource[] {
    const allSources = this.listAuthSources();
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    return allSources.filter((source) => {
      if (!source.expiresAt) return false;
      return source.expiresAt < fiveMinutesFromNow;
    });
  }

  /**
   * Get a summary of auth status for all services
   */
  async getAuthStatusSummary(): Promise<Map<AuthService, AuthCheckResult>> {
    const services: AuthService[] = ['github', 'supabase', 'vercel'];
    const results = new Map<AuthService, AuthCheckResult>();

    for (const service of services) {
      const defaultSource = this.getDefaultAuthSource(service);
      if (!defaultSource) {
        results.set(service, {
          authenticated: false,
          service,
          sourceName: null,
          error: 'No auth source configured',
        });
        continue;
      }

      const result = await this.verifySource(defaultSource.name);
      results.set(service, result);
    }

    return results;
  }
}

// ============================================================================
// Singleton & Exports
// ============================================================================

let authSourceManagerInstance: AuthSourceManager | null = null;

export function getAuthSourceManager(): AuthSourceManager {
  if (!authSourceManagerInstance) {
    authSourceManagerInstance = new AuthSourceManager();
  }
  return authSourceManagerInstance;
}

export { AuthSourceManager as AuthSourceManagerClass };
