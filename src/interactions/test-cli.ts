#!/usr/bin/env node
/**
 * Test CLI for Unified Interaction System
 *
 * Simple test to verify the flow system works end-to-end.
 * Run with: npx tsx src/interactions/test-cli.ts
 *
 * @module interactions/test-cli
 */

import path from 'node:path';
import {
  FlowRunner,
  cliRenderer,
  buildFlowContext,
  createCliUser,
  mainMenuFlow,
  printBanner,
  printContextInfo,
  getSubFlowId,
} from './index.js';
import type { MainMenuContext } from './flows/main-menu.js';

async function main(): Promise<void> {
  const projectPath = process.cwd();

  // Print banner
  printBanner();

  // Build initial context
  const baseContext = await buildFlowContext(projectPath, createCliUser(), 'cli');

  // Extend to MainMenuContext
  const context: MainMenuContext = {
    ...baseContext,
  };

  // Print context info
  const contextInfo: Parameters<typeof printContextInfo>[0] = {
    hasProject: context.hasProject,
    requirements: context.requirements,
    daemon: context.daemon,
  };
  if (context.projectName !== undefined) {
    contextInfo.projectName = context.projectName;
  }
  if (context.plan) {
    contextInfo.plan = {
      status: context.plan.status,
      highLevelGoal: context.plan.highLevelGoal,
    };
  }
  printContextInfo(contextInfo);

  // Create and run the flow
  const runner = new FlowRunner(mainMenuFlow, cliRenderer, context);

  // Run the CLI loop
  while (true) {
    const response = await runner.runCurrentStep();

    // Handle cancellation
    if (response === null) {
      const step = runner.getCurrentStep();
      const interaction = step?.interaction(runner.getContext());

      if (interaction?.type === 'display') {
        // Display-only step - auto-advance
        const result = await runner.handleResponse(null);
        if (result.done) break;
        continue;
      }

      // User cancelled
      console.log('\nGoodbye!\n');
      break;
    }

    // Handle progress interaction
    if (response && typeof response === 'object' && 'update' in response) {
      const result = await runner.handleResponse(response);
      if (result.done) break;
      continue;
    }

    // Handle response
    const result = await runner.handleResponse(response);

    // Check for sub-flow navigation
    if (!result.done && result.error === undefined) {
      const currentStep = runner.getCurrentStepId();
      // Check if the handler returned a flow: navigation
      const ctx = runner.getContext();
      if (ctx.selectedAction?.startsWith('flow:')) {
        const subFlowId = getSubFlowId(ctx.selectedAction);
        console.log(`\n[Would navigate to sub-flow: ${subFlowId}]\n`);
        // For now, just show a message and go back to menu
        // In production, we'd load and run the sub-flow
        continue;
      }
    }

    if (result.done) {
      console.log('\nGoodbye!\n');
      break;
    }

    if (result.error) {
      console.error(`\nError: ${result.error}\n`);
    }
  }
}

main().catch(console.error);
