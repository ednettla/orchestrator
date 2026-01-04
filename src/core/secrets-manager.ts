/**
 * Secrets Manager
 *
 * Environment-based secrets management with AES-256-GCM encryption.
 * Stored at <project>/.orchestrator/secrets.enc
 *
 * Secrets are organized by environment:
 * - development
 * - staging
 * - production
 *
 * Template placeholder syntax for CLAUDE.md:
 *   {{secrets.production.supabase_url}}
 *   {{secrets.staging.api_key}}
 *
 * @module secrets-manager
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// ============================================================================
// Types
// ============================================================================

export type SecretEnvironment = 'development' | 'staging' | 'production';

export interface SecretDefinition {
  value: string;
  service?: string | undefined;
  description?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

interface SecretsData {
  version: number;
  environments: Record<SecretEnvironment, Record<string, SecretDefinition>>;
}

// ============================================================================
// Constants
// ============================================================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// ============================================================================
// Secrets Manager
// ============================================================================

export class SecretsManager {
  private projectPath: string;
  private secretsPath: string;
  private encryptionKey: Buffer;
  private cache: SecretsData | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.secretsPath = path.join(projectPath, '.orchestrator', 'secrets.enc');
    this.encryptionKey = this.deriveKey();
  }

  /**
   * Derive encryption key from machine-specific data
   */
  private deriveKey(): Buffer {
    // Use machine-specific salt for key derivation
    const machineId = `${os.hostname()}-${os.userInfo().username}-${this.projectPath}`;
    const salt = Buffer.from(machineId).slice(0, SALT_LENGTH);
    const paddedSalt = Buffer.alloc(SALT_LENGTH);
    salt.copy(paddedSalt);

    // Derive key using scrypt
    return scryptSync('orchestrator-secrets-v1', paddedSalt, KEY_LENGTH);
  }

  /**
   * Encrypt data
   */
  private encrypt(data: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);

    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: IV (16 bytes) + Auth Tag (16 bytes) + Encrypted Data
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypt data
   */
  private decrypt(data: Buffer): string {
    const iv = data.slice(0, IV_LENGTH);
    const authTag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.slice(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf8');
  }

  /**
   * Load secrets from disk
   */
  private load(): SecretsData {
    if (this.cache) return this.cache;

    if (!existsSync(this.secretsPath)) {
      this.cache = {
        version: 1,
        environments: {
          development: {},
          staging: {},
          production: {},
        },
      };
      return this.cache;
    }

    try {
      const encrypted = readFileSync(this.secretsPath);
      const decrypted = this.decrypt(encrypted);
      this.cache = JSON.parse(decrypted) as SecretsData;
      return this.cache;
    } catch {
      // Corrupted or tampered file, start fresh
      this.cache = {
        version: 1,
        environments: {
          development: {},
          staging: {},
          production: {},
        },
      };
      return this.cache;
    }
  }

  /**
   * Save secrets to disk
   */
  private save(): void {
    if (!this.cache) return;

    const dir = path.dirname(this.secretsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const json = JSON.stringify(this.cache, null, 2);
    const encrypted = this.encrypt(json);
    writeFileSync(this.secretsPath, encrypted);
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.cache = null;
  }

  // ==========================================================================
  // Secret Management
  // ==========================================================================

  /**
   * Set a secret
   */
  setSecret(
    env: SecretEnvironment,
    key: string,
    value: string,
    options?: { service?: string | undefined; description?: string | undefined }
  ): void {
    const data = this.load();
    const now = new Date().toISOString();

    const existing = data.environments[env][key];

    data.environments[env][key] = {
      value,
      service: options?.service ?? existing?.service,
      description: options?.description ?? existing?.description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.save();
  }

  /**
   * Get a secret value
   */
  getSecret(env: SecretEnvironment, key: string): string | null {
    const data = this.load();
    return data.environments[env][key]?.value ?? null;
  }

  /**
   * Get secret definition (with metadata)
   */
  getSecretDefinition(env: SecretEnvironment, key: string): SecretDefinition | null {
    const data = this.load();
    return data.environments[env][key] ?? null;
  }

  /**
   * Delete a secret
   */
  deleteSecret(env: SecretEnvironment, key: string): boolean {
    const data = this.load();

    if (!data.environments[env][key]) {
      return false;
    }

    delete data.environments[env][key];
    this.save();
    return true;
  }

  /**
   * List all secret keys in an environment
   */
  listSecretKeys(env: SecretEnvironment): string[] {
    const data = this.load();
    return Object.keys(data.environments[env]).sort();
  }

  /**
   * Get all secrets for an environment
   */
  getAllSecrets(env: SecretEnvironment): Record<string, SecretDefinition> {
    const data = this.load();
    return { ...data.environments[env] };
  }

  /**
   * Get secret counts per environment
   */
  getSecretCounts(): Record<SecretEnvironment, number> {
    const data = this.load();
    return {
      development: Object.keys(data.environments.development).length,
      staging: Object.keys(data.environments.staging).length,
      production: Object.keys(data.environments.production).length,
    };
  }

  // ==========================================================================
  // Template Resolution
  // ==========================================================================

  /**
   * Resolve template placeholders in content
   *
   * Syntax: {{secrets.environment.key}}
   * Example: {{secrets.production.supabase_url}}
   */
  resolveTemplate(content: string): string {
    const pattern = /\{\{secrets\.(\w+)\.(\w+)\}\}/g;

    return content.replace(pattern, (match, env, key) => {
      if (!['development', 'staging', 'production'].includes(env)) {
        return match; // Keep original if invalid environment
      }

      const value = this.getSecret(env as SecretEnvironment, key);
      return value ?? match; // Keep original if secret not found
    });
  }

  /**
   * Find all template placeholders in content
   */
  findPlaceholders(content: string): Array<{ env: SecretEnvironment; key: string; found: boolean }> {
    const pattern = /\{\{secrets\.(\w+)\.(\w+)\}\}/g;
    const placeholders: Array<{ env: SecretEnvironment; key: string; found: boolean }> = [];

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const envStr = match[1];
      const keyStr = match[2];

      if (envStr && keyStr && ['development', 'staging', 'production'].includes(envStr)) {
        const env = envStr as SecretEnvironment;
        const value = this.getSecret(env, keyStr);
        placeholders.push({ env, key: keyStr, found: value !== null });
      }
    }

    return placeholders;
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  /**
   * Export secrets to .env file format
   */
  exportToEnvFile(env: SecretEnvironment, outputPath?: string): string {
    const data = this.load();
    const secrets = data.environments[env];

    const lines = [
      `# Orchestrator Secrets Export`,
      `# Environment: ${env}`,
      `# Generated: ${new Date().toISOString()}`,
      '',
    ];

    for (const [key, def] of Object.entries(secrets)) {
      if (def.description) {
        lines.push(`# ${def.description}`);
      }
      if (def.service) {
        lines.push(`# Service: ${def.service}`);
      }
      lines.push(`${key.toUpperCase()}="${def.value}"`);
      lines.push('');
    }

    const content = lines.join('\n');

    if (outputPath) {
      const fullPath = path.resolve(this.projectPath, outputPath);
      writeFileSync(fullPath, content);
    }

    return content;
  }

  /**
   * Import secrets from .env file
   */
  importFromEnvFile(filePath: string, env: SecretEnvironment): number {
    const fullPath = path.resolve(this.projectPath, filePath);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    let imported = 0;
    let currentDescription: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) {
        currentDescription = undefined;
        continue;
      }

      // Capture description from comments
      if (trimmed.startsWith('#')) {
        const comment = trimmed.slice(1).trim();
        if (!comment.startsWith('Service:') && !comment.startsWith('Orchestrator') && !comment.startsWith('Environment:') && !comment.startsWith('Generated:')) {
          currentDescription = comment;
        }
        continue;
      }

      // Parse KEY=value or KEY="value"
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?$/i);
      if (match) {
        const keyMatch = match[1];
        const valueMatch = match[2];
        if (keyMatch && valueMatch) {
          this.setSecret(env, keyMatch.toLowerCase(), valueMatch, {
            description: currentDescription,
          });
          imported++;
          currentDescription = undefined;
        }
      }
    }

    return imported;
  }

  /**
   * Copy secrets between environments
   */
  copySecrets(fromEnv: SecretEnvironment, toEnv: SecretEnvironment, keys?: string[]): number {
    const data = this.load();
    const sourceSecrets = data.environments[fromEnv];

    const keysToCopy = keys ?? Object.keys(sourceSecrets);
    let copied = 0;

    for (const key of keysToCopy) {
      const secret = sourceSecrets[key];
      if (secret) {
        this.setSecret(toEnv, key, secret.value, {
          service: secret.service,
          description: secret.description,
        });
        copied++;
      }
    }

    return copied;
  }
}

// ============================================================================
// Factory & Exports
// ============================================================================

const managersCache = new Map<string, SecretsManager>();

export function createSecretsManager(projectPath: string): SecretsManager {
  const resolved = path.resolve(projectPath);

  if (!managersCache.has(resolved)) {
    managersCache.set(resolved, new SecretsManager(resolved));
  }

  return managersCache.get(resolved)!;
}

export { SecretsManager as SecretsManagerClass };
