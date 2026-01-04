/**
 * Auth Error Handler
 *
 * Classifies HTTP errors, manages error recording, and provides
 * retry/backoff logic for auth-related failures.
 *
 * @module auth-error-handler
 */

import { getGlobalStore, type GlobalStore } from './global-store.js';
import type {
  AuthService,
  AuthError,
  AuthErrorType,
  AuthResolutionMethod,
  RecordAuthErrorParams,
  BackoffConfig,
  AUTH_ERROR_BACKOFF,
} from './auth-types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default backoff configurations by error type
 */
const BACKOFF_CONFIG: Record<AuthErrorType, BackoffConfig | null> = {
  '401': null,  // No retry, pause immediately
  '403': null,  // No retry, pause immediately
  '429': { initialDelayMs: 30000, maxDelayMs: 300000, factor: 2, maxRetries: 5 },
  '5xx': { initialDelayMs: 5000, maxDelayMs: 60000, factor: 2, maxRetries: 3 },
  'network': { initialDelayMs: 2000, maxDelayMs: 30000, factor: 2, maxRetries: 3 },
  'expired': null,  // No retry, needs re-auth
};

/**
 * Error messages for each error type
 */
const ERROR_MESSAGES: Record<AuthErrorType, string> = {
  '401': 'Authentication failed - invalid or expired credentials',
  '403': 'Access denied - insufficient permissions',
  '429': 'Rate limited - too many requests',
  '5xx': 'Server error - service temporarily unavailable',
  'network': 'Network error - connection failed',
  'expired': 'Token expired - re-authentication required',
};

// ============================================================================
// Auth Error Handler
// ============================================================================

export class AuthErrorHandler {
  private globalStore: GlobalStore;

  constructor() {
    this.globalStore = getGlobalStore();
  }

  /**
   * Classify an error based on HTTP status code or error type
   */
  classifyError(error: Error | Response | number): AuthErrorType {
    // If it's a number, treat it as HTTP status code
    if (typeof error === 'number') {
      return this.classifyStatusCode(error);
    }

    // If it's a Response object
    if (error instanceof Response) {
      return this.classifyStatusCode(error.status);
    }

    // If it's an Error object
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Check for network errors
      if (
        message.includes('network') ||
        message.includes('fetch') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('timeout') ||
        message.includes('socket')
      ) {
        return 'network';
      }

      // Check for auth-related errors in message
      if (message.includes('401') || message.includes('unauthorized')) {
        return '401';
      }
      if (message.includes('403') || message.includes('forbidden')) {
        return '403';
      }
      if (message.includes('429') || message.includes('rate limit')) {
        return '429';
      }
      if (message.includes('expired')) {
        return 'expired';
      }

      // Check for status codes in error message
      const statusMatch = message.match(/status[:\s]+(\d{3})/i);
      if (statusMatch && statusMatch[1]) {
        const status = parseInt(statusMatch[1], 10);
        return this.classifyStatusCode(status);
      }
    }

    // Default to network error for unknown errors
    return 'network';
  }

  /**
   * Classify an HTTP status code
   */
  private classifyStatusCode(status: number): AuthErrorType {
    if (status === 401) return '401';
    if (status === 403) return '403';
    if (status === 429) return '429';
    if (status >= 500 && status < 600) return '5xx';
    return 'network';
  }

  /**
   * Get a human-readable error message for an error type
   */
  getErrorMessage(errorType: AuthErrorType): string {
    return ERROR_MESSAGES[errorType];
  }

  /**
   * Record an auth error
   */
  recordError(params: RecordAuthErrorParams): AuthError {
    return this.globalStore.recordAuthError(params);
  }

  /**
   * Get an auth error by ID
   */
  getError(id: string): AuthError | null {
    return this.globalStore.getAuthError(id);
  }

  /**
   * Get unresolved auth errors for a project
   */
  getUnresolvedErrors(projectPath: string): AuthError[] {
    return this.globalStore.getUnresolvedAuthErrors(projectPath);
  }

  /**
   * Get recent auth errors for a project
   */
  getRecentErrors(projectPath: string, limit = 10): AuthError[] {
    return this.globalStore.getRecentAuthErrors(projectPath, limit);
  }

  /**
   * Resolve an auth error
   */
  resolveError(errorId: string, method: AuthResolutionMethod): boolean {
    return this.globalStore.resolveAuthError(errorId, method);
  }

  /**
   * Resolve all errors for a service in a project
   */
  resolveErrorsForService(
    projectPath: string,
    service: AuthService,
    method: AuthResolutionMethod
  ): number {
    return this.globalStore.resolveAuthErrorsForService(projectPath, service, method);
  }

  /**
   * Check if an error type should be retried
   */
  shouldRetry(errorType: AuthErrorType, attemptNumber: number): boolean {
    const config = BACKOFF_CONFIG[errorType];
    if (!config) {
      return false;
    }
    return attemptNumber < config.maxRetries;
  }

  /**
   * Calculate the backoff delay for a given error type and attempt number
   */
  calculateBackoff(errorType: AuthErrorType, attemptNumber: number): number {
    const config = BACKOFF_CONFIG[errorType];
    if (!config) {
      return 0;
    }

    // Exponential backoff: initial * factor^attempt
    const delay = config.initialDelayMs * Math.pow(config.factor, attemptNumber);
    return Math.min(delay, config.maxDelayMs);
  }

  /**
   * Get the backoff configuration for an error type
   */
  getBackoffConfig(errorType: AuthErrorType): BackoffConfig | null {
    return BACKOFF_CONFIG[errorType];
  }

  /**
   * Check if an error type requires immediate pause (no retry)
   */
  requiresImmediatePause(errorType: AuthErrorType): boolean {
    return BACKOFF_CONFIG[errorType] === null;
  }

  /**
   * Check if an error is an auth error that requires re-authentication
   */
  isAuthError(errorType: AuthErrorType): boolean {
    return errorType === '401' || errorType === '403' || errorType === 'expired';
  }

  /**
   * Check if an error is transient (can be retried)
   */
  isTransientError(errorType: AuthErrorType): boolean {
    return errorType === '429' || errorType === '5xx' || errorType === 'network';
  }

  /**
   * Create a detailed error message with context
   */
  createDetailedErrorMessage(
    errorType: AuthErrorType,
    service: AuthService,
    originalError?: string
  ): string {
    const baseMessage = this.getErrorMessage(errorType);
    const serviceLabel = service.charAt(0).toUpperCase() + service.slice(1);

    let message = `${serviceLabel}: ${baseMessage}`;
    if (originalError) {
      message += `\nDetails: ${originalError}`;
    }

    // Add recovery hints
    if (this.isAuthError(errorType)) {
      message += `\n\nTo fix: Run 'orchestrate auth fix ${service}'`;
    } else if (this.isTransientError(errorType)) {
      message += '\n\nThis is a temporary error. Retrying automatically...';
    }

    return message;
  }
}

// ============================================================================
// Singleton & Exports
// ============================================================================

let authErrorHandlerInstance: AuthErrorHandler | null = null;

export function getAuthErrorHandler(): AuthErrorHandler {
  if (!authErrorHandlerInstance) {
    authErrorHandlerInstance = new AuthErrorHandler();
  }
  return authErrorHandlerInstance;
}

export { AuthErrorHandler as AuthErrorHandlerClass };
