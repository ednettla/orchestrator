import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import chalk from 'chalk';
import type { MCPServerConfig, MCPCredential } from './mcp-types.js';
import { credentialManager } from './credential-manager.js';

// ============================================================================
// Types
// ============================================================================

export type AuthScope = 'global' | 'project';

export interface AuthOptions {
  /** Whether to use global-first auth pattern (auth once, use everywhere) */
  preferGlobal?: boolean | undefined;
  /** Force auth to specific scope */
  forceScope?: AuthScope | undefined;
  /** Project path (required for project scope) */
  projectPath?: string | undefined;
}

// ============================================================================
// Auth Flow Manager
// ============================================================================

/**
 * Manages authorization flows for MCP servers.
 * Supports:
 * - API key: Simple prompt for API key/secret
 * - Token: Prompt for access token
 * - OAuth: Browser-based OAuth flow with local callback server
 */
export class AuthFlowManager {
  /**
   * Run the appropriate authorization flow for a server
   */
  async authorize(
    serverName: string,
    config: MCPServerConfig,
    projectPath: string
  ): Promise<MCPCredential> {
    switch (config.authType) {
      case 'api_key':
        return this.apiKeyFlow(serverName);
      case 'token':
        return this.tokenFlow(serverName);
      case 'oauth':
        return this.oauthFlow(serverName, config);
      default:
        return this.tokenFlow(serverName);
    }
  }

  /**
   * Authorize with global-first pattern
   *
   * This method implements the "auth once, use everywhere" pattern:
   * 1. First check if global credentials exist
   * 2. If not, run auth flow and optionally save globally
   * 3. Return credentials for use in any project
   */
  async authorizeGlobalFirst(
    serverName: string,
    config: MCPServerConfig,
    options: AuthOptions = {}
  ): Promise<MCPCredential> {
    await credentialManager.initialize();

    const projectPath = options.projectPath;
    const preferGlobal = options.preferGlobal ?? true;
    const forceScope = options.forceScope;

    // Check for existing credentials
    const existingCredential = await credentialManager.getCredential(serverName, projectPath);

    if (existingCredential && !credentialManager.isCredentialExpired(existingCredential)) {
      console.log(chalk.green(`Using existing credentials for ${serverName}`));
      return existingCredential;
    }

    // Run auth flow
    const credential = await this.authorize(serverName, config, projectPath ?? process.cwd());

    // Determine where to save
    let scope: AuthScope;

    if (forceScope) {
      scope = forceScope;
    } else if (preferGlobal) {
      // Ask user if they want to save globally
      scope = await this.askScopePreference(serverName);
    } else {
      scope = projectPath ? 'project' : 'global';
    }

    // Save credential to appropriate scope
    if (scope === 'global') {
      await credentialManager.setCredential(serverName, credential);
      console.log(chalk.green(`Credentials saved globally for ${serverName}`));
    } else if (projectPath) {
      await credentialManager.setCredential(serverName, credential, projectPath);
      console.log(chalk.green(`Credentials saved for ${serverName} in this project`));
    }

    return credential;
  }

  /**
   * Ask user where they want to save credentials
   */
  private async askScopePreference(serverName: string): Promise<AuthScope> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log();
    console.log(chalk.cyan('Where should these credentials be saved?'));
    console.log(chalk.dim('1. Global (use in all projects)'));
    console.log(chalk.dim('2. Project only (use in this project only)'));
    console.log();

    const answer = await this.askQuestion(rl, 'Choice [1/2]:');
    rl.close();

    if (answer === '2') {
      return 'project';
    }

    return 'global';
  }

  /**
   * Check if credentials exist for a server (globally or in project)
   */
  async hasCredentials(serverName: string, projectPath?: string): Promise<boolean> {
    await credentialManager.initialize();
    return credentialManager.hasCredential(serverName, projectPath);
  }

  /**
   * Get credentials for a server (global-first lookup)
   */
  async getCredentials(serverName: string, projectPath?: string): Promise<MCPCredential | null> {
    await credentialManager.initialize();
    return credentialManager.getCredential(serverName, projectPath);
  }

  /**
   * List all servers with credentials
   */
  async listCredentialedServers(projectPath?: string): Promise<string[]> {
    await credentialManager.initialize();
    return credentialManager.listCredentialedServers(projectPath);
  }

  /**
   * API Key authorization flow
   * Prompts user for API key and optionally project URL
   */
  private async apiKeyFlow(serverName: string): Promise<MCPCredential> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.cyan('API Key Authorization'));
    console.log(chalk.dim('Enter your API credentials for'), serverName);
    console.log();

    const credential: MCPCredential = {};

    // Server-specific prompts
    if (serverName === 'supabase') {
      credential.projectUrl = await this.askQuestion(rl, 'Supabase Project URL:');
      if (!credential.projectUrl) {
        throw new Error('Project URL is required');
      }
      credential.apiKey = await this.askQuestion(rl, 'Supabase API Key (anon or service_role):');
    } else {
      credential.apiKey = await this.askQuestion(rl, 'API Key:');
    }

    if (!credential.apiKey) {
      throw new Error('API Key is required');
    }

    rl.close();
    return credential;
  }

  /**
   * Token authorization flow
   * Prompts user for access token
   */
  private async tokenFlow(serverName: string): Promise<MCPCredential> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.cyan('Token Authorization'));
    console.log(chalk.dim('Enter your access token for'), serverName);
    console.log();

    // Server-specific instructions
    if (serverName === 'vercel') {
      console.log(chalk.dim('To get a Vercel token:'));
      console.log(chalk.dim('1. Go to https://vercel.com/account/tokens'));
      console.log(chalk.dim('2. Create a new token'));
      console.log(chalk.dim('3. Copy and paste it below'));
      console.log();
    }

    const accessToken = await this.askQuestion(rl, 'Access Token:');

    if (!accessToken) {
      throw new Error('Access token is required');
    }

    rl.close();

    return {
      accessToken,
    };
  }

  /**
   * OAuth authorization flow
   * Opens browser for OAuth and listens for callback
   */
  private async oauthFlow(
    serverName: string,
    config: MCPServerConfig
  ): Promise<MCPCredential> {
    console.log(chalk.cyan('OAuth Authorization'));
    console.log(chalk.dim('Opening browser for authorization...'));
    console.log();

    // For now, fall back to token flow since OAuth requires
    // server-specific configuration (client ID, client secret, etc.)
    console.log(chalk.yellow('OAuth flow is not yet fully implemented.'));
    console.log(chalk.yellow('Please provide an access token instead.'));
    console.log();

    return this.tokenFlow(serverName);
  }

  /**
   * Full OAuth implementation (for future use)
   * This would require storing OAuth client credentials per-server
   */
  private async fullOauthFlow(
    authUrl: string,
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
    scopes: string[]
  ): Promise<MCPCredential> {
    return new Promise((resolve, reject) => {
      const callbackPort = 9876;
      const callbackPath = '/oauth/callback';
      const redirectUri = `http://localhost:${callbackPort}${callbackPath}`;

      // Build authorization URL
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state: Math.random().toString(36).substring(7),
      });

      const fullAuthUrl = `${authUrl}?${params.toString()}`;

      // Create local server to receive callback
      const server = createServer(async (req, res) => {
        if (!req.url?.startsWith(callbackPath)) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const url = new URL(req.url, `http://localhost:${callbackPort}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400);
          res.end(`Authorization failed: ${error}`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end('No authorization code received');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        try {
          // Exchange code for tokens
          const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
              client_secret: clientSecret,
            }),
          });

          if (!tokenResponse.ok) {
            throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
          }

          const tokens = await tokenResponse.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
          };

          const credential: MCPCredential = {
            accessToken: tokens.access_token,
          };

          if (tokens.refresh_token) {
            credential.refreshToken = tokens.refresh_token;
          }

          if (tokens.expires_in) {
            const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
            credential.expiresAt = expiresAt.toISOString();
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);

          server.close();
          resolve(credential);
        } catch (err) {
          res.writeHead(500);
          res.end('Token exchange failed');
          server.close();
          reject(err);
        }
      });

      server.listen(callbackPort, () => {
        console.log(chalk.dim(`Listening for OAuth callback on port ${callbackPort}...`));

        // Open browser (cross-platform)
        this.openBrowser(fullAuthUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth flow timed out'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Helper to ask a question and get a response
   */
  private askQuestion(
    rl: ReturnType<typeof createInterface>,
    prompt: string
  ): Promise<string> {
    return new Promise((resolve) => {
      rl.question(chalk.bold(`  ${prompt} `), (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Open a URL in the default browser (cross-platform)
   */
  private openBrowser(url: string): void {
    const platform = process.platform;
    let command: string;
    let args: string[];

    switch (platform) {
      case 'darwin':
        command = 'open';
        args = [url];
        break;
      case 'win32':
        command = 'cmd';
        args = ['/c', 'start', '', url];
        break;
      default:
        command = 'xdg-open';
        args = [url];
    }

    execFile(command, args, (error) => {
      if (error) {
        console.log(chalk.yellow('\nCould not open browser automatically.'));
        console.log(chalk.yellow('Please open this URL manually:'));
        console.log(chalk.white(url));
      }
    });
  }

  /**
   * Refresh an expired OAuth token
   */
  async refreshToken(
    serverName: string,
    credential: MCPCredential,
    config: MCPServerConfig
  ): Promise<MCPCredential | null> {
    if (!credential.refreshToken) {
      return null;
    }

    // This would require server-specific token refresh endpoints
    // For now, return null to indicate refresh is not available
    console.log(chalk.yellow(`Token refresh not yet implemented for ${serverName}`));
    return null;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const authFlowManager = new AuthFlowManager();
