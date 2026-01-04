/**
 * Telegram CLI Command
 *
 * Manage Telegram bot for remote control.
 *
 * Usage:
 *   orchestrate telegram setup         - Configure bot token
 *   orchestrate telegram start         - Start bot daemon
 *   orchestrate telegram stop          - Stop bot daemon
 *   orchestrate telegram status        - Show connection status
 *   orchestrate telegram add-user      - Add authorized user
 *   orchestrate telegram remove-user   - Remove authorized user
 *   orchestrate telegram list-users    - List authorized users
 *
 * @module cli/commands/telegram
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { input, select, confirm } from '@inquirer/prompts';
import { getGlobalStore, type UserRole, type AuthorizedUser } from '../../core/global-store.js';
import {
  spawnTelegramDaemon,
  getTelegramDaemonStatus,
  stopTelegramDaemon,
  tailTelegramLogs,
  formatElapsed,
} from '../telegram-daemon.js';
import { setupHttps } from './telegram-https.js';

const ROLES: UserRole[] = ['admin', 'operator', 'viewer'];

/**
 * Format role for display
 */
function formatRole(role: UserRole): string {
  switch (role) {
    case 'admin':
      return chalk.red(role);
    case 'operator':
      return chalk.yellow(role);
    case 'viewer':
      return chalk.blue(role);
    default:
      return role;
  }
}

/**
 * Format date for display
 */
function formatDate(date: Date | null): string {
  if (!date) return chalk.dim('never');

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

/**
 * Setup bot token
 */
async function setupCommand(): Promise<void> {
  const store = getGlobalStore();
  const config = store.getConfig();

  console.log(chalk.bold('\nTelegram Bot Setup\n'));

  if (config.botToken) {
    console.log(chalk.yellow('A bot token is already configured.'));
    const overwrite = await confirm({
      message: 'Overwrite existing token?',
      default: false,
    });

    if (!overwrite) {
      console.log(chalk.dim('Setup cancelled.'));
      return;
    }
  }

  console.log(chalk.dim('To get a bot token:'));
  console.log(chalk.dim('1. Open Telegram and message @BotFather'));
  console.log(chalk.dim('2. Send /newbot and follow the prompts'));
  console.log(chalk.dim('3. Copy the token provided\n'));

  const token = await input({
    message: 'Enter bot token:',
    validate: (value) => {
      if (!value.trim()) return 'Token is required';
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(value.trim())) {
        return 'Invalid token format';
      }
      return true;
    },
  });

  store.setBotToken(token.trim());
  console.log(chalk.green('\n✓ Bot token saved'));

  // Prompt to add first admin user
  const addAdmin = await confirm({
    message: 'Add yourself as admin user?',
    default: true,
  });

  if (addAdmin) {
    console.log(chalk.dim('\nTo find your Telegram ID:'));
    console.log(chalk.dim('1. Message @userinfobot on Telegram'));
    console.log(chalk.dim('2. It will reply with your ID\n'));

    const telegramId = await input({
      message: 'Your Telegram ID:',
      validate: (value) => {
        const id = parseInt(value.trim(), 10);
        if (isNaN(id) || id <= 0) return 'Invalid Telegram ID';
        return true;
      },
    });

    const displayName = await input({
      message: 'Your name:',
      default: 'Admin',
    });

    store.addUser(parseInt(telegramId.trim(), 10), displayName, 'admin');
    console.log(chalk.green(`\n✓ Added ${displayName} as admin`));
  }

  console.log(chalk.dim('\nStart the bot with: orchestrate telegram start'));
}

/**
 * Start bot daemon
 */
async function startCommand(options: { foreground?: boolean }): Promise<void> {
  const store = getGlobalStore();
  const config = store.getConfig();

  if (!config.botToken) {
    console.error(chalk.red('No bot token configured.'));
    console.log(chalk.dim('Run: orchestrate telegram setup'));
    process.exit(1);
  }

  const users = store.listUsers();
  if (users.length === 0) {
    console.error(chalk.red('No authorized users configured.'));
    console.log(chalk.dim('Run: orchestrate telegram add-user <telegram-id>'));
    process.exit(1);
  }

  if (options.foreground) {
    console.log(chalk.bold('\nStarting Telegram bot in foreground...\n'));
    console.log(chalk.dim('Press Ctrl+C to stop\n'));

    // Import and start bot
    try {
      const { startBot } = await import('../../telegram/index.js');
      await startBot();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        console.error(chalk.red('Telegram bot module not yet implemented.'));
        console.log(chalk.dim('This will be available after Phase 2 implementation.'));
        process.exit(1);
      }
      throw error;
    }
  } else {
    // Daemon mode - spawn detached process
    const result = spawnTelegramDaemon();
    if (result.success) {
      console.log(chalk.green(`\n✓ Telegram bot started (PID ${result.pid})`));
      console.log(chalk.dim('  View logs: orchestrate telegram logs'));
      console.log(chalk.dim('  Stop bot:  orchestrate telegram stop'));
    } else {
      console.error(chalk.red(`\n✗ Failed to start: ${result.error}`));
      process.exit(1);
    }
  }
}

/**
 * Stop bot daemon
 */
async function stopCommand(): Promise<void> {
  const result = stopTelegramDaemon();
  if (result.success) {
    console.log(chalk.green('✓ Telegram bot stopped'));
  } else {
    console.log(chalk.yellow(result.error ?? 'Bot is not running'));
  }
}

/**
 * Show bot status
 */
async function statusCommand(): Promise<void> {
  const store = getGlobalStore();
  const config = store.getConfig();

  console.log(chalk.bold('\nTelegram Bot Status\n'));

  // Token status
  if (config.botToken) {
    const maskedToken = config.botToken.substring(0, 10) + '...' + config.botToken.slice(-4);
    console.log(`${chalk.cyan('Token:')} ${chalk.green('configured')} (${maskedToken})`);
  } else {
    console.log(`${chalk.cyan('Token:')} ${chalk.red('not configured')}`);
  }

  // User count
  const users = store.listUsers();
  console.log(`${chalk.cyan('Users:')} ${users.length} authorized`);

  // Role breakdown
  const admins = users.filter((u: AuthorizedUser) => u.role === 'admin').length;
  const operators = users.filter((u: AuthorizedUser) => u.role === 'operator').length;
  const viewers = users.filter((u: AuthorizedUser) => u.role === 'viewer').length;
  console.log(chalk.dim(`  ${admins} admin, ${operators} operator, ${viewers} viewer`));

  // Notification level
  console.log(`${chalk.cyan('Notifications:')} ${config.notificationLevel}`);

  // Webhook status
  if (config.webhookUrl) {
    console.log(`${chalk.cyan('Mode:')} webhook (${config.webhookUrl})`);
  } else {
    console.log(`${chalk.cyan('Mode:')} polling`);
  }

  // Bot running status
  const daemonStatus = getTelegramDaemonStatus();
  if (daemonStatus.running && daemonStatus.info) {
    const elapsed = formatElapsed(daemonStatus.info.startedAt);
    console.log(`${chalk.cyan('Status:')} ${chalk.green('Running')}`);
    console.log(chalk.dim(`  PID: ${daemonStatus.info.pid}`));
    console.log(chalk.dim(`  Uptime: ${elapsed}`));
  } else {
    console.log(`${chalk.cyan('Status:')} ${chalk.dim('Stopped')}`);
  }

  console.log();
}

/**
 * Add authorized user
 */
async function addUserCommand(
  telegramId: string | undefined,
  options: { role?: string; name?: string }
): Promise<void> {
  const store = getGlobalStore();

  let id: number;
  let displayName: string;
  let role: UserRole;

  if (telegramId) {
    id = parseInt(telegramId, 10);
    if (isNaN(id) || id <= 0) {
      console.error(chalk.red('Invalid Telegram ID.'));
      process.exit(1);
    }
  } else {
    const idInput = await input({
      message: 'Telegram ID:',
      validate: (value) => {
        const parsed = parseInt(value.trim(), 10);
        if (isNaN(parsed) || parsed <= 0) return 'Invalid Telegram ID';
        return true;
      },
    });
    id = parseInt(idInput.trim(), 10);
  }

  // Check if user already exists
  const existing = store.getUser(id);
  if (existing) {
    console.error(chalk.yellow(`User ${id} already exists as ${existing.displayName} (${existing.role})`));
    const update = await confirm({
      message: 'Update existing user?',
      default: false,
    });
    if (!update) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }
  }

  if (options.name) {
    displayName = options.name;
  } else {
    displayName = await input({
      message: 'Display name:',
      default: existing?.displayName ?? 'User',
    });
  }

  if (options.role && ROLES.includes(options.role as UserRole)) {
    role = options.role as UserRole;
  } else {
    role = await select({
      message: 'Role:',
      choices: [
        { value: 'admin', name: 'admin - Full access + user management' },
        { value: 'operator', name: 'operator - Run commands, manage projects' },
        { value: 'viewer', name: 'viewer - Status and logs only' },
      ],
      default: existing?.role ?? 'operator',
    }) as UserRole;
  }

  if (existing) {
    store.updateUser(id, { displayName, role });
    console.log(chalk.green(`\n✓ Updated ${displayName} (${formatRole(role)})`));
  } else {
    store.addUser(id, displayName, role);
    console.log(chalk.green(`\n✓ Added ${displayName} (${formatRole(role)})`));
  }
}

/**
 * Remove authorized user
 */
async function removeUserCommand(
  telegramId: string | undefined,
  options: { force?: boolean }
): Promise<void> {
  const store = getGlobalStore();

  let id: number;

  if (telegramId) {
    id = parseInt(telegramId, 10);
    if (isNaN(id) || id <= 0) {
      console.error(chalk.red('Invalid Telegram ID.'));
      process.exit(1);
    }
  } else {
    // Interactive selection
    const users = store.listUsers();
    if (users.length === 0) {
      console.log(chalk.yellow('No users to remove.'));
      return;
    }

    const selected = await select({
      message: 'Select user to remove:',
      choices: users.map((u: AuthorizedUser) => ({
        value: u.telegramId,
        name: `${u.displayName} (${u.role}) - ID: ${u.telegramId}`,
      })),
    });
    id = selected as number;
  }

  const user = store.getUser(id);
  if (!user) {
    console.error(chalk.red(`User ${id} not found.`));
    process.exit(1);
  }

  // Check if this is the last admin
  const admins = store.listUsers().filter((u: AuthorizedUser) => u.role === 'admin');
  if (user.role === 'admin' && admins.length === 1) {
    console.error(chalk.red('Cannot remove the last admin user.'));
    process.exit(1);
  }

  if (!options.force) {
    const confirmed = await confirm({
      message: `Remove ${user.displayName} (${user.role})?`,
      default: false,
    });

    if (!confirmed) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }
  }

  store.removeUser(id);
  console.log(chalk.green(`✓ Removed ${user.displayName}`));
}

/**
 * List authorized users
 */
async function listUsersCommand(): Promise<void> {
  const store = getGlobalStore();
  const users = store.listUsers();

  if (users.length === 0) {
    console.log(chalk.yellow('\nNo authorized users.'));
    console.log(chalk.dim('Add users with: orchestrate telegram add-user'));
    return;
  }

  console.log(chalk.bold(`\nAuthorized Users (${users.length}):\n`));

  for (const user of users) {
    const username = user.username ? `@${user.username}` : '';
    const lastActive = formatDate(user.lastActiveAt);

    console.log(`  ${chalk.bold(user.displayName)} ${chalk.dim(username)}`);
    console.log(`    ${chalk.cyan('ID:')} ${user.telegramId}`);
    console.log(`    ${chalk.cyan('Role:')} ${formatRole(user.role)}`);
    console.log(`    ${chalk.cyan('Last active:')} ${lastActive}`);
    console.log();
  }
}

/**
 * Interactive telegram management
 */
export async function interactiveCommand(): Promise<void> {
  const store = getGlobalStore();

  while (true) {
    const config = store.getConfig();
    const users = store.listUsers();

    console.log(
      chalk.dim(`\nBot: ${config.botToken ? 'configured' : 'not configured'} | Users: ${users.length}`)
    );

    const daemonStatus = getTelegramDaemonStatus();
    const webappConfig = store.getWebAppConfig();
    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { value: 'status', name: 'Show status' },
        { value: 'setup', name: 'Setup bot token' },
        {
          value: 'start',
          name: daemonStatus.running ? 'Start bot (already running)' : 'Start bot',
        },
        { value: 'stop', name: 'Stop bot' },
        { value: 'logs', name: 'View logs' },
        { value: 'add-user', name: 'Add user' },
        { value: 'remove-user', name: 'Remove user' },
        { value: 'list-users', name: 'List users' },
        {
          value: 'setup-https',
          name: webappConfig.baseUrl?.startsWith('https://')
            ? `Setup HTTPS (configured: ${webappConfig.baseUrl})`
            : 'Setup HTTPS for Mini App',
        },
        { value: 'exit', name: 'Exit' },
      ],
    });

    if (action === 'exit') break;

    try {
      switch (action) {
        case 'status':
          await statusCommand();
          break;
        case 'setup':
          await setupCommand();
          break;
        case 'start':
          await startCommand({}); // Use daemon mode by default
          break;
        case 'stop':
          await stopCommand();
          break;
        case 'logs':
          await tailTelegramLogs({ lines: 50, follow: false });
          break;
        case 'add-user':
          await addUserCommand(undefined, {});
          break;
        case 'remove-user':
          await removeUserCommand(undefined, {});
          break;
        case 'list-users':
          await listUsersCommand();
          break;
        case 'setup-https':
          await setupHttps();
          break;
      }
    } catch (error) {
      if ((error as { name?: string }).name === 'ExitPromptError') {
        break;
      }
      console.error(
        chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }
}

/**
 * Register telegram command
 */
export function registerTelegramCommand(program: Command): void {
  const telegram = program
    .command('telegram')
    .description('Manage Telegram bot for remote control');

  telegram
    .command('setup')
    .description('Configure bot token from @BotFather')
    .action(setupCommand);

  telegram
    .command('start')
    .description('Start the Telegram bot')
    .option('-f, --foreground', 'Run in foreground (default: daemon)')
    .action(startCommand);

  telegram
    .command('stop')
    .description('Stop the Telegram bot daemon')
    .action(stopCommand);

  telegram
    .command('status')
    .description('Show bot connection status')
    .action(statusCommand);

  telegram
    .command('add-user [telegram-id]')
    .description('Add an authorized user')
    .option('-r, --role <role>', 'User role (admin|operator|viewer)')
    .option('-n, --name <name>', 'Display name')
    .action(addUserCommand);

  telegram
    .command('remove-user [telegram-id]')
    .description('Remove an authorized user')
    .option('-f, --force', 'Skip confirmation')
    .action(removeUserCommand);

  telegram
    .command('list-users')
    .description('List all authorized users')
    .action(listUsersCommand);

  telegram
    .command('logs')
    .description('View Telegram bot logs')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output (like tail -f)')
    .action(async (opts) => {
      await tailTelegramLogs({
        lines: parseInt(opts.lines, 10),
        follow: opts.follow,
      });
    });

  telegram
    .command('interactive')
    .alias('i')
    .description('Interactive telegram management')
    .action(interactiveCommand);

  telegram
    .command('setup-https')
    .description('Setup HTTPS with Let\'s Encrypt for Mini App')
    .action(setupHttps);

  telegram
    .command('config [key] [value]')
    .description('View or set telegram config (webapp_enabled, webapp_port, webapp_base_url)')
    .action(async (key?: string, value?: string) => {
      const store = getGlobalStore();

      if (!key) {
        // Show all config
        const config = store.getConfig();
        const webappConfig = store.getWebAppConfig();

        console.log(chalk.bold('\nTelegram Configuration\n'));
        console.log(`${chalk.cyan('Bot Token:')} ${config.botToken ? chalk.green('configured') : chalk.red('not set')}`);
        console.log(`${chalk.cyan('Notification Level:')} ${config.notificationLevel}`);
        console.log();
        console.log(chalk.bold('WebApp Settings'));
        console.log(`${chalk.cyan('webapp_enabled:')} ${webappConfig.enabled}`);
        console.log(`${chalk.cyan('webapp_port:')} ${webappConfig.port}`);
        console.log(`${chalk.cyan('webapp_base_url:')} ${webappConfig.baseUrl ?? chalk.dim('not set')}`);
        console.log();
        return;
      }

      if (!value) {
        // Show single key
        const webappConfig = store.getWebAppConfig();
        switch (key) {
          case 'webapp_enabled':
            console.log(webappConfig.enabled);
            break;
          case 'webapp_port':
            console.log(webappConfig.port);
            break;
          case 'webapp_base_url':
            console.log(webappConfig.baseUrl ?? '');
            break;
          default:
            console.error(chalk.red(`Unknown key: ${key}`));
        }
        return;
      }

      // Set value
      switch (key) {
        case 'webapp_enabled':
          store.setWebAppEnabled(value === 'true');
          console.log(chalk.green(`✓ webapp_enabled = ${value}`));
          break;
        case 'webapp_port':
          store.setWebAppPort(parseInt(value, 10));
          console.log(chalk.green(`✓ webapp_port = ${value}`));
          break;
        case 'webapp_base_url':
          store.setWebAppBaseUrl(value === 'null' ? null : value);
          console.log(chalk.green(`✓ webapp_base_url = ${value}`));
          break;
        default:
          console.error(chalk.red(`Unknown key: ${key}`));
      }
    });

  // Default to interactive if no subcommand
  telegram.action(async () => {
    await interactiveCommand();
  });
}
