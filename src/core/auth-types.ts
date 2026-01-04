/**
 * Auth Types
 *
 * Type definitions for the authentication system including:
 * - Auth sources (named credential sets)
 * - Auth bindings (project -> source mappings)
 * - Error handling and recovery types
 *
 * @module auth-types
 */

import type { MCPCredential } from './mcp-types.js';

// ============================================================================
// Service Types
// ============================================================================

/**
 * Supported authentication services
 */
export type AuthService = 'github' | 'supabase' | 'vercel';

/**
 * Authentication method types
 */
export type AuthType = 'oauth' | 'api_key' | 'token' | 'cli';

/**
 * HTTP error classification for auth failures
 */
export type AuthErrorType = '401' | '403' | '429' | '5xx' | 'network' | 'expired';

// ============================================================================
// Auth Source Types
// ============================================================================

/**
 * A named credential set stored at system level
 * Example: "personal-github", "work-supabase"
 */
export interface AuthSource {
  id: string;
  name: string;                    // Unique identifier (e.g., "personal-github")
  service: AuthService;
  displayName: string;             // Human-readable name
  authType: AuthType;
  isDefault: boolean;              // Default for this service
  lastVerifiedAt: Date | null;     // Last successful auth check
  expiresAt: Date | null;          // Token expiration (if applicable)
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a new auth source
 */
export interface CreateAuthSourceParams {
  name: string;
  service: AuthService;
  displayName: string;
  authType: AuthType;
  credential: MCPCredential;
  isDefault?: boolean | undefined;
  expiresAt?: Date | undefined;
}

/**
 * Parameters for updating an auth source
 */
export interface UpdateAuthSourceParams {
  displayName?: string | undefined;
  isDefault?: boolean | undefined;
  lastVerifiedAt?: Date | null | undefined;
  expiresAt?: Date | null | undefined;
}

// ============================================================================
// Auth Binding Types
// ============================================================================

/**
 * Project-level binding to an auth source
 * Links a project's service to a specific auth source
 */
export interface AuthBinding {
  id: string;
  sessionId: string;
  service: AuthService;
  authSourceName: string;          // Reference to AuthSource.name
  boundAt: Date;
}

/**
 * Parameters for creating an auth binding
 */
export interface CreateAuthBindingParams {
  sessionId: string;
  service: AuthService;
  authSourceName: string;
}

// ============================================================================
// Auth Error Types
// ============================================================================

/**
 * Recorded authentication error
 */
export interface AuthError {
  id: string;
  projectPath: string;
  service: AuthService;
  errorType: AuthErrorType;
  errorMessage: string;
  pipelineJobId: string | null;
  occurredAt: Date;
  resolvedAt: Date | null;
  resolutionMethod: AuthResolutionMethod | null;
}

/**
 * How an auth error was resolved
 */
export type AuthResolutionMethod = 'reauth' | 'retry' | 'manual' | 'cancelled';

/**
 * Parameters for recording an auth error
 */
export interface RecordAuthErrorParams {
  projectPath: string;
  service: AuthService;
  errorType: AuthErrorType;
  errorMessage: string;
  pipelineJobId?: string;
}

// ============================================================================
// Paused Pipeline Types
// ============================================================================

/**
 * Pipeline paused due to auth failure
 */
export interface PausedPipeline {
  id: string;
  projectPath: string;
  jobId: string;
  requirementId: string;
  pausedPhase: string;             // Phase when paused (e.g., 'coding', 'testing')
  service: AuthService;            // Service that caused pause
  errorId: string;                 // Reference to AuthError
  pausedAt: Date;
  resumedAt: Date | null;
  status: PausedPipelineStatus;
}

/**
 * Status of a paused pipeline
 */
export type PausedPipelineStatus = 'paused' | 'resumed' | 'cancelled';

/**
 * Parameters for pausing a pipeline
 */
export interface PausePipelineParams {
  projectPath: string;
  jobId: string;
  requirementId: string;
  pausedPhase: string;
  service: AuthService;
  errorId: string;
}

// ============================================================================
// Auth Check Types
// ============================================================================

/**
 * Result of an authentication check
 */
export interface AuthCheckResult {
  authenticated: boolean;
  service: AuthService;
  sourceName: string | null;
  error?: string | undefined;
  errorType?: AuthErrorType | undefined;
  httpStatus?: number | undefined;
  expiresAt?: Date | undefined;
  needsRefresh?: boolean | undefined;
}

/**
 * Auth status summary for display (Telegram/CLI)
 */
export interface AuthStatusSummary {
  service: AuthService;
  sourceName: string | null;
  status: 'ok' | 'expired' | 'invalid' | 'not_configured';
  lastChecked: Date | null;
  expiresAt: Date | null;
  errorMessage?: string | undefined;
}

// ============================================================================
// Backoff Configuration
// ============================================================================

/**
 * Configuration for exponential backoff retry
 */
export interface BackoffConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  maxRetries: number;
}

/**
 * Default backoff configurations by error type
 */
export const AUTH_ERROR_BACKOFF: Record<AuthErrorType, BackoffConfig | null> = {
  '401': null,  // No retry, pause immediately
  '403': null,  // No retry, pause immediately
  '429': { initialDelayMs: 30000, maxDelayMs: 300000, factor: 2, maxRetries: 5 },
  '5xx': { initialDelayMs: 5000, maxDelayMs: 60000, factor: 2, maxRetries: 3 },
  'network': { initialDelayMs: 2000, maxDelayMs: 30000, factor: 2, maxRetries: 3 },
  'expired': null,  // No retry, needs re-auth
};

// ============================================================================
// Notification Types
// ============================================================================

/**
 * Auth failure notification for Telegram
 */
export interface AuthFailureNotification {
  service: AuthService;
  projectPath: string;
  projectName: string;
  errorType: AuthErrorType;
  errorMessage: string;
  pausedPhase: string;
  timestamp: Date;
}

/**
 * Auth restored notification
 */
export interface AuthRestoredNotification {
  service: AuthService;
  sourceName: string;
  timestamp: Date;
}
