#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { resumeCommand } from './commands/resume.js';
import { statusCommand } from './commands/status.js';
import { configCommand, configInteractive } from './commands/config.js';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { dashboardCommand } from './commands/dashboard.js';
import { planCommand } from './commands/plan.js';
import {
  mcpListCommand,
  mcpAuthCommand,
  mcpAddCommand,
  mcpRemoveCommand,
  mcpEnableCommand,
  mcpDisableCommand,
} from './commands/mcp.js';
import { designCommand } from './commands/design.js';

const program = new Command();

program
  .name('orchestrate')
  .description('Claude Code orchestrator for building full-stack web applications')
  .version('0.1.0');

// ============================================================================
// Project Initialization
// ============================================================================

program
  .command('init')
  .description('Initialize a new orchestrated project')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('-n, --name <name>', 'Project name')
  .option('--detect', 'Auto-detect tech stack from existing project')
  .option('--no-interactive', 'Skip interactive prompts and use defaults')
  .option('--no-claude-md', 'Skip CLAUDE.md generation')
  .option('--no-cloud', 'Skip cloud services setup (GitHub, Supabase, Vercel)')
  .action(initCommand);

// ============================================================================
// Configuration
// ============================================================================

const configCmd = program
  .command('config')
  .description('View or update project configuration')
  .option('-p, --path <path>', 'Project path', process.cwd());

configCmd
  .command('show')
  .description('Show current configuration')
  .action(async (opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await configCommand('show', [], { path: parentOpts.path });
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action(async (key: string, value: string, opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await configCommand('set', [key, value], { path: parentOpts.path });
  });

// Default config action (interactive)
configCmd.action(async (opts) => {
  await configInteractive({ path: opts.path });
});

// ============================================================================
// Requirement Management
// ============================================================================

program
  .command('add')
  .description('Add a requirement to the queue without running')
  .argument('<requirement>', 'The requirement to add')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('--priority <priority>', 'Priority (higher = run first)', '0')
  .option('--no-decompose', 'Skip requirement analysis and add as-is')
  .action(addCommand);

program
  .command('list')
  .description('List all requirements')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('-s, --status <status>', 'Filter by status (pending, in_progress, completed, failed, all)', 'all')
  .option('--json', 'Output as JSON')
  .action(listCommand);

// ============================================================================
// Execution
// ============================================================================

program
  .command('run')
  .description('Execute requirements through the pipeline')
  .argument('[requirement]', 'Requirement to run (or requirement ID). If omitted, runs all pending.')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('--sequential', 'Run one at a time instead of concurrent')
  .option('--concurrency <n>', 'Max concurrent jobs', '3')
  .option('--dashboard', 'Show interactive dashboard with real-time status')
  .action(runCommand);

program
  .command('resume')
  .description('Resume an interrupted session')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(resumeCommand);

// ============================================================================
// Status & Monitoring
// ============================================================================

program
  .command('status')
  .description('Show current session status and progress')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('--json', 'Output as JSON')
  .action(statusCommand);

// ============================================================================
// Interactive Dashboard
// ============================================================================

program
  .command('dashboard')
  .description('Interactive dashboard showing all requirements and jobs')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(dashboardCommand);

// ============================================================================
// Autonomous Planning
// ============================================================================

program
  .command('plan')
  .description('Create and execute an autonomous project plan from a high-level goal')
  .argument('[goal]', 'High-level project goal (e.g., "Build a Sales CRM")')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('--resume', 'Resume an existing plan instead of creating a new one')
  .option('--dashboard', 'Show interactive dashboard during execution')
  .option('--concurrency <n>', 'Max concurrent jobs', '3')
  .action(planCommand);

// ============================================================================
// Design System
// ============================================================================

program
  .command('design')
  .description('Audit and manage design system consistency')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('--audit', 'Run audit only, do not prompt for fixes')
  .option('--fix', 'Apply all auto-fixes without full audit report')
  .option('--generate', 'Generate full design system (for existing projects)')
  .option('--component <name>', 'Generate or update a specific component')
  .option('-v, --verbose', 'Show all issues (not just first 10 files)')
  .action(designCommand);

// ============================================================================
// MCP Server Management
// ============================================================================

const mcpCmd = program
  .command('mcp')
  .description('Manage MCP (Model Context Protocol) server configurations')
  .option('-p, --path <path>', 'Project path', process.cwd());

mcpCmd
  .command('list')
  .description('List configured MCP servers')
  .option('-g, --global', 'Show only global configuration')
  .action(async (opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await mcpListCommand({ path: parentOpts.path, global: opts.global });
  });

mcpCmd
  .command('auth <server>')
  .description('Authorize an MCP server for this project')
  .action(async (server: string, opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await mcpAuthCommand(server, { path: parentOpts.path });
  });

mcpCmd
  .command('add <name>')
  .description('Add a custom MCP server')
  .option('-g, --global', 'Add to global configuration')
  .action(async (name: string, opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await mcpAddCommand(name, { path: parentOpts.path, global: opts.global });
  });

mcpCmd
  .command('remove <name>')
  .description('Remove an MCP server')
  .option('-g, --global', 'Remove from global configuration')
  .action(async (name: string, opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await mcpRemoveCommand(name, { path: parentOpts.path, global: opts.global });
  });

mcpCmd
  .command('enable <name>')
  .description('Enable an MCP server')
  .option('-g, --global', 'Enable in global configuration')
  .action(async (name: string, opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await mcpEnableCommand(name, { path: parentOpts.path, global: opts.global });
  });

mcpCmd
  .command('disable <name>')
  .description('Disable an MCP server')
  .option('-g, --global', 'Disable in global configuration')
  .action(async (name: string, opts, cmd) => {
    const parentOpts = cmd.parent?.opts() as { path: string };
    await mcpDisableCommand(name, { path: parentOpts.path, global: opts.global });
  });

program.parse();
