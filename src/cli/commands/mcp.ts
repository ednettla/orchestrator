import path from 'node:path';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { mcpConfigManager } from '../../core/mcp-config-manager.js';
import { credentialManager } from '../../core/credential-manager.js';
import { authFlowManager } from '../../core/auth-flow-manager.js';
import type { MCPServerConfig, MCPTransportType, MCPAuthType } from '../../core/mcp-types.js';

// ============================================================================
// MCP List Command
// ============================================================================

interface ListOptions {
  path: string;
  global?: boolean;
}

export async function mcpListCommand(options: ListOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold('\n🔌 MCP Server Configuration\n'));

  try {
    await credentialManager.initialize();

    const config = options.global
      ? await mcpConfigManager.loadGlobalConfig()
      : await mcpConfigManager.getMergedConfig(projectPath);

    const servers = Object.entries(config.mcpServers);

    if (servers.length === 0) {
      console.log(chalk.dim('No MCP servers configured.'));
      console.log();
      return;
    }

    // Table header
    console.log(
      chalk.dim('  Name'.padEnd(20)),
      chalk.dim('Type'.padEnd(8)),
      chalk.dim('Auth'.padEnd(10)),
      chalk.dim('Status')
    );
    console.log(chalk.dim('  ' + '─'.repeat(60)));

    for (const [name, server] of servers) {
      const enabled = server.enabled !== false;
      const authRequired = server.requiresAuth ?? false;

      let authStatus = '-';
      if (authRequired) {
        const hasCredentials = await credentialManager.hasCredential(
          name,
          server.scope === 'project' ? projectPath : undefined
        );
        authStatus = hasCredentials ? chalk.green('✓ Authorized') : chalk.yellow('⚠ Required');
      }

      const status = enabled ? chalk.green('Enabled') : chalk.dim('Disabled');

      console.log(
        `  ${name.padEnd(19)}`,
        chalk.cyan(server.type.padEnd(7)),
        authRequired ? chalk.yellow('Yes'.padEnd(9)) : chalk.dim('No'.padEnd(9)),
        authRequired && server.enabled !== false ? authStatus : status
      );
    }

    console.log();

    // Show helpful commands
    console.log(chalk.dim('Commands:'));
    console.log(chalk.dim('  orchestrate mcp auth <name>    Authorize a server for this project'));
    console.log(chalk.dim('  orchestrate mcp add <name>     Add a custom MCP server'));
    console.log(chalk.dim('  orchestrate mcp enable <name>  Enable an MCP server'));
    console.log(chalk.dim('  orchestrate mcp disable <name> Disable an MCP server'));
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

// ============================================================================
// MCP Auth Command
// ============================================================================

interface AuthOptions {
  path: string;
}

export async function mcpAuthCommand(serverName: string, options: AuthOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold(`\n🔐 Authorize MCP Server: ${serverName}\n`));

  try {
    await credentialManager.initialize();

    // Check if server exists
    const config = await mcpConfigManager.getMergedConfig(projectPath);
    const serverConfig = config.mcpServers[serverName];

    if (!serverConfig) {
      console.error(chalk.red(`Server "${serverName}" not found in configuration.`));
      console.log();
      console.log('Available servers:');
      for (const name of Object.keys(config.mcpServers)) {
        console.log(`  - ${name}`);
      }
      process.exit(1);
    }

    if (!serverConfig.requiresAuth) {
      console.log(chalk.yellow(`Server "${serverName}" does not require authentication.`));
      process.exit(0);
    }

    // Check if already authorized
    const hasCredentials = await credentialManager.hasCredential(
      serverName,
      serverConfig.scope === 'project' ? projectPath : undefined
    );

    if (hasCredentials) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          chalk.yellow('Server is already authorized. Re-authorize? (y/N): '),
          (ans) => resolve(ans.toLowerCase().trim())
        );
      });

      rl.close();

      if (answer !== 'y' && answer !== 'yes') {
        console.log(chalk.dim('Authorization cancelled.'));
        process.exit(0);
      }
    }

    // Run authorization flow
    console.log(chalk.cyan(`Starting ${serverConfig.authType ?? 'token'} authorization flow...`));
    console.log();

    const credential = await authFlowManager.authorize(serverName, serverConfig, projectPath);

    // Save credential
    await credentialManager.setCredential(
      serverName,
      credential,
      serverConfig.scope === 'project' ? projectPath : undefined
    );

    // Enable the server if it was disabled
    if (serverConfig.enabled === false) {
      await mcpConfigManager.setServerEnabled(serverName, true, projectPath);
      console.log(chalk.green(`\n✅ Server "${serverName}" authorized and enabled!`));
    } else {
      console.log(chalk.green(`\n✅ Server "${serverName}" authorized!`));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

// ============================================================================
// MCP Add Command
// ============================================================================

interface AddOptions {
  path: string;
  global?: boolean;
}

export async function mcpAddCommand(name: string, options: AddOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold(`\n➕ Add MCP Server: ${name}\n`));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Get transport type
    const transportType = await askQuestion(rl, 'Transport type (stdio/http/sse):', 'stdio');
    if (!['stdio', 'http', 'sse'].includes(transportType)) {
      throw new Error(`Invalid transport type: ${transportType}`);
    }

    const serverConfig: MCPServerConfig = {
      type: transportType as MCPTransportType,
      enabled: true,
    };

    if (transportType === 'stdio') {
      serverConfig.command = await askQuestion(rl, 'Command to run:', 'npx');
      const argsStr = await askQuestion(rl, 'Arguments (space-separated):', '');
      if (argsStr) {
        serverConfig.args = argsStr.split(' ').filter(Boolean);
      }
    } else {
      serverConfig.url = await askQuestion(rl, 'Server URL:', '');
      if (!serverConfig.url) {
        throw new Error('URL is required for http/sse transport');
      }
    }

    const requiresAuth = await askQuestion(rl, 'Requires authentication? (y/N):', 'n');
    if (requiresAuth.toLowerCase() === 'y' || requiresAuth.toLowerCase() === 'yes') {
      serverConfig.requiresAuth = true;
      const authType = await askQuestion(rl, 'Auth type (oauth/api_key/token):', 'api_key');
      if (['oauth', 'api_key', 'token'].includes(authType)) {
        serverConfig.authType = authType as MCPAuthType;
      }
    }

    const description = await askQuestion(rl, 'Description (optional):', '');
    if (description) {
      serverConfig.description = description;
    }

    rl.close();

    // Save the server config
    await mcpConfigManager.addServer(
      name,
      serverConfig,
      options.global ? undefined : projectPath
    );

    console.log(chalk.green(`\n✅ Server "${name}" added!`));

    if (serverConfig.requiresAuth) {
      console.log();
      console.log(chalk.dim('Run'), chalk.white(`orchestrate mcp auth ${name}`), chalk.dim('to authorize'));
    }
  } catch (error) {
    rl.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

// ============================================================================
// MCP Remove Command
// ============================================================================

interface RemoveOptions {
  path: string;
  global?: boolean;
}

export async function mcpRemoveCommand(name: string, options: RemoveOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold(`\n➖ Remove MCP Server: ${name}\n`));

  try {
    const config = options.global
      ? await mcpConfigManager.loadGlobalConfig()
      : await mcpConfigManager.getMergedConfig(projectPath);

    if (!config.mcpServers[name]) {
      console.error(chalk.red(`Server "${name}" not found.`));
      process.exit(1);
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        chalk.yellow(`Are you sure you want to remove "${name}"? (y/N): `),
        (ans) => resolve(ans.toLowerCase().trim())
      );
    });

    rl.close();

    if (answer !== 'y' && answer !== 'yes') {
      console.log(chalk.dim('Removal cancelled.'));
      process.exit(0);
    }

    // Remove credentials if they exist
    await credentialManager.initialize();
    await credentialManager.removeCredential(name, options.global ? undefined : projectPath);

    // Remove server from config
    await mcpConfigManager.removeServer(name, options.global ? undefined : projectPath);

    console.log(chalk.green(`\n✅ Server "${name}" removed!`));
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

// ============================================================================
// MCP Enable/Disable Commands
// ============================================================================

interface ToggleOptions {
  path: string;
  global?: boolean;
}

export async function mcpEnableCommand(name: string, options: ToggleOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  try {
    const config = await mcpConfigManager.getMergedConfig(projectPath);

    if (!config.mcpServers[name]) {
      console.error(chalk.red(`Server "${name}" not found.`));
      process.exit(1);
    }

    await mcpConfigManager.setServerEnabled(name, true, options.global ? undefined : projectPath);

    console.log(chalk.green(`\n✅ Server "${name}" enabled!`));

    // Check if auth is required
    const server = config.mcpServers[name];
    if (server.requiresAuth) {
      await credentialManager.initialize();
      const hasCredentials = await credentialManager.hasCredential(
        name,
        server.scope === 'project' ? projectPath : undefined
      );

      if (!hasCredentials) {
        console.log();
        console.log(
          chalk.yellow('⚠ Authorization required:'),
          chalk.white(`orchestrate mcp auth ${name}`)
        );
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

export async function mcpDisableCommand(name: string, options: ToggleOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  try {
    const config = await mcpConfigManager.getMergedConfig(projectPath);

    if (!config.mcpServers[name]) {
      console.error(chalk.red(`Server "${name}" not found.`));
      process.exit(1);
    }

    await mcpConfigManager.setServerEnabled(name, false, options.global ? undefined : projectPath);

    console.log(chalk.green(`\n✅ Server "${name}" disabled!`));
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function askQuestion(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue: string
): Promise<string> {
  return new Promise((resolve) => {
    const fullPrompt = defaultValue ? `${prompt} [${defaultValue}] ` : `${prompt} `;
    rl.question(fullPrompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}
