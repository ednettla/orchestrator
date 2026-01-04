/**
 * Projects CLI Command
 *
 * Manage global project registry.
 *
 * Usage:
 *   orchestrate projects list [--recent N] [--status active|archived|all]
 *   orchestrate projects show [path]
 *   orchestrate projects alias <path> <alias>
 *   orchestrate projects archive <path>
 *   orchestrate projects unarchive <path>
 *   orchestrate projects remove <path>
 *   orchestrate projects cleanup [--dry-run]
 *
 * @module cli/commands/projects
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { confirm, select, input } from '@inquirer/prompts';
import { getProjectRegistry, type RegisteredProject, type ProjectStatus, type ListProjectsOptions } from '../../core/project-registry.js';

/**
 * Format a date for display
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return `${minutes}m ago`;
    }
    return `${hours}h ago`;
  } else if (days === 1) {
    return 'yesterday';
  } else if (days < 7) {
    return `${days}d ago`;
  } else if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format project for display
 */
function formatProject(project: RegisteredProject, verbose = false): string {
  const lines: string[] = [];

  // Name and status
  const statusBadge =
    project.status === 'archived' ? chalk.yellow(' [archived]') : '';
  const aliasBadge = project.alias ? chalk.dim(` (${project.alias})`) : '';

  lines.push(`${chalk.bold(project.name)}${aliasBadge}${statusBadge}`);

  // Path
  lines.push(`  ${chalk.dim(project.path)}`);

  if (verbose) {
    // Tech stack
    if (project.techStack) {
      const stack = [
        project.techStack.frontend,
        project.techStack.backend,
        project.techStack.database,
      ]
        .filter(Boolean)
        .join(' + ');
      if (stack) {
        lines.push(`  ${chalk.cyan('Stack:')} ${stack}`);
      }
    }

    // Cloud services
    if (project.cloudServices) {
      const services: string[] = [];
      if (project.cloudServices.github) services.push('GitHub');
      if (project.cloudServices.supabase) services.push('Supabase');
      if (project.cloudServices.vercel) services.push('Vercel');
      if (services.length > 0) {
        lines.push(`  ${chalk.cyan('Services:')} ${services.join(', ')}`);
      }
    }

    // Dates
    lines.push(
      `  ${chalk.dim(`Created: ${formatDate(project.createdAt)} | Last accessed: ${formatDate(project.lastAccessedAt)}`)}`
    );
  } else {
    // Just last accessed
    lines.push(`  ${chalk.dim(`Last accessed: ${formatDate(project.lastAccessedAt)}`)}`);
  }

  return lines.join('\n');
}

/**
 * List all projects
 */
async function listCommand(options: {
  recent?: number;
  status?: string;
  verbose?: boolean;
}): Promise<void> {
  const registry = getProjectRegistry();

  const status = (options.status ?? 'active') as ProjectStatus | 'all';
  const listOptions: ListProjectsOptions = {
    status,
    sortBy: 'lastAccessed',
  };
  if (options.recent !== undefined) {
    listOptions.limit = options.recent;
  }
  const projects = registry.listProjects(listOptions);

  if (projects.length === 0) {
    console.log(chalk.yellow('No projects found.'));
    console.log(chalk.dim('Initialize a project with: orchestrate init'));
    return;
  }

  console.log(chalk.bold(`\nProjects (${projects.length}):\n`));

  for (const project of projects) {
    console.log(formatProject(project, options.verbose));
    console.log();
  }

  const totalCount = registry.getProjectCount('all');
  const activeCount = registry.getProjectCount('active');
  const archivedCount = registry.getProjectCount('archived');

  console.log(
    chalk.dim(
      `Total: ${totalCount} | Active: ${activeCount} | Archived: ${archivedCount}`
    )
  );
}

/**
 * Show project details
 */
async function showCommand(
  projectPath: string | undefined,
  options: { path?: string }
): Promise<void> {
  const registry = getProjectRegistry();
  const targetPath = projectPath ?? options.path ?? process.cwd();

  const project = registry.getProject(targetPath);

  if (!project) {
    console.log(chalk.yellow('Project not found in registry.'));
    console.log(chalk.dim('Initialize with: orchestrate init'));
    return;
  }

  console.log();
  console.log(formatProject(project, true));
  console.log();

  // Show ID for reference
  console.log(chalk.dim(`ID: ${project.id}`));
}

/**
 * Set project alias
 */
async function aliasCommand(
  projectPath: string,
  alias: string,
  options: { path?: string }
): Promise<void> {
  const registry = getProjectRegistry();

  const project = registry.getProject(projectPath);
  if (!project) {
    console.error(chalk.red('Project not found.'));
    process.exit(1);
  }

  const success = registry.setAlias(project.path, alias);

  if (!success) {
    console.error(chalk.red('Alias already in use by another project.'));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Set alias '${alias}' for ${project.name}`));
}

/**
 * Archive a project
 */
async function archiveCommand(
  projectPath: string,
  options: { force?: boolean }
): Promise<void> {
  const registry = getProjectRegistry();

  const project = registry.getProject(projectPath);
  if (!project) {
    console.error(chalk.red('Project not found.'));
    process.exit(1);
  }

  if (project.status === 'archived') {
    console.log(chalk.yellow('Project is already archived.'));
    return;
  }

  if (!options.force) {
    const confirmed = await confirm({
      message: `Archive ${project.name}?`,
      default: false,
    });

    if (!confirmed) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }
  }

  registry.archiveProject(project.path);
  console.log(chalk.green(`✓ Archived ${project.name}`));
}

/**
 * Unarchive a project
 */
async function unarchiveCommand(projectPath: string): Promise<void> {
  const registry = getProjectRegistry();

  const project = registry.getProject(projectPath);
  if (!project) {
    console.error(chalk.red('Project not found.'));
    process.exit(1);
  }

  if (project.status === 'active') {
    console.log(chalk.yellow('Project is already active.'));
    return;
  }

  registry.unarchiveProject(project.path);
  console.log(chalk.green(`✓ Unarchived ${project.name}`));
}

/**
 * Remove project from registry
 */
async function removeCommand(
  projectPath: string,
  options: { force?: boolean }
): Promise<void> {
  const registry = getProjectRegistry();

  const project = registry.getProject(projectPath);
  if (!project) {
    console.error(chalk.red('Project not found.'));
    process.exit(1);
  }

  if (!options.force) {
    console.log(chalk.yellow('This only removes the project from the registry.'));
    console.log(chalk.dim('The project files on disk will not be affected.'));

    const confirmed = await confirm({
      message: `Remove ${project.name} from registry?`,
      default: false,
    });

    if (!confirmed) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }
  }

  registry.unregisterProject(project.path);
  console.log(chalk.green(`✓ Removed ${project.name} from registry`));
}

/**
 * Cleanup stale projects
 */
async function cleanupCommand(options: { dryRun?: boolean }): Promise<void> {
  const registry = getProjectRegistry();

  if (options.dryRun) {
    // Just list what would be removed
    const projects = registry.listProjects({ status: 'all' });
    const stale: RegisteredProject[] = [];

    for (const project of projects) {
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');

      const orchestratorDir = join(project.path, '.orchestrator');
      if (!existsSync(orchestratorDir)) {
        stale.push(project);
      }
    }

    if (stale.length === 0) {
      console.log(chalk.green('No stale projects found.'));
      return;
    }

    console.log(chalk.yellow(`Found ${stale.length} stale project(s):\n`));
    for (const project of stale) {
      console.log(`  ${chalk.red('✗')} ${project.name}`);
      console.log(`    ${chalk.dim(project.path)}`);
    }

    console.log(chalk.dim('\nRun without --dry-run to remove these entries.'));
    return;
  }

  const removed = registry.cleanupStaleProjects();

  if (removed.length === 0) {
    console.log(chalk.green('No stale projects found.'));
    return;
  }

  console.log(chalk.green(`✓ Removed ${removed.length} stale project(s):`));
  for (const path of removed) {
    console.log(chalk.dim(`  ${path}`));
  }
}

/**
 * Interactive project management
 */
export async function interactiveCommand(): Promise<void> {
  const registry = getProjectRegistry();

  while (true) {
    const counts = {
      active: registry.getProjectCount('active'),
      archived: registry.getProjectCount('archived'),
    };

    console.log(
      chalk.dim(`\nProjects: ${counts.active} active, ${counts.archived} archived`)
    );

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { value: 'list', name: 'List projects' },
        { value: 'show', name: 'Show project details' },
        { value: 'alias', name: 'Set project alias' },
        { value: 'archive', name: 'Archive a project' },
        { value: 'unarchive', name: 'Unarchive a project' },
        { value: 'remove', name: 'Remove from registry' },
        { value: 'cleanup', name: 'Cleanup stale projects' },
        { value: 'exit', name: 'Exit' },
      ],
    });

    if (action === 'exit') break;

    try {
      switch (action) {
        case 'list': {
          const status = await select({
            message: 'Which projects?',
            choices: [
              { value: 'active', name: 'Active only' },
              { value: 'archived', name: 'Archived only' },
              { value: 'all', name: 'All projects' },
            ],
          });
          await listCommand({ status, verbose: true });
          break;
        }

        case 'show': {
          const projects = registry.listProjects({ status: 'all' });
          if (projects.length === 0) {
            console.log(chalk.yellow('No projects found.'));
            break;
          }
          const choice = await select({
            message: 'Select project:',
            choices: projects.map(p => ({
              value: p.path,
              name: `${p.name}${p.status === 'archived' ? ' [archived]' : ''}`,
            })),
          });
          await showCommand(choice, {});
          break;
        }

        case 'alias': {
          const projects = registry.listProjects({ status: 'active' });
          if (projects.length === 0) {
            console.log(chalk.yellow('No active projects.'));
            break;
          }
          const projectPath = await select({
            message: 'Select project:',
            choices: projects.map(p => ({
              value: p.path,
              name: `${p.name}${p.alias ? ` (${p.alias})` : ''}`,
            })),
          });
          const alias = await input({ message: 'New alias:' });
          await aliasCommand(projectPath, alias, {});
          break;
        }

        case 'archive': {
          const projects = registry.listProjects({ status: 'active' });
          if (projects.length === 0) {
            console.log(chalk.yellow('No active projects to archive.'));
            break;
          }
          const choice = await select({
            message: 'Select project to archive:',
            choices: projects.map(p => ({ value: p.path, name: p.name })),
          });
          await archiveCommand(choice, {});
          break;
        }

        case 'unarchive': {
          const projects = registry.listProjects({ status: 'archived' });
          if (projects.length === 0) {
            console.log(chalk.yellow('No archived projects.'));
            break;
          }
          const choice = await select({
            message: 'Select project to unarchive:',
            choices: projects.map(p => ({ value: p.path, name: p.name })),
          });
          await unarchiveCommand(choice);
          break;
        }

        case 'remove': {
          const projects = registry.listProjects({ status: 'all' });
          if (projects.length === 0) {
            console.log(chalk.yellow('No projects found.'));
            break;
          }
          const choice = await select({
            message: 'Select project to remove:',
            choices: projects.map(p => ({
              value: p.path,
              name: `${p.name}${p.status === 'archived' ? ' [archived]' : ''}`,
            })),
          });
          await removeCommand(choice, {});
          break;
        }

        case 'cleanup': {
          const dryRun = await confirm({
            message: 'Dry run first?',
            default: true,
          });
          await cleanupCommand({ dryRun });
          break;
        }
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
 * Register projects command
 */
export function registerProjectsCommand(program: Command): void {
  const projects = program
    .command('projects')
    .description('Manage project registry');

  projects
    .command('list')
    .description('List all projects')
    .option('-r, --recent <n>', 'Show only N most recent projects', parseInt)
    .option('-s, --status <status>', 'Filter by status (active|archived|all)', 'active')
    .option('-v, --verbose', 'Show detailed information')
    .action(listCommand);

  projects
    .command('show [path]')
    .description('Show project details')
    .option('-p, --path <path>', 'Project path')
    .action(showCommand);

  projects
    .command('alias <path> <alias>')
    .description('Set project alias for quick reference')
    .action(aliasCommand);

  projects
    .command('archive <path>')
    .description('Archive a project')
    .option('-f, --force', 'Skip confirmation')
    .action(archiveCommand);

  projects
    .command('unarchive <path>')
    .description('Unarchive a project')
    .action(unarchiveCommand);

  projects
    .command('remove <path>')
    .description('Remove project from registry (does not delete files)')
    .option('-f, --force', 'Skip confirmation')
    .action(removeCommand);

  projects
    .command('cleanup')
    .description('Remove stale projects (no longer exist on disk)')
    .option('-d, --dry-run', 'Show what would be removed without removing')
    .action(cleanupCommand);

  projects
    .command('interactive')
    .alias('i')
    .description('Interactive project management')
    .action(interactiveCommand);

  // Default to list if no subcommand
  projects.action(async () => {
    await listCommand({ status: 'active', verbose: true });
  });
}
