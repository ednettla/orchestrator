/**
 * Secrets CLI Command
 *
 * Manage environment-based secrets for projects.
 *
 * Usage:
 *   orchestrate secrets set <env>.<key> <value>
 *   orchestrate secrets get <env>.<key> [--reveal]
 *   orchestrate secrets list [env] [--all]
 *   orchestrate secrets delete <env>.<key>
 *   orchestrate secrets export <env> [--output <file>]
 *   orchestrate secrets import <file> --env <env>
 *
 * @module cli/commands/secrets
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { input, select, confirm } from '@inquirer/prompts';
import { createSecretsManager, type SecretEnvironment } from '../../core/secrets-manager.js';

const VALID_ENVIRONMENTS: SecretEnvironment[] = ['development', 'staging', 'production'];

/**
 * Parse environment.key format
 */
function parseEnvKey(envKey: string): { env: SecretEnvironment; key: string } | null {
  const parts = envKey.split('.');
  if (parts.length !== 2) return null;

  const [env, key] = parts;
  if (!VALID_ENVIRONMENTS.includes(env as SecretEnvironment)) return null;
  if (!key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return null;

  return { env: env as SecretEnvironment, key };
}

/**
 * Mask a secret value for display
 */
function maskValue(value: string): string {
  if (value.length <= 8) {
    return '••••••••';
  }
  return value.substring(0, 4) + '••••' + value.substring(value.length - 4);
}

/**
 * Set a secret
 */
async function setCommand(
  envKey: string,
  value: string | undefined,
  options: { path?: string | undefined; service?: string | undefined; description?: string | undefined }
): Promise<void> {
  const projectPath = options.path ?? process.cwd();
  const parsed = parseEnvKey(envKey);

  if (!parsed) {
    console.error(chalk.red('Invalid format. Use: <environment>.<key>'));
    console.error(chalk.dim('Environments: development, staging, production'));
    console.error(chalk.dim('Example: production.supabase_url'));
    process.exit(1);
  }

  // If value not provided, prompt for it
  let secretValue = value;
  if (!secretValue) {
    secretValue = await input({
      message: `Enter value for ${parsed.env}.${parsed.key}:`,
    });
  }

  const manager = createSecretsManager(projectPath);
  manager.setSecret(parsed.env, parsed.key, secretValue, {
    service: options.service,
    description: options.description,
  });

  console.log(chalk.green(`✓ Set ${parsed.env}.${parsed.key}`));
}

/**
 * Get a secret
 */
async function getCommand(
  envKey: string,
  options: { path?: string; reveal?: boolean }
): Promise<void> {
  const projectPath = options.path ?? process.cwd();
  const parsed = parseEnvKey(envKey);

  if (!parsed) {
    console.error(chalk.red('Invalid format. Use: <environment>.<key>'));
    process.exit(1);
  }

  const manager = createSecretsManager(projectPath);
  const value = manager.getSecret(parsed.env, parsed.key);

  if (!value) {
    console.log(chalk.yellow(`Secret not found: ${parsed.env}.${parsed.key}`));
    process.exit(1);
  }

  if (options.reveal) {
    console.log(value);
  } else {
    console.log(maskValue(value));
    console.log(chalk.dim('Use --reveal to show full value'));
  }
}

/**
 * List secrets
 */
async function listCommand(
  env: string | undefined,
  options: { path?: string; all?: boolean }
): Promise<void> {
  const projectPath = options.path ?? process.cwd();
  const manager = createSecretsManager(projectPath);

  const environments: SecretEnvironment[] =
    options.all || !env
      ? VALID_ENVIRONMENTS
      : [env as SecretEnvironment];

  if (env && !VALID_ENVIRONMENTS.includes(env as SecretEnvironment)) {
    console.error(chalk.red(`Invalid environment: ${env}`));
    console.error(chalk.dim('Valid environments: development, staging, production'));
    process.exit(1);
  }

  let hasSecrets = false;

  for (const e of environments) {
    const keys = manager.listSecretKeys(e);
    if (keys.length === 0) continue;

    hasSecrets = true;
    console.log(chalk.bold(`\n${e}:`));

    for (const key of keys) {
      const def = manager.getSecretDefinition(e, key);
      const serviceBadge = def?.service ? chalk.dim(` [${def.service}]`) : '';
      console.log(`  ${chalk.cyan(key)}${serviceBadge}`);
    }
  }

  if (!hasSecrets) {
    console.log(chalk.yellow('No secrets found.'));
    console.log(chalk.dim('Add secrets with: orchestrate secrets set <env>.<key> <value>'));
  }
}

/**
 * Delete a secret
 */
async function deleteCommand(
  envKey: string,
  options: { path?: string; force?: boolean }
): Promise<void> {
  const projectPath = options.path ?? process.cwd();
  const parsed = parseEnvKey(envKey);

  if (!parsed) {
    console.error(chalk.red('Invalid format. Use: <environment>.<key>'));
    process.exit(1);
  }

  const manager = createSecretsManager(projectPath);
  const exists = manager.getSecret(parsed.env, parsed.key);

  if (!exists) {
    console.log(chalk.yellow(`Secret not found: ${parsed.env}.${parsed.key}`));
    return;
  }

  if (!options.force) {
    const confirmed = await confirm({
      message: `Delete ${parsed.env}.${parsed.key}?`,
      default: false,
    });

    if (!confirmed) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }
  }

  manager.deleteSecret(parsed.env, parsed.key);
  console.log(chalk.green(`✓ Deleted ${parsed.env}.${parsed.key}`));
}

/**
 * Export secrets to .env file
 */
async function exportCommand(
  env: string,
  options: { path?: string; output?: string }
): Promise<void> {
  const projectPath = options.path ?? process.cwd();

  if (!VALID_ENVIRONMENTS.includes(env as SecretEnvironment)) {
    console.error(chalk.red(`Invalid environment: ${env}`));
    process.exit(1);
  }

  const manager = createSecretsManager(projectPath);
  const outputPath = options.output ?? `.env.${env}`;

  const content = manager.exportToEnvFile(env as SecretEnvironment, outputPath);
  const lineCount = content.split('\n').filter((l: string) => l && !l.startsWith('#')).length;

  console.log(chalk.green(`✓ Exported ${lineCount} secrets to ${outputPath}`));
}

/**
 * Import secrets from .env file
 */
async function importCommand(
  file: string,
  options: { path?: string; env: string }
): Promise<void> {
  const projectPath = options.path ?? process.cwd();

  if (!VALID_ENVIRONMENTS.includes(options.env as SecretEnvironment)) {
    console.error(chalk.red(`Invalid environment: ${options.env}`));
    process.exit(1);
  }

  const manager = createSecretsManager(projectPath);

  try {
    const count = manager.importFromEnvFile(file, options.env as SecretEnvironment);
    console.log(chalk.green(`✓ Imported ${count} secrets to ${options.env}`));
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

/**
 * Interactive secrets management
 */
async function interactiveCommand(options: { path?: string }): Promise<void> {
  const projectPath = options.path ?? process.cwd();
  const manager = createSecretsManager(projectPath);

  while (true) {
    const counts = manager.getSecretCounts();
    console.log(chalk.dim(`\nSecrets: dev(${counts.development}) staging(${counts.staging}) prod(${counts.production})`));

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { value: 'list', name: 'List secrets' },
        { value: 'set', name: 'Set a secret' },
        { value: 'get', name: 'Get a secret' },
        { value: 'delete', name: 'Delete a secret' },
        { value: 'export', name: 'Export to .env file' },
        { value: 'import', name: 'Import from .env file' },
        { value: 'exit', name: 'Exit' },
      ],
    });

    if (action === 'exit') break;

    try {
      switch (action) {
        case 'list': {
          const env = await select({
            message: 'Which environment?',
            choices: [
              { value: 'all', name: 'All environments' },
              ...VALID_ENVIRONMENTS.map(e => ({ value: e, name: e })),
            ],
          });
          await listCommand(env === 'all' ? undefined : env, { path: projectPath, all: env === 'all' });
          break;
        }

        case 'set': {
          const env = await select({
            message: 'Environment:',
            choices: VALID_ENVIRONMENTS.map(e => ({ value: e, name: e })),
          });
          const key = await input({ message: 'Key:' });
          const value = await input({ message: 'Value:' });
          await setCommand(`${env}.${key}`, value, { path: projectPath });
          break;
        }

        case 'get': {
          const env = await select({
            message: 'Environment:',
            choices: VALID_ENVIRONMENTS.map(e => ({ value: e, name: e })),
          });
          const keys = manager.listSecretKeys(env);
          if (keys.length === 0) {
            console.log(chalk.yellow('No secrets in this environment.'));
            break;
          }
          const key = await select({
            message: 'Key:',
            choices: keys.map((k: string) => ({ value: k, name: k })),
          });
          const reveal = await confirm({ message: 'Reveal value?', default: false });
          await getCommand(`${env}.${key}`, { path: projectPath, reveal });
          break;
        }

        case 'delete': {
          const env = await select({
            message: 'Environment:',
            choices: VALID_ENVIRONMENTS.map((e) => ({ value: e, name: e })),
          });
          const keys = manager.listSecretKeys(env);
          if (keys.length === 0) {
            console.log(chalk.yellow('No secrets in this environment.'));
            break;
          }
          const key = await select({
            message: 'Key to delete:',
            choices: keys.map((k: string) => ({ value: k, name: k })),
          });
          await deleteCommand(`${env}.${key}`, { path: projectPath });
          break;
        }

        case 'export': {
          const env = await select({
            message: 'Environment:',
            choices: VALID_ENVIRONMENTS.map(e => ({ value: e, name: e })),
          });
          const output = await input({ message: 'Output file:', default: `.env.${env}` });
          await exportCommand(env, { path: projectPath, output });
          break;
        }

        case 'import': {
          const file = await input({ message: 'File to import:' });
          const env = await select({
            message: 'Target environment:',
            choices: VALID_ENVIRONMENTS.map(e => ({ value: e, name: e })),
          });
          await importCommand(file, { path: projectPath, env });
          break;
        }
      }
    } catch (error) {
      if ((error as { name?: string }).name === 'ExitPromptError') {
        break;
      }
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

/**
 * Register secrets command
 */
export function registerSecretsCommand(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Manage environment secrets');

  secrets
    .command('set <env.key> [value]')
    .description('Set a secret (e.g., production.supabase_url)')
    .option('-p, --path <path>', 'Project path')
    .option('-s, --service <service>', 'Service name (e.g., supabase, vercel)')
    .option('-d, --description <desc>', 'Description')
    .action(setCommand);

  secrets
    .command('get <env.key>')
    .description('Get a secret value')
    .option('-p, --path <path>', 'Project path')
    .option('-r, --reveal', 'Show full value (default: masked)')
    .action(getCommand);

  secrets
    .command('list [env]')
    .description('List secrets')
    .option('-p, --path <path>', 'Project path')
    .option('-a, --all', 'Show all environments')
    .action(listCommand);

  secrets
    .command('delete <env.key>')
    .description('Delete a secret')
    .option('-p, --path <path>', 'Project path')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteCommand);

  secrets
    .command('export <env>')
    .description('Export secrets to .env file')
    .option('-p, --path <path>', 'Project path')
    .option('-o, --output <file>', 'Output file (default: .env.<env>)')
    .action(exportCommand);

  secrets
    .command('import <file>')
    .description('Import secrets from .env file')
    .option('-p, --path <path>', 'Project path')
    .requiredOption('-e, --env <env>', 'Target environment')
    .action(importCommand);

  secrets
    .command('interactive')
    .alias('i')
    .description('Interactive secrets management')
    .option('-p, --path <path>', 'Project path')
    .action(interactiveCommand);

  // Default to interactive if no subcommand
  secrets.action(async (options) => {
    await interactiveCommand(options);
  });
}
