import chalk from 'chalk';
import type { DesignAuditResult, DesignIssue, DesignFixResult, DesignGenerationResult } from './design-controller.js';

// ============================================================================
// Design Presenter
// ============================================================================

/**
 * Formats design audit, generation, and fix results for CLI display
 */
export class DesignPresenter {
  /**
   * Display design generation result
   */
  displayGenerationResult(result: DesignGenerationResult): void {
    if (result.success) {
      console.log(chalk.green('\n✅ Design system generated successfully!\n'));

      if (result.filesCreated.length > 0) {
        console.log(chalk.bold('Files created:'));
        result.filesCreated.forEach((file) => {
          console.log(chalk.dim(`  ${file}`));
        });
      }

      if (result.components.length > 0) {
        console.log(chalk.bold('\nComponents:'));
        console.log(chalk.white(`  ${result.components.join(', ')}`));
      }

      if (result.storybookSetup) {
        console.log(chalk.bold('\nStorybook:'));
        console.log(chalk.dim('  Run'), chalk.white('npm run storybook'), chalk.dim('to view component docs'));
      }

      if (result.notes.length > 0) {
        console.log(chalk.bold('\nNotes:'));
        result.notes.forEach((note) => {
          console.log(chalk.dim(`  • ${note}`));
        });
      }
    } else {
      console.log(chalk.red('\n❌ Design system generation failed\n'));
      if (result.error) {
        console.log(chalk.red(`Error: ${result.error}`));
      }
    }
  }

  /**
   * Display audit result summary
   */
  displayAuditSummary(result: DesignAuditResult): void {
    if (!result.success) {
      console.log(chalk.red('\n❌ Design audit failed\n'));
      if (result.error) {
        console.log(chalk.red(`Error: ${result.error}`));
      }
      return;
    }

    const { summary, existingPatterns } = result;

    console.log(chalk.bold('\n📊 Design Audit Summary\n'));

    // Existing patterns detected
    console.log(chalk.bold('Project Analysis:'));
    console.log(chalk.dim('  Design System:'), existingPatterns.hasDesignSystem ? chalk.green('Yes') : chalk.yellow('No'));
    console.log(chalk.dim('  Theme Config:'), existingPatterns.hasTheme ? chalk.green('Yes') : chalk.yellow('No'));
    console.log(chalk.dim('  Styling:'), existingPatterns.stylingApproach);
    console.log();

    // Issue summary
    console.log(chalk.bold('Issues Found:'), summary.totalIssues);
    console.log();

    // By severity
    if (summary.totalIssues > 0) {
      console.log(chalk.bold('By Severity:'));
      if (summary.bySeverity.high > 0) {
        console.log(chalk.red(`  🔴 High:   ${summary.bySeverity.high}`));
      }
      if (summary.bySeverity.medium > 0) {
        console.log(chalk.yellow(`  🟡 Medium: ${summary.bySeverity.medium}`));
      }
      if (summary.bySeverity.low > 0) {
        console.log(chalk.blue(`  🔵 Low:    ${summary.bySeverity.low}`));
      }
      console.log();

      // By category
      console.log(chalk.bold('By Category:'));
      for (const [category, count] of Object.entries(summary.byCategory)) {
        const icon = this.getCategoryIcon(category);
        console.log(chalk.dim(`  ${icon} ${this.formatCategory(category)}:`), count);
      }
    }
  }

  /**
   * Display detailed issues list
   */
  displayIssues(issues: DesignIssue[], showAll: boolean = false): void {
    if (issues.length === 0) {
      console.log(chalk.green('\n✅ No issues found!\n'));
      return;
    }

    // Group issues by file
    const byFile = issues.reduce((acc, issue) => {
      if (!acc[issue.file]) {
        acc[issue.file] = [];
      }
      acc[issue.file]!.push(issue);
      return acc;
    }, {} as Record<string, DesignIssue[]>);

    // Sort files by issue count (highest first)
    const sortedFiles = Object.entries(byFile).sort((a, b) => b[1].length - a[1].length);

    // Limit display if not showing all
    const displayFiles = showAll ? sortedFiles : sortedFiles.slice(0, 10);

    console.log(chalk.bold('\n📋 Issues by File:\n'));

    for (const [file, fileIssues] of displayFiles) {
      // Sort issues by severity within file
      const sortedIssues = fileIssues.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.severity] - order[b.severity];
      });

      console.log(chalk.white.bold(file));
      for (const issue of sortedIssues) {
        const severityIcon = this.getSeverityIcon(issue.severity);
        const fixable = issue.autoFixable ? chalk.dim(' [auto-fix]') : '';
        console.log(`  ${severityIcon} ${issue.description}${fixable}`);
        if (issue.currentValue && issue.suggestedValue) {
          console.log(chalk.dim(`     Current:   ${issue.currentValue}`));
          console.log(chalk.green(`     Suggested: ${issue.suggestedValue}`));
        }
      }
      console.log();
    }

    if (!showAll && sortedFiles.length > displayFiles.length) {
      const remaining = sortedFiles.length - displayFiles.length;
      console.log(chalk.dim(`  ... and ${remaining} more files with issues`));
      console.log(chalk.dim('  Use --verbose to see all issues'));
      console.log();
    }
  }

  /**
   * Display recommendations
   */
  displayRecommendations(recommendations: string[]): void {
    if (recommendations.length === 0) return;

    console.log(chalk.bold('\n💡 Recommendations:\n'));
    recommendations.forEach((rec, i) => {
      console.log(chalk.white(`  ${i + 1}. ${rec}`));
    });
    console.log();
  }

  /**
   * Display fix options menu
   */
  displayFixOptions(issues: DesignIssue[]): void {
    const fixable = issues.filter((i) => i.autoFixable);
    const nonFixable = issues.filter((i) => !i.autoFixable);

    console.log(chalk.bold('\n🔧 Fix Options:\n'));
    console.log(chalk.white(`  [A] Apply all auto-fixes (${fixable.length} issues)`));
    console.log(chalk.white('  [S] Select fixes to apply'));
    console.log(chalk.white('  [E] Export report to file'));
    console.log(chalk.white('  [C] Cancel'));
    console.log();

    if (nonFixable.length > 0) {
      console.log(chalk.yellow(`  Note: ${nonFixable.length} issues require manual fixes`));
    }
    console.log();
  }

  /**
   * Display fix result
   */
  displayFixResult(result: DesignFixResult): void {
    if (result.success) {
      console.log(chalk.green('\n✅ Fixes applied successfully!\n'));

      console.log(chalk.bold('Summary:'));
      console.log(chalk.dim('  Fixes applied:'), result.fixesApplied);
      console.log(chalk.dim('  Files modified:'), result.filesModified.length);

      if (result.tokensCreated.length > 0) {
        console.log(chalk.dim('  Design tokens created:'));
        result.tokensCreated.forEach((file) => {
          console.log(chalk.dim(`    ${file}`));
        });
      }

      if (result.issuesRemaining.length > 0) {
        console.log(chalk.yellow(`\n  ⚠️ ${result.issuesRemaining.length} issues remaining (require manual fix)`));
      }

      if (result.notes.length > 0) {
        console.log(chalk.bold('\nNotes:'));
        result.notes.forEach((note) => {
          console.log(chalk.dim(`  • ${note}`));
        });
      }
    } else {
      console.log(chalk.red('\n❌ Fix application failed\n'));
      if (result.error) {
        console.log(chalk.red(`Error: ${result.error}`));
      }
    }
  }

  /**
   * Generate export report content
   */
  generateExportReport(result: DesignAuditResult): string {
    const lines: string[] = [];

    lines.push('# Design Audit Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Total Issues:** ${result.summary.totalIssues}`);
    lines.push(`- **High Severity:** ${result.summary.bySeverity.high}`);
    lines.push(`- **Medium Severity:** ${result.summary.bySeverity.medium}`);
    lines.push(`- **Low Severity:** ${result.summary.bySeverity.low}`);
    lines.push('');

    // Project Analysis
    lines.push('## Project Analysis');
    lines.push('');
    lines.push(`- **Has Design System:** ${result.existingPatterns.hasDesignSystem ? 'Yes' : 'No'}`);
    lines.push(`- **Has Theme:** ${result.existingPatterns.hasTheme ? 'Yes' : 'No'}`);
    lines.push(`- **Styling Approach:** ${result.existingPatterns.stylingApproach}`);
    lines.push('');

    // Issues by category
    lines.push('## Issues by Category');
    lines.push('');
    for (const [category, count] of Object.entries(result.summary.byCategory)) {
      lines.push(`### ${this.formatCategory(category)} (${count})`);
      lines.push('');
      const categoryIssues = result.issues.filter((i) => i.category === category);
      for (const issue of categoryIssues) {
        lines.push(`- **[${issue.severity.toUpperCase()}]** ${issue.file}:${issue.line ?? ''}`);
        lines.push(`  - ${issue.description}`);
        if (issue.currentValue) {
          lines.push(`  - Current: \`${issue.currentValue}\``);
        }
        if (issue.suggestedValue) {
          lines.push(`  - Suggested: \`${issue.suggestedValue}\``);
        }
        lines.push(`  - Auto-fixable: ${issue.autoFixable ? 'Yes' : 'No'}`);
        lines.push('');
      }
    }

    // Recommendations
    if (result.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      result.recommendations.forEach((rec, i) => {
        lines.push(`${i + 1}. ${rec}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  // Helper methods
  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'high':
        return chalk.red('●');
      case 'medium':
        return chalk.yellow('●');
      case 'low':
        return chalk.blue('●');
      default:
        return chalk.dim('●');
    }
  }

  private getCategoryIcon(category: string): string {
    switch (category) {
      case 'color':
        return '🎨';
      case 'typography':
        return '📝';
      case 'spacing':
        return '📐';
      case 'pattern':
        return '🧩';
      case 'code-quality':
        return '💻';
      default:
        return '📋';
    }
  }

  private formatCategory(category: string): string {
    return category
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDesignPresenter(): DesignPresenter {
  return new DesignPresenter();
}
