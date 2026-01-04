import chalk from 'chalk';
import type { Plan, ClarifyingQuestion, PlannedRequirement } from '../core/types.js';

// ============================================================================
// Plan Presenter
// ============================================================================

const WIDTH = 70;
const DIVIDER = '═'.repeat(WIDTH);
const THIN_DIVIDER = '─'.repeat(WIDTH);

export function presentPlanHeader(plan: Plan): void {
  console.log('\n' + chalk.cyan(DIVIDER));
  console.log(chalk.cyan.bold(center('PROJECT PLAN')));
  console.log(chalk.cyan(DIVIDER) + '\n');

  console.log(chalk.bold('GOAL:'), plan.highLevelGoal);
  console.log();

  if (plan.overview) {
    console.log(chalk.bold('OVERVIEW:'));
    console.log(wrapText(plan.overview, WIDTH));
    console.log();
  }
}

export function presentQuestions(questions: ClarifyingQuestion[]): void {
  console.log(chalk.cyan(DIVIDER));
  console.log(chalk.cyan.bold(center('CLARIFYING QUESTIONS')));
  console.log(chalk.cyan(DIVIDER) + '\n');

  // Group by category
  const categories = new Map<string, ClarifyingQuestion[]>();
  for (const q of questions) {
    const cat = q.category || 'general';
    if (!categories.has(cat)) {
      categories.set(cat, []);
    }
    categories.get(cat)!.push(q);
  }

  let index = 1;
  for (const [category, qs] of categories) {
    console.log(chalk.yellow.bold(`  ${category.toUpperCase()}`));
    console.log();

    for (const q of qs) {
      const answered = q.answer ? chalk.green(' ✓') : chalk.dim(' ○');
      console.log(`  ${chalk.bold(index.toString())}. ${q.question}${answered}`);

      if (q.context) {
        console.log(chalk.dim(`     ${q.context}`));
      }

      if (q.suggestedOptions && q.suggestedOptions.length > 0) {
        console.log(chalk.dim(`     Options: ${q.suggestedOptions.join(', ')}`));
      }

      if (q.answer) {
        console.log(chalk.green(`     → ${q.answer}`));
      }

      console.log();
      index++;
    }
  }
}

export function presentRequirements(requirements: PlannedRequirement[], implementationOrder: string[]): void {
  console.log(chalk.cyan(DIVIDER));
  console.log(chalk.cyan.bold(center(`REQUIREMENTS (${requirements.length})`)));
  console.log(chalk.cyan(DIVIDER) + '\n');

  // Table header
  console.log(chalk.dim('  #   Complexity   Title                              Dependencies'));
  console.log(chalk.dim('  ' + '─'.repeat(WIDTH - 4)));

  // Sort by implementation order
  const orderedReqs: PlannedRequirement[] = [];
  for (const id of implementationOrder) {
    const found = requirements.find(r => r.id === id);
    if (found) {
      orderedReqs.push(found);
    }
  }

  // If implementation order is empty, use original order
  const reqsToShow: PlannedRequirement[] = orderedReqs.length > 0 ? orderedReqs : requirements;

  for (let i = 0; i < reqsToShow.length; i++) {
    const req = reqsToShow[i]!;
    const complexity = formatComplexity(req.estimatedComplexity);
    const deps = req.dependencies.length > 0
      ? `[${req.dependencies.map(d => getReqIndex(d, reqsToShow) + 1).join(', ')}]`
      : '-';

    const title = truncate(req.title, 32);

    console.log(
      `  ${chalk.bold((i + 1).toString().padStart(2))}  ` +
      `${complexity}  ` +
      `${title.padEnd(35)} ` +
      `${deps}`
    );
  }

  console.log();
}

export function presentRequirementDetails(requirements: PlannedRequirement[]): void {
  console.log(chalk.cyan(DIVIDER));
  console.log(chalk.cyan.bold(center('REQUIREMENT DETAILS')));
  console.log(chalk.cyan(DIVIDER) + '\n');

  requirements.forEach((req, i) => {
    console.log(chalk.bold(`${i + 1}. ${req.title}`));
    console.log(chalk.dim(THIN_DIVIDER));

    console.log(wrapText(req.description, WIDTH - 3, '   '));
    console.log();

    if (req.userStories.length > 0) {
      console.log(chalk.bold('   User Stories:'));
      for (const story of req.userStories) {
        console.log(`   • ${story}`);
      }
      console.log();
    }

    if (req.acceptanceCriteria.length > 0) {
      console.log(chalk.bold('   Acceptance Criteria:'));
      for (const ac of req.acceptanceCriteria) {
        console.log(`   ${chalk.dim(ac.id)} ${ac.description}`);
      }
      console.log();
    }

    if (req.technicalNotes.length > 0) {
      console.log(chalk.bold('   Technical Notes:'));
      for (const note of req.technicalNotes) {
        console.log(`   • ${note}`);
      }
      console.log();
    }

    if (req.rationale) {
      console.log(chalk.bold('   Rationale:'));
      console.log(wrapText(req.rationale, WIDTH - 3, '   '));
      console.log();
    }

    console.log();
  });
}

export function presentArchitecturalDecisions(plan: Plan): void {
  if (plan.architecturalDecisions.length === 0) return;

  console.log(chalk.cyan(DIVIDER));
  console.log(chalk.cyan.bold(center('ARCHITECTURAL DECISIONS')));
  console.log(chalk.cyan(DIVIDER) + '\n');

  for (const decision of plan.architecturalDecisions) {
    console.log(chalk.bold(`  ${decision.title}`));
    console.log(chalk.dim(`  ${THIN_DIVIDER.substring(0, WIDTH - 4)}`));
    console.log(`  Decision: ${decision.decision}`);
    console.log(`  Rationale: ${decision.rationale}`);
    if (decision.alternatives.length > 0) {
      console.log(`  Alternatives: ${decision.alternatives.join(', ')}`);
    }
    if (decision.tradeoffs) {
      console.log(`  Trade-offs: ${decision.tradeoffs}`);
    }
    console.log();
  }
}

export function presentDependencyGraph(requirements: PlannedRequirement[], implementationOrder: string[]): void {
  console.log(chalk.cyan(DIVIDER));
  console.log(chalk.cyan.bold(center('DEPENDENCY GRAPH')));
  console.log(chalk.cyan(DIVIDER) + '\n');

  // Build adjacency for display
  const orderedReqs: PlannedRequirement[] = [];
  for (const id of implementationOrder) {
    const found = requirements.find(r => r.id === id);
    if (found) {
      orderedReqs.push(found);
    }
  }

  const reqsToShow: PlannedRequirement[] = orderedReqs.length > 0 ? orderedReqs : requirements;

  // Simple text-based representation
  reqsToShow.forEach((req, i) => {
    const num = i + 1;

    if (req.dependencies.length === 0) {
      console.log(`  [${num}] ${truncate(req.title, 25)}`);
    } else {
      const deps = req.dependencies.map(d => getReqIndex(d, reqsToShow) + 1).join(', ');
      console.log(`  [${num}] ${truncate(req.title, 25)} ← depends on [${deps}]`);
    }
  });

  console.log();
}

export function presentAssumptionsAndScope(plan: Plan): void {
  if (plan.assumptions.length === 0 && plan.outOfScope.length === 0 && plan.risks.length === 0) {
    return;
  }

  console.log(chalk.cyan(DIVIDER));
  console.log(chalk.cyan.bold(center('SCOPE & RISKS')));
  console.log(chalk.cyan(DIVIDER) + '\n');

  if (plan.assumptions.length > 0) {
    console.log(chalk.bold('  ASSUMPTIONS:'));
    for (const assumption of plan.assumptions) {
      console.log(`  • ${assumption}`);
    }
    console.log();
  }

  if (plan.outOfScope.length > 0) {
    console.log(chalk.bold('  OUT OF SCOPE:'));
    for (const item of plan.outOfScope) {
      console.log(`  • ${item}`);
    }
    console.log();
  }

  if (plan.risks.length > 0) {
    console.log(chalk.bold('  RISKS:'));
    for (const risk of plan.risks) {
      const severity = getRiskSeverity(risk.likelihood, risk.impact);
      console.log(`  ${severity} ${risk.description}`);
      if (risk.mitigation) {
        console.log(chalk.dim(`     Mitigation: ${risk.mitigation}`));
      }
    }
    console.log();
  }
}

export function presentApprovalPrompt(): void {
  console.log(chalk.cyan(DIVIDER) + '\n');
  console.log(chalk.bold('  ACTIONS:'));
  console.log(`  ${chalk.green('[A]')} Approve and Execute`);
  console.log(`  ${chalk.yellow('[E]')} Edit (not yet implemented)`);
  console.log(`  ${chalk.red('[R]')} Reject`);
  console.log(`  ${chalk.blue('[S]')} Save and Exit`);
  console.log();
}

export function presentFullPlan(plan: Plan): void {
  presentPlanHeader(plan);
  presentRequirements(plan.requirements, plan.implementationOrder);
  presentDependencyGraph(plan.requirements, plan.implementationOrder);
  presentArchitecturalDecisions(plan);
  presentAssumptionsAndScope(plan);
}

// ============================================================================
// Helpers
// ============================================================================

function center(text: string): string {
  const padding = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return ' '.repeat(padding) + text;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function wrapText(text: string, maxWidth: number, prefix = ''): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = prefix;

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine === prefix ? '' : ' ') + word;
    } else {
      if (currentLine !== prefix) {
        lines.push(currentLine);
      }
      currentLine = prefix + word;
    }
  }

  if (currentLine !== prefix) {
    lines.push(currentLine);
  }

  return lines.join('\n');
}

function formatComplexity(complexity: 'low' | 'medium' | 'high'): string {
  switch (complexity) {
    case 'low':
      return chalk.green('Low   ');
    case 'medium':
      return chalk.yellow('Medium');
    case 'high':
      return chalk.red('High  ');
    default:
      return chalk.dim('???   ');
  }
}

function getReqIndex(id: string, requirements: PlannedRequirement[]): number {
  return requirements.findIndex(r => r.id === id);
}

function getRiskSeverity(likelihood: 'low' | 'medium' | 'high', impact: 'low' | 'medium' | 'high'): string {
  const score = (likelihood === 'high' ? 3 : likelihood === 'medium' ? 2 : 1) +
                (impact === 'high' ? 3 : impact === 'medium' ? 2 : 1);

  if (score >= 5) return chalk.red('⚠ HIGH');
  if (score >= 3) return chalk.yellow('△ MED ');
  return chalk.green('○ LOW ');
}
