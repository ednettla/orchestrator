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
 *
 * @module global-store
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nanoid } from 'nanoid';

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
