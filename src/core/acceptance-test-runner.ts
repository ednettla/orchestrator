/**
 * Acceptance Test Runner
 *
 * Runs E2E acceptance tests for completed requirements.
 * Uses Chrome MCP (via tester agent) to verify acceptance criteria.
 *
 * @module acceptance-test-runner
 */

import { spawn, ChildProcess } from 'node:child_process';
import chalk from 'chalk';
import type { StateStore } from '../state/store.js';
import type { Requirement, AcceptanceCriterion } from './types.js';
import { AgentInvoker } from '../agents/invoker.js';
import type { SessionManager } from './session-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface CriterionResult {
  id: string;
  description: string;
  passed: boolean;
  error?: string | undefined;
  notes?: string | undefined;
}

export interface RequirementTestResult {
  id: string;
  name: string;
  criteria: CriterionResult[];
  allPassed: boolean;
}

export interface TestResults {
  passed: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  requirements: RequirementTestResult[];
  devServerUrl?: string;
  error?: string;
}

interface DevServerInfo {
  url: string;
  process: ChildProcess;
  port: number;
}

// ============================================================================
// Acceptance Test Runner
// ============================================================================

export class AcceptanceTestRunner {
  private projectPath: string;
  private store: StateStore;
  private sessionManager: SessionManager;
  private devServer: DevServerInfo | null = null;

  constructor(projectPath: string, store: StateStore, sessionManager: SessionManager) {
    this.projectPath = projectPath;
    this.store = store;
    this.sessionManager = sessionManager;
  }

  /**
   * Run acceptance tests for all specified requirements
   */
  async runTests(requirementIds: string[]): Promise<TestResults> {
    const results: TestResults = {
      passed: true,
      total: 0,
      passedCount: 0,
      failedCount: 0,
      requirements: [],
    };

    try {
      // Start dev server
      console.log(chalk.dim('  Starting dev server...'));
      const serverInfo = await this.startDevServer();
      results.devServerUrl = serverInfo.url;
      console.log(chalk.dim(`  Dev server running at ${serverInfo.url}`));

      // Wait for server to be ready
      await this.waitForServer(serverInfo.url, 30000);

      // Get requirements and their acceptance criteria
      const requirements: Requirement[] = [];
      for (const reqId of requirementIds) {
        const req = this.store.getRequirement(reqId);
        if (req && req.structuredSpec?.acceptanceCriteria) {
          requirements.push(req);
        }
      }

      if (requirements.length === 0) {
        console.log(chalk.yellow('  No requirements with acceptance criteria found'));
        await this.stopDevServer();
        return results;
      }

      // Run tests for each requirement
      for (const req of requirements) {
        console.log(chalk.dim(`  Testing: ${req.structuredSpec?.title ?? req.id.substring(0, 8)}`));

        const reqResult = await this.testRequirement(req, serverInfo.url);
        results.requirements.push(reqResult);

        // Update counts
        for (const criterion of reqResult.criteria) {
          results.total++;
          if (criterion.passed) {
            results.passedCount++;
          } else {
            results.failedCount++;
            results.passed = false;
          }
        }
      }

      // Stop dev server
      await this.stopDevServer();

      return results;
    } catch (error) {
      // Ensure dev server is stopped on error
      await this.stopDevServer();

      results.passed = false;
      results.error = error instanceof Error ? error.message : String(error);
      return results;
    }
  }

  /**
   * Test a single requirement against its acceptance criteria
   */
  private async testRequirement(req: Requirement, serverUrl: string): Promise<RequirementTestResult> {
    const spec = req.structuredSpec!;
    const criteria = spec.acceptanceCriteria;

    const result: RequirementTestResult = {
      id: req.id,
      name: spec.title,
      criteria: [],
      allPassed: true,
    };

    // Build the test prompt for the tester agent
    const testPrompt = this.buildTestPrompt(spec.title, spec.description, criteria, serverUrl);

    try {
      // Invoke tester agent
      const invoker = new AgentInvoker(this.sessionManager, this.projectPath, { useMcp: true });

      const task = {
        id: `test-${req.id}`,
        sessionId: req.sessionId,
        requirementId: req.id,
        agentType: 'tester' as const,
        input: {
          requirement: spec.title,
          description: spec.description,
          acceptanceCriteria: criteria,
          serverUrl,
          testPrompt,
        },
        output: null,
        status: 'running' as const,
        retryCount: 0,
        errorMessage: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
      };

      const agentResult = await invoker.invoke(task);

      // Parse agent output
      if (agentResult.success && agentResult.output) {
        const output = agentResult.output as {
          allPassed?: boolean;
          testsRun?: Array<{
            criterion: string;
            passed: boolean;
            notes?: string;
          }>;
        };

        if (output.testsRun && Array.isArray(output.testsRun)) {
          for (const testResult of output.testsRun) {
            const criterionId = this.extractCriterionId(testResult.criterion);
            const criterion = criteria.find(c => c.id === criterionId);

            result.criteria.push({
              id: criterionId,
              description: criterion?.description ?? testResult.criterion,
              passed: testResult.passed,
              notes: testResult.notes,
            });

            if (!testResult.passed) {
              result.allPassed = false;
            }
          }
        }
      } else {
        // Agent failed, mark all criteria as failed
        for (const criterion of criteria) {
          result.criteria.push({
            id: criterion.id,
            description: criterion.description,
            passed: false,
            error: 'Test agent failed to complete',
          });
        }
        result.allPassed = false;
      }
    } catch (error) {
      // On error, mark all criteria as failed
      for (const criterion of criteria) {
        result.criteria.push({
          id: criterion.id,
          description: criterion.description,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      result.allPassed = false;
    }

    return result;
  }

  /**
   * Build test prompt for the tester agent
   */
  private buildTestPrompt(
    title: string,
    description: string,
    criteria: AcceptanceCriterion[],
    serverUrl: string
  ): string {
    const criteriaList = criteria
      .map((c, i) => `${i + 1}. [${c.id}] ${c.description}`)
      .join('\n');

    return `
## Acceptance Test Request

**Feature:** ${title}
**Description:** ${description}

**Server URL:** ${serverUrl}

## Acceptance Criteria to Verify

${criteriaList}

## Instructions

1. Navigate to the application at ${serverUrl}
2. For each acceptance criterion:
   - Perform the necessary actions to test the criterion
   - Take screenshots to document the test
   - Record whether the criterion passes or fails
3. Report results for ALL criteria

Ensure you test each criterion thoroughly and provide detailed notes on what you observed.
`;
  }

  /**
   * Extract criterion ID from test result string
   */
  private extractCriterionId(criterionStr: string): string {
    // Try to extract "AC-1" style ID from string like "AC-1: Description"
    const match = criterionStr.match(/^(AC-\d+)/);
    return match?.[1] ?? criterionStr.substring(0, 10);
  }

  /**
   * Start the development server
   */
  async startDevServer(): Promise<DevServerInfo> {
    if (this.devServer) {
      return this.devServer;
    }

    const port = await this.findAvailablePort(3000);
    const url = `http://localhost:${port}`;

    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
        cwd: this.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(port),
        },
        detached: true, // Allow process to run independently
      });

      let startupOutput = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Assume server started even if we didn't get confirmation
          this.devServer = { url, process: proc, port };
          resolve(this.devServer);
        }
      }, 10000);

      proc.stdout?.on('data', (data: Buffer) => {
        startupOutput += data.toString();

        // Check for common server ready messages
        if (
          startupOutput.includes('ready') ||
          startupOutput.includes('started') ||
          startupOutput.includes(`localhost:${port}`) ||
          startupOutput.includes('Local:')
        ) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.devServer = { url, process: proc, port };
            resolve(this.devServer);
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        startupOutput += data.toString();
      });

      proc.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to start dev server: ${error.message}`));
        }
      });

      proc.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Dev server exited with code ${code}: ${startupOutput}`));
        }
      });
    });
  }

  /**
   * Wait for server to be ready to accept connections
   */
  private async waitForServer(url: string, timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok || response.status < 500) {
          return; // Server is ready
        }
      } catch {
        // Server not ready yet
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Timeout reached, but server process is running - assume it's ready
    if (this.devServer && !this.devServer.process.killed) {
      return;
    }

    throw new Error(`Server did not become ready within ${timeoutMs}ms`);
  }

  /**
   * Stop the development server
   */
  async stopDevServer(): Promise<void> {
    if (!this.devServer) {
      return;
    }

    const proc = this.devServer.process;

    return new Promise<void>((resolve) => {
      // Check if already dead
      if (proc.killed || proc.exitCode !== null) {
        this.devServer = null;
        resolve();
        return;
      }

      // Set up force kill timeout
      const forceKillTimer = setTimeout(() => {
        if (!proc.killed && proc.exitCode === null) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      proc.once('exit', () => {
        clearTimeout(forceKillTimer);
        this.devServer = null;
        resolve();
      });

      // Send graceful termination
      proc.kill('SIGTERM');
    });
  }

  /**
   * Find an available port starting from the given port
   */
  private async findAvailablePort(startPort: number): Promise<number> {
    const net = await import('node:net');

    for (let port = startPort; port < startPort + 100; port++) {
      const available = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
          server.close(() => resolve(true));
        });
        server.on('error', () => resolve(false));
      });

      if (available) {
        return port;
      }
    }

    throw new Error('No available port found');
  }
}

/**
 * Factory function to create an AcceptanceTestRunner
 */
export function createAcceptanceTestRunner(
  projectPath: string,
  store: StateStore,
  sessionManager: SessionManager
): AcceptanceTestRunner {
  return new AcceptanceTestRunner(projectPath, store, sessionManager);
}
