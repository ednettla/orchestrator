/**
 * Design Handler
 *
 * Commands for design system audit and generation.
 *
 * @module telegram/handlers/design
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { runDesignAuditFromApi, generateDesignSystemFromApi } from '../project-bridge.js';

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Handle /<project> design command
 *
 * Subcommands:
 * - design          - Show design system status
 * - design audit    - Run design audit
 * - design generate - Generate design tokens
 */
export async function designHandler(commandCtx: CommandContext): Promise<CommandResult> {
  const { projectName, args } = commandCtx;

  if (!projectName) {
    return {
      success: false,
      response: 'Project name required. Usage: `/<project> design`',
    };
  }

  // Get project
  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: ${projectName}`,
    };
  }

  const subCommand = args[0]?.toLowerCase();

  if (!subCommand) {
    // Show design system status
    return showDesignStatus(project.path);
  }

  if (subCommand === 'audit') {
    return runDesignAudit(project.path);
  }

  if (subCommand === 'generate') {
    return generateDesignSystem(project.path);
  }

  return {
    success: false,
    response:
      '*Design Commands*\n\n' +
      '`/<project> design` - Show status\n' +
      '`/<project> design audit` - Run audit\n' +
      '`/<project> design generate` - Generate tokens',
    parseMode: 'Markdown',
  };
}

/**
 * Show design system status
 */
async function showDesignStatus(projectPath: string): Promise<CommandResult> {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  // Check for design system files
  const designDir = join(projectPath, '.orchestrator', 'design');
  const tokensFile = join(designDir, 'tokens.json');
  const auditFile = join(designDir, 'audit.json');

  const hasTokens = existsSync(tokensFile);
  const hasAudit = existsSync(auditFile);

  const lines = ['*Design System*\n'];

  if (!hasTokens && !hasAudit) {
    lines.push('_No design system configured._\n');
    lines.push('Run `/<project> design audit` to analyze the project.');
    return {
      success: true,
      response: lines.join('\n'),
      parseMode: 'Markdown',
    };
  }

  // Show tokens summary
  if (hasTokens) {
    try {
      const tokens = JSON.parse(readFileSync(tokensFile, 'utf-8'));
      lines.push('*Tokens*');
      if (tokens.colors) {
        lines.push(`  Colors: ${Object.keys(tokens.colors).length}`);
      }
      if (tokens.spacing) {
        lines.push(`  Spacing: ${Object.keys(tokens.spacing).length}`);
      }
      if (tokens.typography) {
        lines.push(`  Typography: ${Object.keys(tokens.typography).length}`);
      }
      lines.push('');
    } catch {
      lines.push('_Tokens file exists but could not be parsed._\n');
    }
  }

  // Show audit summary
  if (hasAudit) {
    try {
      const audit = JSON.parse(readFileSync(auditFile, 'utf-8'));
      lines.push('*Last Audit*');
      if (audit.timestamp) {
        const date = new Date(audit.timestamp);
        lines.push(`  Date: ${date.toLocaleDateString()}`);
      }
      if (audit.issues) {
        lines.push(`  Issues: ${audit.issues.length}`);
      }
      if (audit.score !== undefined) {
        lines.push(`  Score: ${audit.score}/100`);
      }
      lines.push('');
    } catch {
      lines.push('_Audit file exists but could not be parsed._\n');
    }
  }

  lines.push('_Use `design audit` to refresh or `design generate` to create tokens._');

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
  };
}

/**
 * Run design audit
 */
async function runDesignAudit(projectPath: string): Promise<CommandResult> {
  try {
    const result = await runDesignAuditFromApi(projectPath);

    if (!result.success) {
      return {
        success: false,
        response: `Design audit failed: ${result.error ?? 'Unknown error'}`,
      };
    }

    const lines = ['*Design Audit Started*\n'];
    lines.push('Analyzing project for design patterns...');

    if (result.jobId) {
      lines.push(`\nJob ID: \`${result.jobId}\``);
    }

    lines.push('\n_Results will be available shortly._');

    return {
      success: true,
      response: lines.join('\n'),
      parseMode: 'Markdown',
    };
  } catch (error) {
    return {
      success: false,
      response: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Generate design system tokens
 */
async function generateDesignSystem(projectPath: string): Promise<CommandResult> {
  try {
    const result = await generateDesignSystemFromApi(projectPath);

    if (!result.success) {
      return {
        success: false,
        response: `Design generation failed: ${result.error ?? 'Unknown error'}`,
      };
    }

    const lines = ['*Design System Generation Started*\n'];
    lines.push('Creating design tokens from project analysis...');

    if (result.jobId) {
      lines.push(`\nJob ID: \`${result.jobId}\``);
    }

    lines.push('\n_Tokens will be generated in `.orchestrator/design/tokens.json`_');

    return {
      success: true,
      response: lines.join('\n'),
      parseMode: 'Markdown',
    };
  } catch (error) {
    return {
      success: false,
      response: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
