/**
 * CLAUDE.md Refresh Command
 *
 * Regenerate CLAUDE.md with optional secrets injection.
 *
 * @module cli/commands/refresh
 */

import path from 'node:path';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { createClaudeMdGenerator, type ClaudeMdConfig, type RegenerateOptions } from '../../core/claude-md-generator.js';
import { sessionManager } from '../../core/session-manager.js';
import type { SecretEnvironment } from '../../core/secrets-manager.js';

// ============================================================================
// Types
// ============================================================================

interface RefreshCommandOptions {
  path: string;
  injectSecrets?: boolean | undefined;
  env?: string | undefined;
  includeCloud?: boolean | undefined;
}

// ============================================================================
// Command Implementation
// ============================================================================

export async function refreshCommand(options: RefreshCommandOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  // Check for project store
  const storePath = path.join(projectPath, '.orchestrator', 'orchestrator.db');
  if (!existsSync(storePath)) {
    console.log(chalk.red('Error: Not an orchestrator project'));
    console.log(chalk.dim('Run "orchestrate init" first'));
    process.exit(1);
  }

  const generator = createClaudeMdGenerator();

  // Initialize session manager and get current session
  await sessionManager.initialize(projectPath);
  const session = await sessionManager.resumeSession(projectPath);

  // Get current config from session
  const techStack = session.techStack;
  const projectName = session.projectName;

  // Build config
  const config: ClaudeMdConfig = {
    techStack,
    projectName,
    projectPath,
    unitTesting: {
      framework: 'vitest',
      coverageThreshold: 80,
    },
    mcpServers: ['claude-in-chrome'],
  };

  // Parse environment
  let environment: SecretEnvironment = 'development';
  if (options.env) {
    if (options.env === 'development' || options.env === 'staging' || options.env === 'production') {
      environment = options.env;
    } else {
      console.log(chalk.yellow(`Warning: Invalid environment "${options.env}", using development`));
    }
  }

  // Regenerate options
  const regenerateOptions: RegenerateOptions = {
    injectSecrets: options.injectSecrets,
    environment,
    includeCloudServices: options.includeCloud,
  };

  console.log(chalk.cyan('Regenerating CLAUDE.md...'));

  if (options.injectSecrets) {
    console.log(chalk.dim(`  - Injecting secrets for ${environment} environment`));
  }

  if (options.includeCloud) {
    console.log(chalk.dim('  - Including cloud service URLs'));
  }

  try {
    await generator.regenerate(projectPath, config, regenerateOptions);
    console.log(chalk.green('✓ CLAUDE.md regenerated successfully'));

    // Show file info
    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
    const stats = readFileSync(claudeMdPath, 'utf-8');
    const lines = stats.split('\n').length;
    console.log(chalk.dim(`  ${lines} lines written to CLAUDE.md`));
  } catch (error) {
    console.log(chalk.red('Error regenerating CLAUDE.md:'));
    console.log(chalk.dim(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
