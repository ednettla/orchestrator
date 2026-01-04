/**
 * Telegram Bot Security
 *
 * Authentication, authorization, and rate limiting.
 *
 * @module telegram/security
 */

import type { Context, NextFunction } from 'grammy';
import { getGlobalStore, type UserRole } from '../core/global-store.js';

// ============================================================================
// Configuration
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // Max requests per window
const LOCKOUT_THRESHOLD = 5; // Failed attempts before lockout
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface LockoutEntry {
  failedAttempts: number;
  lockedUntil: number | null;
}

const rateLimits = new Map<number, RateLimitEntry>();
const lockouts = new Map<number, LockoutEntry>();

/**
 * Check if user is rate limited
 */
function isRateLimited(telegramId: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(telegramId);

  if (!entry) {
    rateLimits.set(telegramId, { count: 1, windowStart: now });
    return false;
  }

  // Reset window if expired
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(telegramId, { count: 1, windowStart: now });
    return false;
  }

  // Check if over limit
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  // Increment counter
  entry.count++;
  return false;
}

/**
 * Check if user is locked out
 */
function isLockedOut(telegramId: number): boolean {
  const now = Date.now();
  const entry = lockouts.get(telegramId);

  if (!entry) return false;

  // Check if lockout has expired
  if (entry.lockedUntil && now > entry.lockedUntil) {
    lockouts.delete(telegramId);
    return false;
  }

  return entry.lockedUntil !== null;
}

/**
 * Record failed authorization attempt
 */
function recordFailedAttempt(telegramId: number): void {
  const entry = lockouts.get(telegramId) ?? { failedAttempts: 0, lockedUntil: null };
  entry.failedAttempts++;

  if (entry.failedAttempts >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }

  lockouts.set(telegramId, entry);
}

/**
 * Clear failed attempts on successful auth
 */
function clearFailedAttempts(telegramId: number): void {
  lockouts.delete(telegramId);
}

// ============================================================================
// Role Hierarchy
// ============================================================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

/**
 * Check if user has required role level
 */
export function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Authentication middleware
 *
 * Verifies user is authorized and not rate limited/locked out.
 */
export function authMiddleware() {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const telegramId = ctx.from?.id;

    // No user info - can't authenticate
    if (!telegramId) {
      return;
    }

    // Check lockout
    if (isLockedOut(telegramId)) {
      const entry = lockouts.get(telegramId);
      const remainingMinutes = entry?.lockedUntil
        ? Math.ceil((entry.lockedUntil - Date.now()) / 60000)
        : 15;

      await ctx.reply(
        `🔒 Account temporarily locked due to repeated unauthorized access attempts.\n\n` +
          `Try again in ${remainingMinutes} minute(s).`
      );
      return;
    }

    // Check rate limit
    if (isRateLimited(telegramId)) {
      await ctx.reply(
        `⏱ Rate limit exceeded. Please wait a moment before trying again.`
      );
      return;
    }

    // Check authorization
    const store = getGlobalStore();
    const user = store.getUser(telegramId);

    if (!user) {
      recordFailedAttempt(telegramId);

      const entry = lockouts.get(telegramId);
      const attemptsRemaining = LOCKOUT_THRESHOLD - (entry?.failedAttempts ?? 0);

      await ctx.reply(
        `❌ Unauthorized.\n\n` +
          `Contact an admin to request access.\n` +
          (attemptsRemaining > 0
            ? `(${attemptsRemaining} attempts remaining before lockout)`
            : ``)
      );
      return;
    }

    // Successful auth - clear any failed attempts
    clearFailedAttempts(telegramId);

    // Update last active timestamp
    store.touchUser(telegramId);

    // Attach user to context for downstream handlers
    (ctx as ContextWithUser).user = user;

    await next();
  };
}

/**
 * Role check middleware factory
 *
 * Creates middleware that verifies user has required role.
 */
export function requireRole(requiredRole: UserRole) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const user = (ctx as ContextWithUser).user;

    if (!user) {
      await ctx.reply('❌ Authentication required.');
      return;
    }

    if (!hasRequiredRole(user.role, requiredRole)) {
      await ctx.reply(
        `🚫 Permission denied.\n\n` +
          `This action requires ${requiredRole} role or higher.\n` +
          `Your role: ${user.role}`
      );
      return;
    }

    await next();
  };
}

/**
 * Admin-only middleware
 */
export function adminOnly() {
  return requireRole('admin');
}

/**
 * Operator or higher middleware
 */
export function operatorOnly() {
  return requireRole('operator');
}

// ============================================================================
// Context Extension
// ============================================================================

import type { AuthorizedUser } from '../core/global-store.js';

export interface ContextWithUser extends Context {
  user: AuthorizedUser;
}

/**
 * Type guard to check if context has user
 */
export function hasUser(ctx: Context): ctx is ContextWithUser {
  return 'user' in ctx && ctx.user !== undefined;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if action requires confirmation
 */
export function requiresConfirmation(action: string): boolean {
  const destructiveActions = [
    'delete',
    'remove',
    'stop',
    'reset',
    'clear',
    'archive',
    'reject',
  ];

  return destructiveActions.some((a) => action.toLowerCase().includes(a));
}

/**
 * Format user info for display
 */
export function formatUserInfo(user: AuthorizedUser): string {
  const parts = [user.displayName];

  if (user.username) {
    parts.push(`(@${user.username})`);
  }

  parts.push(`[${user.role}]`);

  return parts.join(' ');
}

/**
 * Get role emoji
 */
export function getRoleEmoji(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '👑';
    case 'operator':
      return '🔧';
    case 'viewer':
      return '👁';
    default:
      return '❓';
  }
}
