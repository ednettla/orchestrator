import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { sessionManager, getTechStackDescription } from '../../core/session-manager.js';
import { createDesignController, type DesignIssue } from '../../design/design-controller.js';
import { createDesignPresenter } from '../../design/design-presenter.js';

// ============================================================================
// Types
// ============================================================================

interface DesignOptions {
  path: string;
  audit?: boolean;
  fix?: boolean;
  generate?: boolean;
  component?: string;
  verbose?: boolean;
}

// ============================================================================
// Design Command
// ============================================================================

export async function designCommand(options: DesignOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold('\n🎨 Orchestrator - Design System\n'));

  try {
    // Initialize session manager
    const spinner = ora('Loading project...').start();
    await sessionManager.initialize(projectPath);
    const session = sessionManager.getCurrentSession();

    if (!session) {
      spinner.fail('No session found');
      console.log(chalk.yellow('\nProject not initialized. Run'), chalk.white('orchestrate init'), chalk.yellow('first.'));
      sessionManager.close();
      return;
    }

    spinner.succeed('Project loaded');
    console.log(chalk.dim('Project:'), session.projectName);
    console.log(chalk.dim('Tech Stack:'), getTechStackDescription(session.techStack));
    console.log();

    const designController = createDesignController(sessionManager);
    const presenter = createDesignPresenter();

    // Determine mode
    if (options.component) {
      // Generate/update a specific component
      await handleComponentGeneration(designController, presenter, projectPath, session.techStack, options.component);
    } else if (options.generate) {
      // Generate full design system
      await handleFullGeneration(designController, presenter, projectPath, session.techStack);
    } else if (options.fix) {
      // Skip audit, go straight to fix mode
      await handleFixOnly(designController, presenter, projectPath, session.techStack);
    } else {
      // Default: Run audit and present options
      await handleAuditFlow(designController, presenter, projectPath, session.techStack, options);
    }

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

// ============================================================================
// Handler Functions
// ============================================================================

async function handleComponentGeneration(
  controller: ReturnType<typeof createDesignController>,
  presenter: ReturnType<typeof createDesignPresenter>,
  projectPath: string,
  techStack: import('../../core/types.js').TechStack,
  componentName: string
): Promise<void> {
  const spinner = ora(`Generating ${componentName} component...`).start();
  const result = await controller.generateComponent(projectPath, techStack, componentName);

  if (result.success) {
    spinner.succeed(`${componentName} component generated`);
    presenter.displayGenerationResult(result);
  } else {
    spinner.fail(`Failed to generate ${componentName} component`);
    presenter.displayGenerationResult(result);
  }
}

async function handleFullGeneration(
  controller: ReturnType<typeof createDesignController>,
  presenter: ReturnType<typeof createDesignPresenter>,
  projectPath: string,
  techStack: import('../../core/types.js').TechStack
): Promise<void> {
  const continueGen = await confirm({
    message: 'This will generate a full design system. Existing files may be overwritten. Continue?',
    default: false,
  });

  if (!continueGen) {
    console.log(chalk.dim('\nOperation cancelled.'));
    return;
  }

  const spinner = ora('Generating design system...').start();
  const result = await controller.generateDesignSystem(projectPath, techStack);

  if (result.success) {
    spinner.succeed('Design system generated');
    presenter.displayGenerationResult(result);
  } else {
    spinner.fail('Design system generation failed');
    presenter.displayGenerationResult(result);
  }
}

async function handleFixOnly(
  controller: ReturnType<typeof createDesignController>,
  presenter: ReturnType<typeof createDesignPresenter>,
  projectPath: string,
  techStack: import('../../core/types.js').TechStack
): Promise<void> {
  // First run an audit to get issues
  const auditSpinner = ora('Scanning for issues...').start();
  const auditResult = await controller.auditDesign(projectPath, techStack);
  auditSpinner.stop();

  if (!auditResult.success) {
    console.log(chalk.red('\n❌ Audit failed'));
    if (auditResult.error) {
      console.log(chalk.red(`Error: ${auditResult.error}`));
    }
    return;
  }

  const fixableIssues = auditResult.issues.filter((i) => i.autoFixable);

  if (fixableIssues.length === 0) {
    console.log(chalk.green('\n✅ No auto-fixable issues found'));
    return;
  }

  console.log(chalk.dim(`Found ${fixableIssues.length} auto-fixable issues`));

  const confirmFix = await confirm({
    message: `Apply fixes for ${fixableIssues.length} issues?`,
    default: true,
  });

  if (!confirmFix) {
    console.log(chalk.dim('\nOperation cancelled.'));
    return;
  }

  const fixSpinner = ora('Applying fixes...').start();
  const fixResult = await controller.applyFixes(projectPath, techStack, fixableIssues);

  if (fixResult.success) {
    fixSpinner.succeed('Fixes applied');
    presenter.displayFixResult(fixResult);
  } else {
    fixSpinner.fail('Fix application failed');
    presenter.displayFixResult(fixResult);
  }
}

async function handleAuditFlow(
  controller: ReturnType<typeof createDesignController>,
  presenter: ReturnType<typeof createDesignPresenter>,
  projectPath: string,
  techStack: import('../../core/types.js').TechStack,
  options: DesignOptions
): Promise<void> {
  // Run audit
  const spinner = ora('Auditing design consistency...').start();
  const auditResult = await controller.auditDesign(projectPath, techStack);

  if (!auditResult.success) {
    spinner.fail('Audit failed');
    console.log(chalk.red(`Error: ${auditResult.error}`));
    return;
  }

  spinner.succeed('Audit complete');

  // Display summary
  presenter.displayAuditSummary(auditResult);

  // If no issues, we're done
  if (auditResult.summary.totalIssues === 0) {
    console.log(chalk.green('\n✅ No design issues found! Your project has consistent UI.\n'));
    return;
  }

  // Display issues
  presenter.displayIssues(auditResult.issues, options.verbose);

  // Display recommendations
  presenter.displayRecommendations(auditResult.recommendations);

  // If audit-only mode, stop here
  if (options.audit) {
    return;
  }

  // Interactive: ask what to do
  const fixableCount = auditResult.issues.filter((i) => i.autoFixable).length;

  const action = await select({
    message: 'What would you like to do?',
    choices: [
      {
        name: `Apply all auto-fixes (${fixableCount} issues)`,
        value: 'apply-all',
        disabled: fixableCount === 0,
      },
      {
        name: 'Select fixes to apply',
        value: 'select',
        disabled: fixableCount === 0,
      },
      {
        name: 'Export report to file',
        value: 'export',
      },
      {
        name: 'Cancel',
        value: 'cancel',
      },
    ],
  });

  switch (action) {
    case 'apply-all':
      await applyAllFixes(controller, presenter, projectPath, techStack, auditResult.issues);
      break;

    case 'select':
      await selectAndApplyFixes(controller, presenter, projectPath, techStack, auditResult.issues);
      break;

    case 'export':
      await exportReport(presenter, projectPath, auditResult);
      break;

    case 'cancel':
    default:
      console.log(chalk.dim('\nOperation cancelled.'));
  }
}

async function applyAllFixes(
  controller: ReturnType<typeof createDesignController>,
  presenter: ReturnType<typeof createDesignPresenter>,
  projectPath: string,
  techStack: import('../../core/types.js').TechStack,
  issues: DesignIssue[]
): Promise<void> {
  const fixableIssues = issues.filter((i) => i.autoFixable);

  const confirmFix = await confirm({
    message: `This will modify files to fix ${fixableIssues.length} issues. Continue?`,
    default: true,
  });

  if (!confirmFix) {
    console.log(chalk.dim('\nOperation cancelled.'));
    return;
  }

  const spinner = ora('Applying fixes...').start();
  const result = await controller.applyFixes(projectPath, techStack, fixableIssues);

  if (result.success) {
    spinner.succeed('Fixes applied');
    presenter.displayFixResult(result);
  } else {
    spinner.fail('Fix application failed');
    presenter.displayFixResult(result);
  }
}

async function selectAndApplyFixes(
  controller: ReturnType<typeof createDesignController>,
  presenter: ReturnType<typeof createDesignPresenter>,
  projectPath: string,
  techStack: import('../../core/types.js').TechStack,
  issues: DesignIssue[]
): Promise<void> {
  const fixableIssues = issues.filter((i) => i.autoFixable);

  // Group by category for easier selection
  const byCategory = fixableIssues.reduce((acc, issue) => {
    if (!acc[issue.category]) {
      acc[issue.category] = [];
    }
    acc[issue.category]!.push(issue);
    return acc;
  }, {} as Record<string, DesignIssue[]>);

  const selectedCategories = await select({
    message: 'Which category of issues would you like to fix?',
    choices: [
      ...Object.entries(byCategory).map(([category, catIssues]) => ({
        name: `${formatCategory(category)} (${catIssues.length} issues)`,
        value: category,
      })),
      { name: 'All categories', value: 'all' },
    ],
  });

  const issuesToFix =
    selectedCategories === 'all' ? fixableIssues : fixableIssues.filter((i) => i.category === selectedCategories);

  if (issuesToFix.length === 0) {
    console.log(chalk.yellow('\nNo issues to fix in selected category.'));
    return;
  }

  const confirmFix = await confirm({
    message: `Apply fixes for ${issuesToFix.length} issues?`,
    default: true,
  });

  if (!confirmFix) {
    console.log(chalk.dim('\nOperation cancelled.'));
    return;
  }

  const spinner = ora('Applying selected fixes...').start();
  const result = await controller.applyFixes(projectPath, techStack, issuesToFix);

  if (result.success) {
    spinner.succeed('Fixes applied');
    presenter.displayFixResult(result);
  } else {
    spinner.fail('Fix application failed');
    presenter.displayFixResult(result);
  }
}

async function exportReport(
  presenter: ReturnType<typeof createDesignPresenter>,
  projectPath: string,
  auditResult: import('../../design/design-controller.js').DesignAuditResult
): Promise<void> {
  const reportPath = path.join(projectPath, 'design-audit-report.md');
  const reportContent = presenter.generateExportReport(auditResult);

  try {
    await writeFile(reportPath, reportContent, 'utf-8');
    console.log(chalk.green(`\n✅ Report exported to: ${reportPath}\n`));
  } catch (error) {
    console.log(chalk.red('\n❌ Failed to export report'));
    if (error instanceof Error) {
      console.log(chalk.red(`Error: ${error.message}`));
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatCategory(category: string): string {
  return category
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
