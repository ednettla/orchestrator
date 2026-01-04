/**
 * Authentication Middleware for WebApp API
 *
 * Validates Telegram initData and JWT tokens for API requests.
 *
 * @module webapp/middleware/auth
 */

import { createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getGlobalStore, type UserRole } from '../../../core/global-store.js';

// ============================================================================
// Types
// ============================================================================

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface InitData {
  query_id: string | undefined;
  user: TelegramUser | undefined;
  auth_date: number;
  hash: string;
  start_param: string | undefined;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    telegramId: number;
    displayName: string;
    role: UserRole;
  };
}

export interface JWTPayload {
  userId: string;
  telegramId: number;
  displayName: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

// ============================================================================
// Constants
// ============================================================================

const JWT_SECRET = process.env.ORCHESTRATOR_JWT_SECRET || 'orchestrator-webapp-secret';
const JWT_EXPIRY = '24h';
const MAX_AUTH_AGE_SECONDS = 86400; // 24 hours

// ============================================================================
// InitData Validation
// ============================================================================

/**
 * Parse Telegram initData string into structured object
 */
export function parseInitData(initDataStr: string): InitData | null {
  try {
    const params = new URLSearchParams(initDataStr);
    const hash = params.get('hash');
    const authDate = params.get('auth_date');

    if (!hash || !authDate) {
      return null;
    }

    const userStr = params.get('user');
    const user = userStr ? JSON.parse(userStr) as TelegramUser : undefined;

    return {
      query_id: params.get('query_id') ?? undefined,
      user,
      auth_date: parseInt(authDate, 10),
      hash,
      start_param: params.get('start_param') ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Validate Telegram initData hash
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initDataStr: string, botToken: string): boolean {
  try {
    const params = new URLSearchParams(initDataStr);
    const hash = params.get('hash');

    if (!hash) {
      return false;
    }

    // Remove hash from params and sort
    params.delete('hash');
    const dataCheckArr = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);
    const dataCheckString = dataCheckArr.join('\n');

    // Create secret key: HMAC-SHA256(bot_token, "WebAppData")
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Calculate hash: HMAC-SHA256(data_check_string, secret_key)
    const calculatedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return calculatedHash === hash;
  } catch {
    return false;
  }
}

/**
 * Check if auth_date is within acceptable time window
 */
export function isAuthDateValid(authDate: number, maxAgeSeconds: number = MAX_AUTH_AGE_SECONDS): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - authDate <= maxAgeSeconds;
}

// ============================================================================
// JWT Functions
// ============================================================================

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

// ============================================================================
// Express Middleware
// ============================================================================

/**
 * Middleware to authenticate requests via JWT Bearer token
 */
export function authenticateJWT(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' },
    });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    });
    return;
  }

  // Set user on request
  req.user = {
    id: payload.userId,
    telegramId: payload.telegramId,
    displayName: payload.displayName,
    role: payload.role,
  };

  next();
}

/**
 * Middleware to require a minimum role level
 */
export function requireRole(minRole: UserRole) {
  const roleHierarchy: Record<UserRole, number> = {
    viewer: 1,
    operator: 2,
    admin: 3,
  };

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const userRoleLevel = roleHierarchy[req.user.role] ?? 0;
    const minRoleLevel = roleHierarchy[minRole] ?? 0;
    if (userRoleLevel < minRoleLevel) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: `Requires ${minRole} role or higher` },
      });
      return;
    }

    next();
  };
}

/**
 * Authenticate user from initData and return JWT token
 */
export async function authenticateFromInitData(
  initDataStr: string
): Promise<{ success: true; token: string; user: JWTPayload } | { success: false; error: string }> {
  const store = getGlobalStore();
  const config = store.getConfig();

  if (!config.botToken) {
    return { success: false, error: 'Bot token not configured' };
  }

  // Validate initData hash
  if (!validateInitData(initDataStr, config.botToken)) {
    return { success: false, error: 'Invalid initData signature' };
  }

  // Parse initData
  const initData = parseInitData(initDataStr);
  if (!initData) {
    return { success: false, error: 'Failed to parse initData' };
  }

  // Check auth_date
  if (!isAuthDateValid(initData.auth_date)) {
    return { success: false, error: 'initData has expired' };
  }

  // Check user exists
  if (!initData.user) {
    return { success: false, error: 'No user in initData' };
  }

  // Look up authorized user
  const authorizedUser = store.getUser(initData.user.id);
  if (!authorizedUser) {
    return { success: false, error: 'User not authorized' };
  }

  // Update last active
  store.touchUser(initData.user.id);

  // Generate JWT
  const payload: JWTPayload = {
    userId: authorizedUser.id,
    telegramId: authorizedUser.telegramId,
    displayName: authorizedUser.displayName,
    role: authorizedUser.role,
  };

  const token = generateToken(payload);

  return { success: true, token, user: payload };
}
