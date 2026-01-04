import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { MCPCredential, MCPCredentialsStore } from './mcp-types.js';

// ============================================================================
// Credential Manager
// ============================================================================

const CREDENTIALS_VERSION = 1;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION_ITERATIONS = 100000;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Manages secure storage of MCP server credentials.
 *
 * Storage strategy:
 * 1. Primary: Encrypted JSON file with AES-256-GCM
 * 2. Future: System keychain via keytar (optional upgrade)
 *
 * Credentials are stored per-project for project-scoped servers (Supabase, Vercel)
 * and globally for global-scoped servers.
 */
export class CredentialManager {
  private globalCredentialsPath: string;
  private cachedGlobalCredentials: MCPCredentialsStore | null = null;
  private cachedProjectCredentials: Map<string, MCPCredentialsStore> = new Map();
  private encryptionKey: Buffer | null = null;

  constructor() {
    this.globalCredentialsPath = path.join(
      os.homedir(),
      '.orchestrator',
      'credentials.enc'
    );
  }

  /**
   * Initialize the credential manager with a master password.
   * In production, this could come from:
   * - Environment variable
   * - System keychain
   * - User prompt
   */
  async initialize(masterPassword?: string): Promise<void> {
    // Use machine-specific key if no password provided
    const password = masterPassword ?? this.getMachineKey();
    this.encryptionKey = await this.deriveKey(password);
  }

  /**
   * Get a machine-specific key for default encryption.
   * This provides some protection without requiring a password,
   * but credentials are tied to this machine.
   */
  private getMachineKey(): string {
    // Combine machine-specific values for a unique key
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const platform = os.platform();
    const arch = os.arch();

    return `orchestrator:${hostname}:${username}:${platform}:${arch}`;
  }

  /**
   * Derive an encryption key from a password using PBKDF2
   */
  private async deriveKey(password: string, salt?: Buffer): Promise<Buffer> {
    const actualSalt = salt ?? crypto.randomBytes(SALT_LENGTH);

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        actualSalt,
        KEY_DERIVATION_ITERATIONS,
        32, // 256 bits
        'sha512',
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        }
      );
    });
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private encrypt(data: string): string {
    if (!this.encryptionKey) {
      throw new Error('Credential manager not initialized');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);

    // Re-derive key with new salt for each encryption
    const key = crypto.pbkdf2Sync(
      this.getMachineKey(),
      salt,
      KEY_DERIVATION_ITERATIONS,
      32,
      'sha512'
    );

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: salt:iv:authTag:encryptedData (all hex)
    return [
      salt.toString('hex'),
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted,
    ].join(':');
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }

    const [saltHex, ivHex, authTagHex, encrypted] = parts;
    const salt = Buffer.from(saltHex!, 'hex');
    const iv = Buffer.from(ivHex!, 'hex');
    const authTag = Buffer.from(authTagHex!, 'hex');

    // Re-derive key with the stored salt
    const key = crypto.pbkdf2Sync(
      this.getMachineKey(),
      salt,
      KEY_DERIVATION_ITERATIONS,
      32,
      'sha512'
    );

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted!, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Get the path to project credentials file
   */
  getProjectCredentialsPath(projectPath: string): string {
    return path.join(projectPath, '.orchestrator', 'credentials.enc');
  }

  /**
   * Load global credentials
   */
  async loadGlobalCredentials(): Promise<MCPCredentialsStore> {
    if (this.cachedGlobalCredentials) {
      return this.cachedGlobalCredentials;
    }

    const store = await this.loadCredentialsFile(this.globalCredentialsPath);
    this.cachedGlobalCredentials = store;
    return store;
  }

  /**
   * Load project-specific credentials
   */
  async loadProjectCredentials(projectPath: string): Promise<MCPCredentialsStore> {
    if (this.cachedProjectCredentials.has(projectPath)) {
      return this.cachedProjectCredentials.get(projectPath)!;
    }

    const credentialsPath = this.getProjectCredentialsPath(projectPath);
    const store = await this.loadCredentialsFile(credentialsPath);
    this.cachedProjectCredentials.set(projectPath, store);
    return store;
  }

  /**
   * Load credentials from an encrypted file
   */
  private async loadCredentialsFile(filePath: string): Promise<MCPCredentialsStore> {
    if (!existsSync(filePath)) {
      return this.createEmptyStore();
    }

    try {
      const encryptedContent = await readFile(filePath, 'utf-8');
      const decrypted = this.decrypt(encryptedContent);
      const store = JSON.parse(decrypted) as MCPCredentialsStore;

      // Migrate if needed
      if (store.version < CREDENTIALS_VERSION) {
        return this.migrateStore(store);
      }

      return store;
    } catch (error) {
      console.error('Failed to load credentials, creating new store:', error);
      return this.createEmptyStore();
    }
  }

  /**
   * Save global credentials
   */
  async saveGlobalCredentials(store: MCPCredentialsStore): Promise<void> {
    await this.saveCredentialsFile(this.globalCredentialsPath, store);
    this.cachedGlobalCredentials = store;
  }

  /**
   * Save project-specific credentials
   */
  async saveProjectCredentials(
    projectPath: string,
    store: MCPCredentialsStore
  ): Promise<void> {
    const credentialsPath = this.getProjectCredentialsPath(projectPath);
    await this.saveCredentialsFile(credentialsPath, store);
    this.cachedProjectCredentials.set(projectPath, store);
  }

  /**
   * Save credentials to an encrypted file
   */
  private async saveCredentialsFile(
    filePath: string,
    store: MCPCredentialsStore
  ): Promise<void> {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    store.updatedAt = new Date().toISOString();
    const json = JSON.stringify(store, null, 2);
    const encrypted = this.encrypt(json);
    await writeFile(filePath, encrypted, 'utf-8');
  }

  /**
   * Get credential for a specific server
   */
  async getCredential(
    serverName: string,
    projectPath?: string
  ): Promise<MCPCredential | null> {
    // Check project credentials first if project path provided
    if (projectPath) {
      const projectStore = await this.loadProjectCredentials(projectPath);
      if (projectStore.servers[serverName]) {
        return projectStore.servers[serverName];
      }
    }

    // Fall back to global credentials
    const globalStore = await this.loadGlobalCredentials();
    return globalStore.servers[serverName] ?? null;
  }

  /**
   * Set credential for a specific server
   */
  async setCredential(
    serverName: string,
    credential: MCPCredential,
    projectPath?: string
  ): Promise<void> {
    if (projectPath) {
      const store = await this.loadProjectCredentials(projectPath);
      store.servers[serverName] = credential;
      await this.saveProjectCredentials(projectPath, store);
    } else {
      const store = await this.loadGlobalCredentials();
      store.servers[serverName] = credential;
      await this.saveGlobalCredentials(store);
    }
  }

  /**
   * Remove credential for a specific server
   */
  async removeCredential(serverName: string, projectPath?: string): Promise<void> {
    if (projectPath) {
      const store = await this.loadProjectCredentials(projectPath);
      delete store.servers[serverName];
      await this.saveProjectCredentials(projectPath, store);
    } else {
      const store = await this.loadGlobalCredentials();
      delete store.servers[serverName];
      await this.saveGlobalCredentials(store);
    }
  }

  /**
   * Get all credentials (merged global + project)
   */
  async getAllCredentials(projectPath: string): Promise<Record<string, MCPCredential>> {
    const globalStore = await this.loadGlobalCredentials();
    const projectStore = await this.loadProjectCredentials(projectPath);

    // Project credentials override global
    return {
      ...globalStore.servers,
      ...projectStore.servers,
    };
  }

  /**
   * Check if a credential exists for a server
   */
  async hasCredential(serverName: string, projectPath?: string): Promise<boolean> {
    const credential = await this.getCredential(serverName, projectPath);
    return credential !== null;
  }

  /**
   * Check if a credential is expired (for OAuth tokens)
   */
  isCredentialExpired(credential: MCPCredential): boolean {
    if (!credential.expiresAt) {
      return false; // No expiration means it doesn't expire
    }

    const expiresAt = new Date(credential.expiresAt);
    const now = new Date();

    // Consider expired if within 5 minutes of expiration
    const bufferMs = 5 * 60 * 1000;
    return now.getTime() >= expiresAt.getTime() - bufferMs;
  }

  /**
   * Clear all cached credentials (useful for testing)
   */
  clearCache(): void {
    this.cachedGlobalCredentials = null;
    this.cachedProjectCredentials.clear();
  }

  /**
   * Delete all credentials for a project
   */
  async deleteProjectCredentials(projectPath: string): Promise<void> {
    const credentialsPath = this.getProjectCredentialsPath(projectPath);
    if (existsSync(credentialsPath)) {
      await unlink(credentialsPath);
    }
    this.cachedProjectCredentials.delete(projectPath);
  }

  /**
   * Create an empty credentials store
   */
  private createEmptyStore(): MCPCredentialsStore {
    return {
      version: CREDENTIALS_VERSION,
      servers: {},
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Migrate an older store format to the current version
   */
  private migrateStore(store: MCPCredentialsStore): MCPCredentialsStore {
    // Future migrations would go here
    store.version = CREDENTIALS_VERSION;
    return store;
  }

  /**
   * List all servers with stored credentials
   */
  async listCredentialedServers(projectPath?: string): Promise<string[]> {
    const servers = new Set<string>();

    const globalStore = await this.loadGlobalCredentials();
    for (const name of Object.keys(globalStore.servers)) {
      servers.add(name);
    }

    if (projectPath) {
      const projectStore = await this.loadProjectCredentials(projectPath);
      for (const name of Object.keys(projectStore.servers)) {
        servers.add(name);
      }
    }

    return Array.from(servers);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const credentialManager = new CredentialManager();
