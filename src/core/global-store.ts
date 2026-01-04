/**
 * Global Store
 *
 * SQLite store for Telegram bot global state.
 * Stored at ~/.orchestrator/global.db
 *
 * Manages:
 * - Authorized users
 * - Conversation state
 * - Telegram bot configuration
 * - Auth sources (named credential sets)
 * - Auth errors (tracked failures)
 * - Paused pipelines (awaiting re-auth)
 *
 * @module global-store
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nanoid } from 'nanoid';
import type {
  AuthService,
  AuthType,
  AuthErrorType,
  AuthSource,
  CreateAuthSourceParams,
  UpdateAuthSourceParams,
  AuthError,
  RecordAuthErrorParams,
  AuthResolutionMethod,
  PausedPipeline,
  PausePipelineParams,
  PausedPipelineStatus,
} from './auth-types.js';

// ============================================================================
// Types
// ============================================================================

export type UserRole = 'admin' | 'operator' | 'viewer';
export type NotificationLevel = 'minimal' | 'progress' | 'verbose';

export interface AuthorizedUser {
  id: string;
  telegramId: number;
  username: string | null;
  displayName: string;
  role: UserRole;
  authorizedAt: Date;
  lastActiveAt: Date | null;
}

export interface ConversationState {
  id: string;
  telegramId: number;
  activeProject: string | null;
  pendingConfirmationType: string | null;
  pendingConfirmationData: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface TelegramConfig {
  botToken: string | null;
  notificationLevel: NotificationLevel;
  webhookUrl: string | null;
}

// ============================================================================
// Role Hierarchy
// ============================================================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

// ============================================================================
// Global Store
// ============================================================================

export class GlobalStore {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    const globalDir = path.join(os.homedir(), '.orchestrator');
    this.dbPath = path.join(globalDir, 'global.db');

    // Ensure directory exists
    if (!existsSync(globalDir)) {
      mkdirSync(globalDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    this.db.exec(`
      -- Authorized Telegram users
      CREATE TABLE IF NOT EXISTS authorized_users (
        id TEXT PRIMARY KEY,
        telegram_id INTEGER UNIQUE NOT NULL,
        username TEXT,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        authorized_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active_at TEXT
      );

      -- Conversation state for multi-step interactions
      CREATE TABLE IF NOT EXISTS conversation_state (
        id TEXT PRIMARY KEY,
        telegram_id INTEGER UNIQUE NOT NULL,
        active_project TEXT,
        pending_confirmation_type TEXT,
        pending_confirmation_data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );

      -- Telegram bot configuration
      CREATE TABLE IF NOT EXISTS telegram_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON authorized_users(telegram_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_telegram_id ON conversation_state(telegram_id);

      -- Auth sources: Named credential sets stored globally
      CREATE TABLE IF NOT EXISTS auth_sources (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        service TEXT NOT NULL,
        display_name TEXT NOT NULL,
        credential_data TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        last_verified_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Auth errors: Track authentication failures
      CREATE TABLE IF NOT EXISTS auth_errors (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        service TEXT NOT NULL,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        pipeline_job_id TEXT,
        occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        resolution_method TEXT
      );

      -- Paused pipelines: Track pipelines awaiting re-auth
      CREATE TABLE IF NOT EXISTS paused_pipelines (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        job_id TEXT NOT NULL,
        requirement_id TEXT NOT NULL,
        paused_phase TEXT NOT NULL,
        service TEXT NOT NULL,
        error_id TEXT REFERENCES auth_errors(id),
        paused_at TEXT NOT NULL DEFAULT (datetime('now')),
        resumed_at TEXT,
        status TEXT NOT NULL DEFAULT 'paused'
      );

      -- Auth indexes
      CREATE INDEX IF NOT EXISTS idx_auth_sources_service ON auth_sources(service);
      CREATE INDEX IF NOT EXISTS idx_auth_sources_name ON auth_sources(name);
      CREATE INDEX IF NOT EXISTS idx_auth_errors_project ON auth_errors(project_path);
      CREATE INDEX IF NOT EXISTS idx_auth_errors_unresolved ON auth_errors(project_path) WHERE resolved_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_paused_pipelines_project ON paused_pipelines(project_path);
      CREATE INDEX IF NOT EXISTS idx_paused_pipelines_status ON paused_pipelines(status);
    `);
  }

  // ==========================================================================
  // User Management
  // ==========================================================================

  /**
   * Add an authorized user
   */
  addUser(
    telegramId: number,
    displayName: string,
    role: UserRole,
    username?: string
  ): AuthorizedUser {
    const id = nanoid();

    const stmt = this.db.prepare(`
      INSERT INTO authorized_users (id, telegram_id, username, display_name, role)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role
    `);

    stmt.run(id, telegramId, username ?? null, displayName, role);

    return this.getUser(telegramId)!;
  }

  /**
   * Get a user by Telegram ID
   */
  getUser(telegramId: number): AuthorizedUser | null {
    const stmt = this.db.prepare(`
      SELECT * FROM authorized_users WHERE telegram_id = ?
    `);

    const row = stmt.get(telegramId) as DatabaseUserRow | undefined;
    if (!row) return null;

    return this.rowToUser(row);
  }

  /**
   * Get a user by internal ID
   */
  getUserById(id: string): AuthorizedUser | null {
    const stmt = this.db.prepare(`
      SELECT * FROM authorized_users WHERE id = ?
    `);

    const row = stmt.get(id) as DatabaseUserRow | undefined;
    if (!row) return null;

    return this.rowToUser(row);
  }

  /**
   * List all authorized users
   */
  listUsers(): AuthorizedUser[] {
    const stmt = this.db.prepare(`
      SELECT * FROM authorized_users ORDER BY role DESC, display_name ASC
    `);

    const rows = stmt.all() as DatabaseUserRow[];
    return rows.map((row) => this.rowToUser(row));
  }

  /**
   * Update user details
   */
  updateUser(
    telegramId: number,
    updates: { displayName?: string; role?: UserRole; username?: string }
  ): boolean {
    const sets: string[] = [];
    const values: (string | number)[] = [];

    if (updates.displayName !== undefined) {
      sets.push('display_name = ?');
      values.push(updates.displayName);
    }
    if (updates.role !== undefined) {
      sets.push('role = ?');
      values.push(updates.role);
    }
    if (updates.username !== undefined) {
      sets.push('username = ?');
      values.push(updates.username);
    }

    if (sets.length === 0) return false;

    values.push(telegramId);
    const stmt = this.db.prepare(
      `UPDATE authorized_users SET ${sets.join(', ')} WHERE telegram_id = ?`
    );

    const result = stmt.run(...values);
    return result.changes > 0;
  }

  /**
   * Remove a user
   */
  removeUser(telegramId: number): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM authorized_users WHERE telegram_id = ?
    `);

    const result = stmt.run(telegramId);
    return result.changes > 0;
  }

  /**
   * Check if a user has the required role level
   */
  hasRole(telegramId: number, requiredRole: UserRole): boolean {
    const user = this.getUser(telegramId);
    if (!user) return false;

    return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[requiredRole];
  }

  /**
   * Update user's last active timestamp
   */
  touchUser(telegramId: number): void {
    const stmt = this.db.prepare(`
      UPDATE authorized_users SET last_active_at = datetime('now')
      WHERE telegram_id = ?
    `);

    stmt.run(telegramId);
  }

  // ==========================================================================
  // Conversation State
  // ==========================================================================

  /**
   * Get conversation state for a user
   */
  getConversationState(telegramId: number): ConversationState | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_state
      WHERE telegram_id = ? AND expires_at > datetime('now')
    `);

    const row = stmt.get(telegramId) as DatabaseConversationRow | undefined;
    if (!row) return null;

    return this.rowToConversationState(row);
  }

  /**
   * Set or update conversation state
   */
  setConversationState(
    telegramId: number,
    state: {
      activeProject?: string | null;
      pendingConfirmationType?: string | null;
      pendingConfirmationData?: Record<string, unknown> | null;
      expiresInHours?: number;
    }
  ): ConversationState {
    const id = nanoid();
    const expiresHours = state.expiresInHours ?? 24;
    const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);

    const stmt = this.db.prepare(`
      INSERT INTO conversation_state (
        id, telegram_id, active_project, pending_confirmation_type,
        pending_confirmation_data, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        active_project = excluded.active_project,
        pending_confirmation_type = excluded.pending_confirmation_type,
        pending_confirmation_data = excluded.pending_confirmation_data,
        expires_at = excluded.expires_at
    `);

    stmt.run(
      id,
      telegramId,
      state.activeProject ?? null,
      state.pendingConfirmationType ?? null,
      state.pendingConfirmationData ? JSON.stringify(state.pendingConfirmationData) : null,
      expiresAt.toISOString()
    );

    return this.getConversationState(telegramId)!;
  }

  /**
   * Clear conversation state
   */
  clearConversationState(telegramId: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM conversation_state WHERE telegram_id = ?
    `);

    stmt.run(telegramId);
  }

  /**
   * Clear pending confirmation only
   */
  clearPendingConfirmation(telegramId: number): void {
    const stmt = this.db.prepare(`
      UPDATE conversation_state
      SET pending_confirmation_type = NULL, pending_confirmation_data = NULL
      WHERE telegram_id = ?
    `);

    stmt.run(telegramId);
  }

  // ==========================================================================
  // Telegram Configuration
  // ==========================================================================

  /**
   * Get Telegram configuration
   */
  getConfig(): TelegramConfig {
    const stmt = this.db.prepare(`SELECT key, value FROM telegram_config`);
    const rows = stmt.all() as Array<{ key: string; value: string }>;

    const config: TelegramConfig = {
      botToken: null,
      notificationLevel: 'progress',
      webhookUrl: null,
    };

    for (const row of rows) {
      switch (row.key) {
        case 'bot_token':
          config.botToken = row.value;
          break;
        case 'notification_level':
          config.notificationLevel = row.value as NotificationLevel;
          break;
        case 'webhook_url':
          config.webhookUrl = row.value;
          break;
      }
    }

    return config;
  }

  /**
   * Set bot token
   */
  setBotToken(token: string): void {
    this.setConfigValue('bot_token', token);
  }

  /**
   * Set notification level
   */
  setNotificationLevel(level: NotificationLevel): void {
    this.setConfigValue('notification_level', level);
  }

  /**
   * Set webhook URL
   */
  setWebhookUrl(url: string | null): void {
    if (url) {
      this.setConfigValue('webhook_url', url);
    } else {
      this.deleteConfigValue('webhook_url');
    }
  }

  /**
   * Set a config value
   */
  private setConfigValue(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO telegram_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    stmt.run(key, value);
  }

  /**
   * Delete a config value
   */
  private deleteConfigValue(key: string): void {
    const stmt = this.db.prepare(`DELETE FROM telegram_config WHERE key = ?`);
    stmt.run(key);
  }

  // ==========================================================================
  // Auth Sources
  // ==========================================================================

  /**
   * Create a new auth source
   */
  createAuthSource(params: CreateAuthSourceParams): AuthSource {
    const id = nanoid();
    const now = new Date().toISOString();

    // If setting as default, clear other defaults for this service
    if (params.isDefault) {
      this.db.prepare(`
        UPDATE auth_sources SET is_default = 0 WHERE service = ?
      `).run(params.service);
    }

    const stmt = this.db.prepare(`
      INSERT INTO auth_sources (
        id, name, service, display_name, credential_data, auth_type,
        is_default, expires_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.name,
      params.service,
      params.displayName,
      JSON.stringify(params.credential),
      params.authType,
      params.isDefault ? 1 : 0,
      params.expiresAt?.toISOString() ?? null,
      now,
      now
    );

    return this.getAuthSource(params.name)!;
  }

  /**
   * Get an auth source by name
   */
  getAuthSource(name: string): AuthSource | null {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_sources WHERE name = ?
    `);

    const row = stmt.get(name) as DatabaseAuthSourceRow | undefined;
    if (!row) return null;

    return this.rowToAuthSource(row);
  }

  /**
   * Get an auth source by ID
   */
  getAuthSourceById(id: string): AuthSource | null {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_sources WHERE id = ?
    `);

    const row = stmt.get(id) as DatabaseAuthSourceRow | undefined;
    if (!row) return null;

    return this.rowToAuthSource(row);
  }

  /**
   * List all auth sources, optionally filtered by service
   */
  listAuthSources(service?: AuthService): AuthSource[] {
    let stmt;
    if (service) {
      stmt = this.db.prepare(`
        SELECT * FROM auth_sources WHERE service = ? ORDER BY is_default DESC, name ASC
      `);
      const rows = stmt.all(service) as DatabaseAuthSourceRow[];
      return rows.map((row) => this.rowToAuthSource(row));
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM auth_sources ORDER BY service ASC, is_default DESC, name ASC
      `);
      const rows = stmt.all() as DatabaseAuthSourceRow[];
      return rows.map((row) => this.rowToAuthSource(row));
    }
  }

  /**
   * Get the default auth source for a service
   */
  getDefaultAuthSource(service: AuthService): AuthSource | null {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_sources WHERE service = ? AND is_default = 1
    `);

    const row = stmt.get(service) as DatabaseAuthSourceRow | undefined;
    if (!row) return null;

    return this.rowToAuthSource(row);
  }

  /**
   * Update an auth source
   */
  updateAuthSource(name: string, updates: UpdateAuthSourceParams): AuthSource | null {
    const existing = this.getAuthSource(name);
    if (!existing) return null;

    const sets: string[] = ['updated_at = datetime(\'now\')'];
    const values: (string | number | null)[] = [];

    if (updates.displayName !== undefined) {
      sets.push('display_name = ?');
      values.push(updates.displayName);
    }
    if (updates.isDefault !== undefined) {
      // If setting as default, clear other defaults for this service
      if (updates.isDefault) {
        this.db.prepare(`
          UPDATE auth_sources SET is_default = 0 WHERE service = ?
        `).run(existing.service);
      }
      sets.push('is_default = ?');
      values.push(updates.isDefault ? 1 : 0);
    }
    if (updates.lastVerifiedAt !== undefined) {
      sets.push('last_verified_at = ?');
      values.push(updates.lastVerifiedAt?.toISOString() ?? null);
    }
    if (updates.expiresAt !== undefined) {
      sets.push('expires_at = ?');
      values.push(updates.expiresAt?.toISOString() ?? null);
    }

    values.push(name);
    const stmt = this.db.prepare(
      `UPDATE auth_sources SET ${sets.join(', ')} WHERE name = ?`
    );
    stmt.run(...values);

    return this.getAuthSource(name);
  }

  /**
   * Update the credential data for an auth source
   */
  updateAuthSourceCredential(name: string, credentialData: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE auth_sources SET credential_data = ?, updated_at = datetime('now')
      WHERE name = ?
    `);

    const result = stmt.run(credentialData, name);
    return result.changes > 0;
  }

  /**
   * Get the encrypted credential data for an auth source
   */
  getAuthSourceCredentialData(name: string): string | null {
    const stmt = this.db.prepare(`
      SELECT credential_data FROM auth_sources WHERE name = ?
    `);

    const row = stmt.get(name) as { credential_data: string } | undefined;
    return row?.credential_data ?? null;
  }

  /**
   * Set an auth source as the default for its service
   */
  setDefaultAuthSource(name: string): boolean {
    const source = this.getAuthSource(name);
    if (!source) return false;

    // Clear existing default
    this.db.prepare(`
      UPDATE auth_sources SET is_default = 0 WHERE service = ?
    `).run(source.service);

    // Set new default
    const stmt = this.db.prepare(`
      UPDATE auth_sources SET is_default = 1, updated_at = datetime('now')
      WHERE name = ?
    `);

    const result = stmt.run(name);
    return result.changes > 0;
  }

  /**
   * Delete an auth source
   */
  deleteAuthSource(name: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM auth_sources WHERE name = ?
    `);

    const result = stmt.run(name);
    return result.changes > 0;
  }

  // ==========================================================================
  // Auth Errors
  // ==========================================================================

  /**
   * Record an auth error
   */
  recordAuthError(params: RecordAuthErrorParams): AuthError {
    const id = nanoid();

    const stmt = this.db.prepare(`
      INSERT INTO auth_errors (
        id, project_path, service, error_type, error_message, pipeline_job_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.projectPath,
      params.service,
      params.errorType,
      params.errorMessage,
      params.pipelineJobId ?? null
    );

    return this.getAuthError(id)!;
  }

  /**
   * Get an auth error by ID
   */
  getAuthError(id: string): AuthError | null {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_errors WHERE id = ?
    `);

    const row = stmt.get(id) as DatabaseAuthErrorRow | undefined;
    if (!row) return null;

    return this.rowToAuthError(row);
  }

  /**
   * Get unresolved auth errors for a project
   */
  getUnresolvedAuthErrors(projectPath: string): AuthError[] {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_errors
      WHERE project_path = ? AND resolved_at IS NULL
      ORDER BY occurred_at DESC
    `);

    const rows = stmt.all(projectPath) as DatabaseAuthErrorRow[];
    return rows.map((row) => this.rowToAuthError(row));
  }

  /**
   * Get recent auth errors for a project
   */
  getRecentAuthErrors(projectPath: string, limit = 10): AuthError[] {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_errors
      WHERE project_path = ?
      ORDER BY occurred_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(projectPath, limit) as DatabaseAuthErrorRow[];
    return rows.map((row) => this.rowToAuthError(row));
  }

  /**
   * Resolve an auth error
   */
  resolveAuthError(id: string, method: AuthResolutionMethod): boolean {
    const stmt = this.db.prepare(`
      UPDATE auth_errors
      SET resolved_at = datetime('now'), resolution_method = ?
      WHERE id = ?
    `);

    const result = stmt.run(method, id);
    return result.changes > 0;
  }

  /**
   * Resolve all unresolved errors for a service in a project
   */
  resolveAuthErrorsForService(
    projectPath: string,
    service: AuthService,
    method: AuthResolutionMethod
  ): number {
    const stmt = this.db.prepare(`
      UPDATE auth_errors
      SET resolved_at = datetime('now'), resolution_method = ?
      WHERE project_path = ? AND service = ? AND resolved_at IS NULL
    `);

    const result = stmt.run(method, projectPath, service);
    return result.changes;
  }

  // ==========================================================================
  // Paused Pipelines
  // ==========================================================================

  /**
   * Pause a pipeline due to auth failure
   */
  pausePipeline(params: PausePipelineParams): PausedPipeline {
    const id = nanoid();

    const stmt = this.db.prepare(`
      INSERT INTO paused_pipelines (
        id, project_path, job_id, requirement_id, paused_phase, service, error_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.projectPath,
      params.jobId,
      params.requirementId,
      params.pausedPhase,
      params.service,
      params.errorId
    );

    return this.getPausedPipeline(id)!;
  }

  /**
   * Get a paused pipeline by ID
   */
  getPausedPipeline(id: string): PausedPipeline | null {
    const stmt = this.db.prepare(`
      SELECT * FROM paused_pipelines WHERE id = ?
    `);

    const row = stmt.get(id) as DatabasePausedPipelineRow | undefined;
    if (!row) return null;

    return this.rowToPausedPipeline(row);
  }

  /**
   * Get the active paused pipeline for a project
   */
  getActivePausedPipeline(projectPath: string): PausedPipeline | null {
    const stmt = this.db.prepare(`
      SELECT * FROM paused_pipelines
      WHERE project_path = ? AND status = 'paused'
      ORDER BY paused_at DESC
      LIMIT 1
    `);

    const row = stmt.get(projectPath) as DatabasePausedPipelineRow | undefined;
    if (!row) return null;

    return this.rowToPausedPipeline(row);
  }

  /**
   * List all paused pipelines
   */
  listPausedPipelines(status?: PausedPipelineStatus): PausedPipeline[] {
    let stmt;
    if (status) {
      stmt = this.db.prepare(`
        SELECT * FROM paused_pipelines WHERE status = ? ORDER BY paused_at DESC
      `);
      const rows = stmt.all(status) as DatabasePausedPipelineRow[];
      return rows.map((row) => this.rowToPausedPipeline(row));
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM paused_pipelines ORDER BY paused_at DESC
      `);
      const rows = stmt.all() as DatabasePausedPipelineRow[];
      return rows.map((row) => this.rowToPausedPipeline(row));
    }
  }

  /**
   * Resume a paused pipeline
   */
  resumePipeline(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE paused_pipelines
      SET status = 'resumed', resumed_at = datetime('now')
      WHERE id = ? AND status = 'paused'
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Cancel a paused pipeline
   */
  cancelPipeline(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE paused_pipelines
      SET status = 'cancelled', resumed_at = datetime('now')
      WHERE id = ? AND status = 'paused'
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Resume all paused pipelines for a service
   */
  resumePipelinesForService(service: AuthService): number {
    const stmt = this.db.prepare(`
      UPDATE paused_pipelines
      SET status = 'resumed', resumed_at = datetime('now')
      WHERE service = ? AND status = 'paused'
    `);

    const result = stmt.run(service);
    return result.changes;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Convert database row to AuthorizedUser
   */
  private rowToUser(row: DatabaseUserRow): AuthorizedUser {
    return {
      id: row.id,
      telegramId: row.telegram_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role as UserRole,
      authorizedAt: new Date(row.authorized_at),
      lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : null,
    };
  }

  /**
   * Convert database row to ConversationState
   */
  private rowToConversationState(row: DatabaseConversationRow): ConversationState {
    return {
      id: row.id,
      telegramId: row.telegram_id,
      activeProject: row.active_project,
      pendingConfirmationType: row.pending_confirmation_type,
      pendingConfirmationData: row.pending_confirmation_data
        ? (JSON.parse(row.pending_confirmation_data) as Record<string, unknown>)
        : null,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  /**
   * Convert database row to AuthSource
   */
  private rowToAuthSource(row: DatabaseAuthSourceRow): AuthSource {
    return {
      id: row.id,
      name: row.name,
      service: row.service as AuthService,
      displayName: row.display_name,
      authType: row.auth_type as AuthType,
      isDefault: row.is_default === 1,
      lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Convert database row to AuthError
   */
  private rowToAuthError(row: DatabaseAuthErrorRow): AuthError {
    return {
      id: row.id,
      projectPath: row.project_path,
      service: row.service as AuthService,
      errorType: row.error_type as AuthErrorType,
      errorMessage: row.error_message,
      pipelineJobId: row.pipeline_job_id,
      occurredAt: new Date(row.occurred_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      resolutionMethod: row.resolution_method as AuthResolutionMethod | null,
    };
  }

  /**
   * Convert database row to PausedPipeline
   */
  private rowToPausedPipeline(row: DatabasePausedPipelineRow): PausedPipeline {
    return {
      id: row.id,
      projectPath: row.project_path,
      jobId: row.job_id,
      requirementId: row.requirement_id,
      pausedPhase: row.paused_phase,
      service: row.service as AuthService,
      errorId: row.error_id,
      pausedAt: new Date(row.paused_at),
      resumedAt: row.resumed_at ? new Date(row.resumed_at) : null,
      status: row.status as PausedPipelineStatus,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Database Row Types
// ============================================================================

interface DatabaseUserRow {
  id: string;
  telegram_id: number;
  username: string | null;
  display_name: string;
  role: string;
  authorized_at: string;
  last_active_at: string | null;
}

interface DatabaseConversationRow {
  id: string;
  telegram_id: number;
  active_project: string | null;
  pending_confirmation_type: string | null;
  pending_confirmation_data: string | null;
  created_at: string;
  expires_at: string;
}

interface DatabaseAuthSourceRow {
  id: string;
  name: string;
  service: string;
  display_name: string;
  credential_data: string;
  auth_type: string;
  is_default: number;
  last_verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DatabaseAuthErrorRow {
  id: string;
  project_path: string;
  service: string;
  error_type: string;
  error_message: string;
  pipeline_job_id: string | null;
  occurred_at: string;
  resolved_at: string | null;
  resolution_method: string | null;
}

interface DatabasePausedPipelineRow {
  id: string;
  project_path: string;
  job_id: string;
  requirement_id: string;
  paused_phase: string;
  service: string;
  error_id: string;
  paused_at: string;
  resumed_at: string | null;
  status: string;
}

// ============================================================================
// Singleton & Exports
// ============================================================================

let globalStoreInstance: GlobalStore | null = null;

export function getGlobalStore(): GlobalStore {
  if (!globalStoreInstance) {
    globalStoreInstance = new GlobalStore();
  }
  return globalStoreInstance;
}

export { GlobalStore as GlobalStoreClass };
