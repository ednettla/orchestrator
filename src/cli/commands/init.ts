import path from 'node:path';
import { input, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { sessionManager, TECH_STACK_CHOICES, getTechStackDescription } from '../../core/session-manager.js';
import { detectTechStack, formatDetectionResult } from '../../core/tech-stack-detector.js';
import { setupVitest } from '../../core/vitest-setup.js';
import { createClaudeMdGenerator } from '../../core/claude-md-generator.js';
import { CloudServicesSetup } from '../../core/cloud-setup/index.js';
import { spawnDaemon } from '../daemon.js';
import type { TechStack } from '../../core/types.js';
import { DEFAULT_TECH_STACK } from '../../core/types.js';

interface InitOptions {
  path: string;
  name?: string;
  detect?: boolean;
  interactive: boolean;
  claudeMd: boolean;  // --no-claude-md sets this to false
  cloud: boolean;     // --no-cloud sets this to false
}

export async function initCommand(options: InitOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold('\n🚀 Orchestrator - Project Initialization\n'));

  try {
    // Initialize the session manager
    const spinner = ora('Initializing project directory...').start();
    await sessionManager.initialize(projectPath);
    spinner.succeed('Project directory initialized');

    let projectName = options.name;
    let techStack: TechStack = DEFAULT_TECH_STACK;

    // Auto-detect tech stack if requested
    if (options.detect) {
      const detectSpinner = ora('Detecting tech stack...').start();
      const detection = await detectTechStack(projectPath);
      detectSpinner.succeed('Tech stack detection complete');

      console.log(chalk.cyan('\nDetected technologies:'));
      console.log(formatDetectionResult(detection));
      console.log();

      // Merge detected values with defaults
      techStack = {
        frontend: detection.detected.frontend ?? DEFAULT_TECH_STACK.frontend,
        backend: detection.detected.backend ?? DEFAULT_TECH_STACK.backend,
        database: detection.detected.database ?? DEFAULT_TECH_STACK.database,
        testing: detection.detected.testing ?? DEFAULT_TECH_STACK.testing,
        unitTesting: DEFAULT_TECH_STACK.unitTesting,
        styling: detection.detected.styling ?? DEFAULT_TECH_STACK.styling,
      };

      // If interactive, ask for confirmation
      if (options.interactive) {
        const acceptDetected = await confirm({
          message: 'Use detected tech stack?',
          default: true,
        });

        if (!acceptDetected) {
          techStack = await selectTechStack(techStack);
        }
      }
    } else if (options.interactive) {
      // Get project name
      projectName = await input({
        message: 'Project name:',
        default: path.basename(projectPath),
        validate: (value) => value.length > 0 || 'Project name is required',
      });

      // Confirm tech stack customization
      const customizeStack = await confirm({
        message: 'Would you like to customize the tech stack?',
        default: false,
      });

      if (customizeStack) {
        techStack = await selectTechStack();
      }
    }

    // Default project name if not set
    projectName = projectName ?? path.basename(projectPath);

    // Create the session
    const session = await sessionManager.createSession({
      projectPath,
      projectName,
      techStack,
    });

    console.log(chalk.green('\n✅ Project initialized successfully!\n'));
    console.log(chalk.dim('Session ID:'), session.id);
    console.log(chalk.dim('Project:'), session.projectName);
    console.log(chalk.dim('Path:'), session.projectPath);
    console.log(chalk.dim('Tech Stack:'), getTechStackDescription(session.techStack));
    console.log(chalk.dim('Status:'), session.status);

    // Note: Design system generation removed from init
    // Design tokens are created during `orchestrate run` when features are built,
    // or manually via `orchestrate design --generate`

    // Setup Vitest for unit testing
    const vitestSpinner = ora('Setting up Vitest...').start();
    const vitestResult = await setupVitest(projectPath, techStack);
    if (vitestResult.success) {
      vitestSpinner.succeed('Vitest configured');
      if (vitestResult.dependenciesAdded) {
        console.log(chalk.dim('  Dependencies:'), 'Added vitest, @vitest/coverage-v8');
      }
      if (vitestResult.scriptsAdded) {
        console.log(chalk.dim('  Scripts:'), 'test, test:coverage, test:ui');
      }
      if (vitestResult.configCreated) {
        console.log(chalk.dim('  Config:'), 'vitest.config.ts created');
      }
    } else {
      vitestSpinner.warn('Vitest setup skipped');
      if (vitestResult.errors.length > 0) {
        console.log(chalk.yellow(`  Reason: ${vitestResult.errors[0]}`));
      }
    }

    // Generate CLAUDE.md unless --no-claude-md flag is set
    if (options.claudeMd) {
      const claudeMdSpinner = ora('Generating CLAUDE.md...').start();
      try {
        const claudeMdGenerator = createClaudeMdGenerator();
        await claudeMdGenerator.regenerate(projectPath, {
          techStack,
          projectName,
          projectPath,
          unitTesting: { framework: 'vitest', coverageThreshold: 80 },
          mcpServers: ['claude-in-chrome'],
        });
        claudeMdSpinner.succeed('CLAUDE.md generated');
        console.log(chalk.dim('  Location:'), 'CLAUDE.md');
        console.log(chalk.dim('  Purpose:'), 'Claude Code project context');
      } catch (error) {
        claudeMdSpinner.warn('CLAUDE.md generation skipped');
        if (error instanceof Error) {
          console.log(chalk.yellow(`  Reason: ${error.message}`));
        }
      }
    }

    // Cloud services setup (optional, interactive only)
    if (options.interactive && options.cloud) {
      try {
        const store = sessionManager.getStore();
        const cloudSetup = new CloudServicesSetup(
          projectPath,
          projectName,
          session.id,
          store
        );
        const cloudResult = await cloudSetup.promptAndSetup();

        if (cloudResult?.success) {
          console.log(chalk.green('\n✓ Cloud services configured'));

          // Update next steps based on cloud services
          if (cloudResult.services.github) {
            console.log(chalk.dim('  GitHub:'), cloudResult.services.github.url);
          }
          if (cloudResult.services.supabase) {
            console.log(chalk.dim('  Supabase:'), cloudResult.services.supabase.credentials.projectUrl);
          }
          if (cloudResult.services.vercel) {
            console.log(chalk.dim('  Vercel:'), cloudResult.services.vercel.url);
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          console.log(chalk.yellow('\n⚠ Cloud setup skipped:'), error.message);
        }
      }
    }

    // Offer to start building immediately (interactive only)
    if (options.interactive) {
      console.log();
      const startNow = await confirm({
        message: 'Would you like to start building now?',
        default: true,
      });

      if (startNow) {
        const goal = await input({
          message: 'What would you like to build?',
          validate: (value) => value.length > 0 || 'Please describe what you want to build',
        });

        const runInBackground = await confirm({
          message: 'Run in background? (you can close the terminal)',
          default: true,
        });

        sessionManager.close();

        if (runInBackground) {
          console.log(chalk.cyan('\n🚀 Starting build in background...\n'));

          const result = spawnDaemon(projectPath, 'plan', [goal, '-p', projectPath]);

          if (result.success) {
            console.log(chalk.green(`✓ Build started (PID ${result.pid})`));
            console.log(chalk.dim('\nYou can safely close this terminal.'));
            console.log(chalk.dim('Use these commands to manage the build:\n'));
            console.log(chalk.dim('  orchestrate status    # Check progress'));
            console.log(chalk.dim('  orchestrate logs -f   # Follow log output'));
            console.log(chalk.dim('  orchestrate stop      # Stop the build\n'));
          } else {
            console.log(chalk.red(`✗ Failed to start: ${result.error}`));
            console.log(chalk.dim('\nYou can start manually with:'));
            console.log(chalk.white(`  orchestrate plan "${goal}" --background\n`));
          }
        } else {
          // Run in foreground - just print the command to run
          console.log(chalk.cyan('\n🚀 Starting build...\n'));
          console.log(chalk.dim('Run this command to start:'));
          console.log(chalk.white(`  orchestrate plan "${goal}"\n`));
        }

        return;
      }
    }

    console.log(chalk.cyan('\n📝 Next steps:'));
    console.log(chalk.dim('  Add requirements with'), chalk.white('orchestrate add "your requirement"'));
    console.log(chalk.dim('  Or run directly with'), chalk.white('orchestrate run "your requirement"'));
    console.log(chalk.dim('  Or plan a full project with'), chalk.white('orchestrate plan "Build a ..."'));

    sessionManager.close();
  } catch (error) {
    sessionManager.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    } else {
      console.error(chalk.red('\n❌ Unknown error occurred'));
    }
    process.exit(1);
  }
}

async function selectTechStack(defaults?: Partial<TechStack>): Promise<TechStack> {
  console.log(chalk.dim('\nSelect your preferred technologies:\n'));

  const frontend = await select({
    message: 'Frontend framework:',
    choices: TECH_STACK_CHOICES.frontend.map((c) => ({
      name: `${c.name} - ${chalk.dim(c.description)}`,
      value: c.value,
    })),
    default: defaults?.frontend ?? 'nextjs',
  });

  const backend = await select({
    message: 'Backend framework:',
    choices: TECH_STACK_CHOICES.backend.map((c) => ({
      name: `${c.name} - ${chalk.dim(c.description)}`,
      value: c.value,
    })),
    default: defaults?.backend ?? 'express',
  });

  const database = await select({
    message: 'Database:',
    choices: TECH_STACK_CHOICES.database.map((c) => ({
      name: `${c.name} - ${chalk.dim(c.description)}`,
      value: c.value,
    })),
    default: defaults?.database ?? 'postgresql',
  });

  const testing = await select({
    message: 'Testing framework:',
    choices: TECH_STACK_CHOICES.testing.map((c) => ({
      name: `${c.name} - ${chalk.dim(c.description)}`,
      value: c.value,
    })),
    default: defaults?.testing ?? 'chrome-mcp',
  });

  const styling = await select({
    message: 'Styling solution:',
    choices: TECH_STACK_CHOICES.styling.map((c) => ({
      name: `${c.name} - ${chalk.dim(c.description)}`,
      value: c.value,
    })),
    default: defaults?.styling ?? 'tailwind',
  });

  return {
    frontend: frontend as TechStack['frontend'],
    backend: backend as TechStack['backend'],
    database: database as TechStack['database'],
    testing: testing as TechStack['testing'],
    unitTesting: 'vitest' as const,
    styling: styling as TechStack['styling'],
  };
}
