// ============================================================================
// MCP Server Configuration Types
// ============================================================================

export type MCPTransportType = 'stdio' | 'sse' | 'http';
export type MCPAuthType = 'oauth' | 'api_key' | 'token';
export type MCPScope = 'global' | 'project';

/**
 * Configuration for an individual MCP server
 */
export interface MCPServerConfig {
  /** Transport type for the MCP server */
  type: MCPTransportType;

  /** Command to run (for stdio transport) */
  command?: string;

  /** Arguments for the command (for stdio transport) */
  args?: string[];

  /** URL for the server (for http/sse transport) */
  url?: string;

  /** Environment variables to pass to the server */
  env?: Record<string, string>;

  /** HTTP headers to include (for http/sse transport) */
  headers?: Record<string, string>;

  /** Whether this server requires authentication */
  requiresAuth?: boolean;

  /** Type of authentication required */
  authType?: MCPAuthType;

  /** Scope of the server configuration */
  scope?: MCPScope;

  /** Whether this server is enabled */
  enabled?: boolean;

  /** Human-readable description */
  description?: string;
}

/**
 * MCP configuration file structure
 */
export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Credentials for a single MCP server
 */
export interface MCPCredential {
  /** Supabase: project URL */
  projectUrl?: string;

  /** API key (for api_key auth) */
  apiKey?: string;

  /** Access token (for oauth/token auth) */
  accessToken?: string;

  /** Refresh token (for oauth auth) */
  refreshToken?: string;

  /** Token expiration time (ISO string) */
  expiresAt?: string;

  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Credentials storage structure
 */
export interface MCPCredentialsStore {
  /** Version for migration purposes */
  version: number;

  /** Credentials indexed by server name */
  servers: Record<string, MCPCredential>;

  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Runtime MCP config (with credentials resolved)
 */
export interface RuntimeMCPServerConfig {
  type: MCPTransportType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface RuntimeMCPConfig {
  mcpServers: Record<string, RuntimeMCPServerConfig>;
}

// ============================================================================
// Default MCP Server Configurations
// ============================================================================

export const DEFAULT_MCP_SERVERS: Record<string, MCPServerConfig> = {
  // Note: 'claude-in-chrome' is a reserved name in Claude CLI.
  // Chrome MCP is enabled via the --chrome flag instead.
  supabase: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic-ai/claude-code-mcp', 'supabase'],
    requiresAuth: true,
    authType: 'api_key',
    scope: 'project',
    enabled: false,
    description: 'Supabase database and auth integration',
  },
  vercel: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic-ai/claude-code-mcp', 'vercel'],
    requiresAuth: true,
    authType: 'token',
    scope: 'project',
    enabled: false,
    description: 'Vercel deployment and project management',
  },
};

// ============================================================================
// Validation
// ============================================================================

export function validateMCPConfig(config: unknown): config is MCPConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }

  const obj = config as Record<string, unknown>;
  if (typeof obj['mcpServers'] !== 'object' || obj['mcpServers'] === null) {
    return false;
  }

  const servers = obj['mcpServers'] as Record<string, unknown>;
  for (const [name, server] of Object.entries(servers)) {
    if (!validateMCPServerConfig(server)) {
      console.error(`Invalid MCP server config for "${name}"`);
      return false;
    }
  }

  return true;
}

export function validateMCPServerConfig(config: unknown): config is MCPServerConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }

  const obj = config as Record<string, unknown>;
  const type = obj['type'];

  if (type !== 'stdio' && type !== 'sse' && type !== 'http') {
    return false;
  }

  // stdio requires command
  if (type === 'stdio' && typeof obj['command'] !== 'string') {
    return false;
  }

  // http/sse requires url
  if ((type === 'http' || type === 'sse') && typeof obj['url'] !== 'string') {
    return false;
  }

  return true;
}
