/**
 * Telegram Bot Types
 *
 * Type definitions for the Telegram bot module.
 *
 * @module telegram/types
 */

import type { Context } from 'grammy';
import type { AuthorizedUser } from '../core/global-store.js';

// ============================================================================
// Bot Configuration
// ============================================================================

export interface TelegramBotConfig {
  botToken: string;
  authorizedUsers: AuthorizedUser[];
  notificationLevel: NotificationLevel;
  webhookUrl?: string | undefined;
}

export type NotificationLevel = 'minimal' | 'progress' | 'verbose';

// ============================================================================
// Command Context
// ============================================================================

export interface CommandContext {
  ctx: Context;
  command: string;
  projectName?: string | undefined;
  args: string[];
  quotedArg?: string | undefined;
  user: AuthorizedUser;
}

export interface CommandResult {
  success: boolean;
  response: string;
  keyboard?: unknown;  // InlineKeyboard from grammy
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  silent?: boolean;
  skipReply?: boolean;  // Don't send a reply (handler already sent messages)
}

// ============================================================================
// Conversation State
// ============================================================================

export interface ConversationStateData {
  activeProject?: string | undefined;
  pendingConfirmation?: PendingConfirmation | undefined;
  expiresAt: Date;
}

export interface PendingConfirmation {
  type: 'plan_approval' | 'destructive_action' | 'run_confirmation';
  data: Record<string, unknown>;
}

// ============================================================================
// Project Bridge Types
// ============================================================================

export interface ProjectInfo {
  name: string;
  path: string;
  alias?: string | undefined;
  status: 'active' | 'archived';
  techStack?: TechStackSummary | undefined;
  cloudServices?: CloudServicesSummary | undefined;
}

export interface TechStackSummary {
  frontend?: string | undefined;
  backend?: string | undefined;
  database?: string | undefined;
}

export interface CloudServicesSummary {
  github?: string | undefined;
  supabase?: string | undefined;
  vercel?: string | undefined;
}

// ============================================================================
// Status Types
// ============================================================================

export interface ProjectStatus {
  phase: ProjectPhase;
  daemonRunning: boolean;
  requirements: RequirementsSummary;
  lastActivity?: string | undefined;
}

export type ProjectPhase =
  | 'idle'
  | 'planning'
  | 'architecting'
  | 'coding'
  | 'reviewing'
  | 'testing'
  | 'completed'
  | 'failed';

export interface RequirementsSummary {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
}

// ============================================================================
// Command Handler Types
// ============================================================================

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

export interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
  handler: CommandHandler;
  requiredRole: 'admin' | 'operator' | 'viewer';
  projectScoped: boolean;
}

// ============================================================================
// Notification Types
// ============================================================================

export interface NotificationPayload {
  type: NotificationType;
  projectName: string;
  title: string;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export type NotificationType =
  | 'phase_change'
  | 'requirement_completed'
  | 'requirement_failed'
  | 'plan_ready'
  | 'run_completed'
  | 'error';

// ============================================================================
// Callback Data Types
// ============================================================================

export interface CallbackData {
  action: string;
  projectName?: string | undefined;
  requirementId?: string | undefined;
  planId?: string | undefined;
  extra?: string | undefined;
}

/**
 * Parse callback data from button press
 */
export function parseCallbackData(data: string): CallbackData {
  const parts = data.split(':');
  const result: CallbackData = {
    action: parts[0] ?? 'unknown',
  };

  if (parts[1]) result.projectName = parts[1];
  if (parts[2]) result.requirementId = parts[2];
  if (parts[3]) result.planId = parts[3];
  if (parts[4]) result.extra = parts[4];

  return result;
}

/**
 * Create callback data string
 */
export function createCallbackData(data: CallbackData): string {
  const parts = [data.action];
  if (data.projectName) parts.push(data.projectName);
  if (data.requirementId) parts.push(data.requirementId);
  if (data.planId) parts.push(data.planId);
  if (data.extra) parts.push(data.extra);
  return parts.join(':');
}
