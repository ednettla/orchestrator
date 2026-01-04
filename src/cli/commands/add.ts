import path from 'node:path';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { sessionManager } from '../../core/session-manager.js';
import { createRequirementAnalyzer } from '../../core/requirement-analyzer.js';

interface AddOptions {
  path: string;
  priority: string;
  noDecompose?: boolean;
}

export async function addCommand(requirement: string, options: AddOptions): Promise<void> {
  const projectPath = path.resolve(options.path);
  const priority = parseInt(options.priority, 10) || 0;

  console.log(chalk.bold('\n📋 Adding Requirement\n'));

  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    const store = sessionManager.getStore();

    // Skip analysis if --no-decompose flag is set
    if (!options.noDecompose) {
      const analyzer = createRequirementAnalyzer(sessionManager);

      // Quick check first (heuristics only)
      if (analyzer.quickCheck(requirement)) {
        console.log(chalk.cyan('Analyzing requirement scope...'));
        console.log();

        const analysis = await analyzer.analyze(requirement);

        if (analysis.needsDecomposition) {
          console.log(chalk.yellow('⚠ This requirement may be too broad\n'));
          console.log(chalk.dim('Analysis:'));
          console.log(analysis.reasoning);
          console.log();

          if (analysis.suggestedSubRequirements && analysis.suggestedSubRequirements.length > 0) {
            console.log(chalk.dim('Suggested sub-requirements:'));
            analysis.suggestedSubRequirements.forEach((sub, i) => {
              console.log(`  ${i + 1}. ${sub}`);
            });
            console.log();
          }

          // Ask user what to do
          const choice = await askDecompositionChoice();

          if (choice === 'decompose' && analysis.suggestedSubRequirements) {
            // Add each sub-requirement
            console.log(chalk.cyan('\nAdding sub-requirements...\n'));

            const createdReqs: string[] = [];
            for (const subReq of analysis.suggestedSubRequirements) {
              const req = store.createRequirement({
                sessionId: session.id,
                rawInput: subReq,
                priority,
              });
              createdReqs.push(req.id);
              console.log(chalk.green('  ✓'), chalk.dim(req.id.substring(0, 8)), subReq.substring(0, 50) + '...');
            }

            console.log();
            console.log(chalk.green(`✅ Added ${createdReqs.length} requirements to queue`));
            showQueueStatus(store, session.id);
            sessionManager.close();
            return;
          } else if (choice === 'cancel') {
            console.log(chalk.dim('\nCancelled.'));
            sessionManager.close();
            return;
          }
          // else: continue to add as single requirement
          console.log(chalk.dim('\nAdding as single requirement...'));
        }
      }
    }

    // Create the requirement without running
    const req = store.createRequirement({
      sessionId: session.id,
      rawInput: requirement,
      priority,
    });

    console.log(chalk.green('✅ Requirement added to queue'));
    console.log();
    console.log(chalk.dim('ID:'), req.id);
    console.log(chalk.dim('Requirement:'), requirement);
    console.log(chalk.dim('Priority:'), priority);
    console.log(chalk.dim('Status:'), req.status);
    console.log();

    showQueueStatus(store, session.id);

    sessionManager.close();
  } catch (error) {
    sessionManager.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

function showQueueStatus(store: ReturnType<typeof sessionManager.getStore>, sessionId: string): void {
  const allReqs = store.getRequirementsBySession(sessionId);
  const pending = allReqs.filter((r) => r.status === 'pending').length;
  const inProgress = allReqs.filter((r) => r.status === 'in_progress').length;

  console.log(chalk.cyan('Queue:'), `${pending} pending, ${inProgress} in progress`);
  console.log();
  console.log(chalk.dim('Run'), chalk.white('orchestrate run'), chalk.dim('to execute all pending requirements'));
}

async function askDecompositionChoice(): Promise<'decompose' | 'single' | 'cancel'> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.bold('What would you like to do?'));
  console.log(`  ${chalk.green('[D]')} Decompose into sub-requirements`);
  console.log(`  ${chalk.blue('[S]')} Add as single requirement`);
  console.log(`  ${chalk.red('[C]')} Cancel`);
  console.log();

  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.bold('  Your choice: '), (ans) => {
      resolve(ans.toLowerCase().trim());
    });
  });

  rl.close();

  switch (answer) {
    case 'd':
    case 'decompose':
      return 'decompose';
    case 's':
    case 'single':
      return 'single';
    case 'c':
    case 'cancel':
      return 'cancel';
    default:
      return 'single'; // Default to single if unknown
  }
}
