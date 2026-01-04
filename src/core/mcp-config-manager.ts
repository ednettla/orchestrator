import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  MCPConfig,
  MCPServerConfig,
  RuntimeMCPConfig,
  MCPCredential,
} from './mcp-types.js';
import { DEFAULT_MCP_SERVERS, validateMCPConfig } from './mcp-types.js';

// Reserved MCP server names that Claude CLI handles internally
// These should never be passed via --mcp-config
const RESERVED_MCP_NAMES = new Set(['claude-in-chrome']);

// ============================================================================
// MCP Config Manager
// ============================================================================

export class MCPConfigManager {
  private globalConfigPath: string;
  private cachedGlobalConfig: MCPConfig | null = null;
  private cachedProjectConfigs: Map<string, MCPConfig> = new Map();

  constructor() {
    this.globalConfigPath = path.join(os.homedir(), '.orchestrator', 'mcp.json');
  }

  /**
   * Ensure global config directory and file exist with defaults
   */
  async ensureGlobalConfig(): Promise<void> {
    const dir = path.dirname(this.globalConfigPath);

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    if (!existsSync(this.globalConfigPath)) {
      const defaultConfig: MCPConfig = {
        mcpServers: { ...DEFAULT_MCP_SERVERS },
      };
      await writeFile(this.globalConfigPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    }
  }

  /**
   * Get the path to the project MCP config file
   */
  getProjectConfigPath(projectPath: string): string {
    return path.join(projectPath, '.orchestrator', 'mcp.json');
  }

  /**
   * Load global MCP configuration
   */
  async loadGlobalConfig(): Promise<MCPConfig> {
    if (this.cachedGlobalConfig) {
      return this.cachedGlobalConfig;
    }

    await this.ensureGlobalConfig();

    try {
      const content = await readFile(this.globalConfigPath, 'utf-8');
      const config = JSON.parse(content) as unknown;

      if (!validateMCPConfig(config)) {
        throw new Error('Invalid global MCP config format');
      }

      this.cachedGlobalConfig = config;
      return config;
    } catch (error) {
      // Return default config on error
      const defaultConfig: MCPConfig = {
        mcpServers: { ...DEFAULT_MCP_SERVERS },
      };
      this.cachedGlobalConfig = defaultConfig;
      return defaultConfig;
    }
  }

  /**
   * Load project-specific MCP configuration
   */
  async loadProjectConfig(projectPath: string): Promise<MCPConfig | null> {
    if (this.cachedProjectConfigs.has(projectPath)) {
      return this.cachedProjectConfigs.get(projectPath) ?? null;
    }

    const configPath = this.getProjectConfigPath(projectPath);

    if (!existsSync(configPath)) {
      return null;
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content) as unknown;

      if (!validateMCPConfig(config)) {
        console.error('Invalid project MCP config format');
        return null;
      }

      this.cachedProjectConfigs.set(projectPath, config);
      return config;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get merged configuration (global + project overrides)
   */
  async getMergedConfig(projectPath: string): Promise<MCPConfig> {
    const globalConfig = await this.loadGlobalConfig();
    const projectConfig = await this.loadProjectConfig(projectPath);

    if (!projectConfig) {
      return globalConfig;
    }

    // Merge: project config overrides global
    const merged: MCPConfig = {
      mcpServers: {
        ...globalConfig.mcpServers,
        ...projectConfig.mcpServers,
      },
    };

    return merged;
  }

  /**
   * Get list of enabled MCP servers for a project
   */
  async getEnabledServers(projectPath: string): Promise<Record<string, MCPServerConfig>> {
    const config = await this.getMergedConfig(projectPath);
    const enabled: Record<string, MCPServerConfig> = {};

    for (const [name, server] of Object.entries(config.mcpServers)) {
      if (server.enabled !== false) {
        enabled[name] = server;
      }
    }

    return enabled;
  }

  /**
   * Generate runtime MCP config with credentials resolved
   */
  async generateRuntimeConfig(
    projectPath: string,
    credentials: Record<string, MCPCredential>,
    serverFilter?: string[]
  ): Promise<RuntimeMCPConfig> {
    const config = await this.getMergedConfig(projectPath);
    const runtimeConfig: RuntimeMCPConfig = {
      mcpServers: {},
    };

    for (const [name, server] of Object.entries(config.mcpServers)) {
      // Skip reserved MCP names (handled internally by Claude CLI)
      if (RESERVED_MCP_NAMES.has(name)) {
        continue;
      }

      // Skip if not in filter (if filter provided)
      if (serverFilter && !serverFilter.includes(name)) {
        continue;
      }

      // Skip disabled servers
      if (server.enabled === false) {
        continue;
      }

      // Skip servers requiring auth that don't have credentials
      if (server.requiresAuth && !credentials[name]) {
        continue;
      }

      const runtimeServer = this.resolveServerConfig(server, credentials[name]);
      if (runtimeServer) {
        runtimeConfig.mcpServers[name] = runtimeServer;
      }
    }

    return runtimeConfig;
  }

  /**
   * Resolve a server config with credentials
   */
  private resolveServerConfig(
    server: MCPServerConfig,
    credential?: MCPCredential
  ): RuntimeMCPConfig['mcpServers'][string] | null {
    const resolved: RuntimeMCPConfig['mcpServers'][string] = {
      type: server.type,
    };

    if (server.type === 'stdio') {
      if (!server.command) {
        return null; // stdio requires command
      }
      resolved.command = server.command;
      resolved.args = [...(server.args ?? [])];

      // Inject credentials as environment variables
      resolved.env = { ...server.env };
      if (credential) {
        if (credential.accessToken) {
          resolved.env['MCP_ACCESS_TOKEN'] = credential.accessToken;
        }
        if (credential.apiKey) {
          resolved.env['MCP_API_KEY'] = credential.apiKey;
        }
        if (credential.projectUrl) {
          resolved.env['MCP_PROJECT_URL'] = credential.projectUrl;
        }
      }
    } else if (server.type === 'http' || server.type === 'sse') {
      if (!server.url) {
        return null; // http/sse requires url
      }
      resolved.url = server.url;
      resolved.headers = { ...server.headers };

      // Add auth header if we have a token
      if (credential?.accessToken) {
        resolved.headers['Authorization'] = `Bearer ${credential.accessToken}`;
      }
    }

    return resolved;
  }

  /**
   * Write runtime config to a temporary file
   */
  async writeRuntimeConfig(projectPath: string, config: RuntimeMCPConfig): Promise<string> {
    const orchestratorDir = path.join(projectPath, '.orchestrator');
    if (!existsSync(orchestratorDir)) {
      await mkdir(orchestratorDir, { recursive: true });
    }

    const runtimePath = path.join(orchestratorDir, 'runtime-mcp.json');
    await writeFile(runtimePath, JSON.stringify(config, null, 2), 'utf-8');
    return runtimePath;
  }

  /**
   * Save project MCP configuration
   */
  async saveProjectConfig(projectPath: string, config: MCPConfig): Promise<void> {
    const configPath = this.getProjectConfigPath(projectPath);
    const dir = path.dirname(configPath);

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.cachedProjectConfigs.set(projectPath, config);
  }

  /**
   * Save global MCP configuration
   */
  async saveGlobalConfig(config: MCPConfig): Promise<void> {
    await this.ensureGlobalConfig();
    await writeFile(this.globalConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    this.cachedGlobalConfig = config;
  }

  /**
   * Enable or disable an MCP server
   */
  async setServerEnabled(
    serverName: string,
    enabled: boolean,
    projectPath?: string
  ): Promise<void> {
    if (projectPath) {
      const config = await this.loadProjectConfig(projectPath) ?? { mcpServers: {} };
      const existingServer = config.mcpServers[serverName];
      if (existingServer) {
        existingServer.enabled = enabled;
      } else {
        // Server doesn't exist in project config, check global and copy
        const globalConfig = await this.loadGlobalConfig();
        const globalServer = globalConfig.mcpServers[serverName];
        if (globalServer) {
          config.mcpServers[serverName] = { ...globalServer, enabled };
        }
      }
      await this.saveProjectConfig(projectPath, config);
    } else {
      const config = await this.loadGlobalConfig();
      if (config.mcpServers[serverName]) {
        config.mcpServers[serverName].enabled = enabled;
        await this.saveGlobalConfig(config);
      }
    }
  }

  /**
   * Add a custom MCP server
   */
  async addServer(
    name: string,
    config: MCPServerConfig,
    projectPath?: string
  ): Promise<void> {
    if (projectPath) {
      const projectConfig = await this.loadProjectConfig(projectPath) ?? { mcpServers: {} };
      projectConfig.mcpServers[name] = config;
      await this.saveProjectConfig(projectPath, projectConfig);
    } else {
      const globalConfig = await this.loadGlobalConfig();
      globalConfig.mcpServers[name] = config;
      await this.saveGlobalConfig(globalConfig);
    }
  }

  /**
   * Remove an MCP server
   */
  async removeServer(name: string, projectPath?: string): Promise<void> {
    if (projectPath) {
      const projectConfig = await this.loadProjectConfig(projectPath);
      if (projectConfig?.mcpServers[name]) {
        delete projectConfig.mcpServers[name];
        await this.saveProjectConfig(projectPath, projectConfig);
      }
    } else {
      const globalConfig = await this.loadGlobalConfig();
      if (globalConfig.mcpServers[name]) {
        delete globalConfig.mcpServers[name];
        await this.saveGlobalConfig(globalConfig);
      }
    }
  }

  /**
   * Clear caches (useful for testing or reloading)
   */
  clearCaches(): void {
    this.cachedGlobalConfig = null;
    this.cachedProjectConfigs.clear();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const mcpConfigManager = new MCPConfigManager();
