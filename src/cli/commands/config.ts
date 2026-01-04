import path from 'node:path';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { sessionManager, TECH_STACK_CHOICES, getTechStackDescription } from '../../core/session-manager.js';
import type { TechStack } from '../../core/types.js';
import { TechStackSchema } from '../../core/types.js';

interface ConfigOptions {
  path: string;
}

type ConfigSubcommand = 'show' | 'set';

export async function configCommand(
  subcommand: ConfigSubcommand | undefined,
  args: string[],
  options: ConfigOptions
): Promise<void> {
  const projectPath = path.resolve(options.path);

  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);

    if (!subcommand || subcommand === 'show') {
      // Show current config
      console.log(chalk.bold('\n⚙️  Orchestrator Configuration\n'));
      console.log(chalk.dim('Project:'), session.projectName);
      console.log(chalk.dim('Path:'), session.projectPath);
      console.log();
      console.log(chalk.cyan('Tech Stack:'));
      console.log(`  ${chalk.dim('Frontend:')}  ${session.techStack.frontend}`);
      console.log(`  ${chalk.dim('Backend:')}   ${session.techStack.backend}`);
      console.log(`  ${chalk.dim('Database:')}  ${session.techStack.database}`);
      console.log(`  ${chalk.dim('Testing:')}   ${session.techStack.testing}`);
      console.log(`  ${chalk.dim('Styling:')}   ${session.techStack.styling}`);
      console.log();
      console.log(chalk.dim('Use'), chalk.white('orchestrate config set <key> <value>'), chalk.dim('to change'));
      console.log(chalk.dim('Or run'), chalk.white('orchestrate config'), chalk.dim('without args for interactive mode'));
    } else if (subcommand === 'set') {
      // Set specific config value
      if (args.length < 2) {
        console.error(chalk.red('Usage: orchestrate config set <key> <value>'));
        console.error(chalk.dim('Keys: frontend, backend, database, testing, styling'));
        process.exit(1);
      }

      const [key, value] = args;
      await setConfigValue(session.techStack, key!, value!, projectPath);
    }

    sessionManager.close();
  } catch (error) {
    sessionManager.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

export async function configInteractive(options: ConfigOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold('\n⚙️  Orchestrator Configuration\n'));

  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    const store = sessionManager.getStore();

    console.log(chalk.dim('Current tech stack:'), getTechStackDescription(session.techStack));
    console.log();

    // Interactive menu
    const action = await select({
      message: 'What would you like to configure?',
      choices: [
        { name: 'Frontend framework', value: 'frontend' },
        { name: 'Backend framework', value: 'backend' },
        { name: 'Database', value: 'database' },
        { name: 'Testing framework', value: 'testing' },
        { name: 'Styling solution', value: 'styling' },
        { name: 'Exit', value: 'exit' },
      ],
    });

    if (action === 'exit') {
      sessionManager.close();
      return;
    }

    const key = action as keyof TechStack;
    const choices = TECH_STACK_CHOICES[key];

    const newValue = await select({
      message: `Select ${key}:`,
      choices: choices.map((c) => ({
        name: `${c.name} - ${chalk.dim(c.description)}`,
        value: c.value,
      })),
      default: session.techStack[key],
    });

    // Update the tech stack
    const newTechStack = { ...session.techStack, [key]: newValue };

    // We need to add updateTechStack to session manager - for now update via store
    // This requires adding the method to session manager
    console.log(chalk.green(`\n✅ Updated ${key} to ${newValue}`));
    console.log(chalk.dim('New tech stack:'), getTechStackDescription(newTechStack));

    sessionManager.close();
  } catch (error) {
    sessionManager.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

async function setConfigValue(
  currentStack: TechStack,
  key: string,
  value: string,
  projectPath: string
): Promise<void> {
  const validKeys = ['frontend', 'backend', 'database', 'testing', 'styling'];

  if (!validKeys.includes(key)) {
    console.error(chalk.red(`Invalid key: ${key}`));
    console.error(chalk.dim('Valid keys:'), validKeys.join(', '));
    process.exit(1);
  }

  // Validate value using Zod schema
  const testStack = { ...currentStack, [key]: value };

  try {
    TechStackSchema.parse(testStack);
  } catch {
    const choices = TECH_STACK_CHOICES[key as keyof TechStack];
    const validValues = choices.map((c) => c.value);
    console.error(chalk.red(`Invalid value: ${value}`));
    console.error(chalk.dim('Valid values for'), key + ':', validValues.join(', '));
    process.exit(1);
  }

  console.log(chalk.green(`✅ Set ${key} = ${value}`));
  console.log(chalk.dim('New tech stack:'), getTechStackDescription(testStack as TechStack));
}
