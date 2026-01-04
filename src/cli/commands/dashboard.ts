import path from 'node:path';
import chalk from 'chalk';
import { sessionManager } from '../../core/session-manager.js';
import { renderDashboard } from '../../ui/dashboard.js';

interface DashboardOptions {
  path: string;
}

export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    const store = sessionManager.getStore();

    // Render the interactive dashboard
    renderDashboard(store, session);
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}
