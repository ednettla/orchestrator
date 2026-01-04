import { spawn } from 'node:child_process';
import type { SessionManager } from '../core/session-manager.js';
import type { Task, AgentType, TechStack } from '../core/types.js';
import { AGENT_CONFIGS } from '../core/types.js';
import { buildPrompt } from './prompt-builder.js';
import { mcpConfigManager } from '../core/mcp-config-manager.js';
import { credentialManager } from '../core/credential-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentResult {
  success: boolean;
  output: Record<string, unknown>;
  messages: AgentMessage[];
  totalCost?: number;
}

export interface AgentMessage {
  type: 'user' | 'assistant' | 'system' | 'result';
  content: string;
  timestamp: Date;
}

// ============================================================================
// Agent Invoker
// ============================================================================

export interface InvokerOptions {
  /** MCP servers to enable for this invocation (by name) */
  mcpServers?: string[];
  /** Whether to use MCP servers at all */
  useMcp?: boolean;
}

export class AgentInvoker {
  private sessionManager: SessionManager;
  private workingPath: string;
  private options: InvokerOptions;

  constructor(sessionManager: SessionManager, workingPath?: string, options?: InvokerOptions) {
    this.sessionManager = sessionManager;
    // Use provided worktree path, or fall back to session project path
    this.workingPath = workingPath ?? sessionManager.getCurrentSession()?.projectPath ?? process.cwd();
    this.options = options ?? { useMcp: true };
  }

  async invoke(task: Task): Promise<AgentResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const config = AGENT_CONFIGS[task.agentType];
    const systemPrompt = this.getSystemPrompt(task.agentType, session.techStack);
    const userPrompt = buildPrompt(task.agentType, task.input);

    const messages: AgentMessage[] = [];

    try {
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      // Generate MCP config if enabled
      let mcpConfigPath: string | undefined;
      if (this.options.useMcp !== false) {
        mcpConfigPath = await this.generateMcpConfig();
      }

      // Determine if Chrome MCP should be enabled
      // Enable for tester agent when using chrome-mcp testing
      const useChrome = task.agentType === 'tester' && session.techStack.testing === 'chrome-mcp';

      // Run Claude Code CLI in the worktree directory
      const runOptions: {
        cwd: string;
        prompt: string;
        model: 'opus' | 'sonnet' | 'haiku';
        tools: string[];
        mcpConfigPath?: string;
        useChrome?: boolean;
      } = {
        cwd: this.workingPath,
        prompt: fullPrompt,
        model: config.model,
        tools: config.tools,
        useChrome,
      };

      if (mcpConfigPath) {
        runOptions.mcpConfigPath = mcpConfigPath;
      }

      const result = await this.runClaudeCode(runOptions);

      messages.push({
        type: 'assistant',
        content: result.output,
        timestamp: new Date(),
      });

      // Try to parse JSON output from the response
      const parsedOutput = this.parseAgentOutput(task.agentType, result.output);

      return {
        success: result.exitCode === 0,
        output: parsedOutput,
        messages,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      messages.push({
        type: 'system',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      });

      return {
        success: false,
        output: { error: errorMessage },
        messages,
      };
    }
  }

  private async runClaudeCode(options: {
    cwd: string;
    prompt: string;
    model: 'opus' | 'sonnet' | 'haiku';
    tools: string[];
    mcpConfigPath?: string;
    useChrome?: boolean;
  }): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      const args = [
        '--print',  // Non-interactive mode, print result
        '--dangerously-skip-permissions',  // Skip permission prompts for automation
        '--output-format', 'text',  // Plain text output
      ];

      // Add model flag
      if (options.model === 'opus') {
        args.push('--model', 'claude-opus-4-5-20251101');
      } else if (options.model === 'haiku') {
        args.push('--model', 'claude-haiku-3-5-20241022');
      }
      // sonnet is the default

      // Enable Chrome MCP integration if requested
      if (options.useChrome) {
        args.push('--chrome');
      }

      // Add MCP config if provided
      if (options.mcpConfigPath) {
        args.push('--mcp-config', options.mcpConfigPath);
      }

      // Add allowed tools
      if (options.tools.length > 0) {
        args.push('--allowed-tools', options.tools.join(','));
      }

      // Add prompt as final argument
      args.push(options.prompt);

      const proc = spawn('claude', args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          CLAUDE_CODE_ENTRYPOINT: 'orchestrator',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn claude: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0 && stderr) {
          console.error('Claude stderr:', stderr);
        }
        resolve({
          exitCode: code ?? 1,
          output: stdout || stderr,
        });
      });
    });
  }

  /**
   * Generate MCP runtime config with credentials resolved
   */
  private async generateMcpConfig(): Promise<string | undefined> {
    try {
      // Initialize credential manager
      await credentialManager.initialize();

      // Get all credentials for the project
      const credentials = await credentialManager.getAllCredentials(this.workingPath);

      // Generate runtime config with credentials resolved
      const runtimeConfig = await mcpConfigManager.generateRuntimeConfig(
        this.workingPath,
        credentials,
        this.options.mcpServers // Optional filter
      );

      // If no servers are enabled, skip MCP config
      if (Object.keys(runtimeConfig.mcpServers).length === 0) {
        return undefined;
      }

      // Write runtime config to project
      const configPath = await mcpConfigManager.writeRuntimeConfig(
        this.workingPath,
        runtimeConfig
      );

      return configPath;
    } catch (error) {
      // Log but don't fail - MCP is optional
      console.error('Failed to generate MCP config:', error);
      return undefined;
    }
  }

  private getSystemPrompt(agentType: AgentType, techStack: TechStack): string {
    const basePrompts: Record<AgentType, string> = {
      planner: this.getPlannerPrompt(techStack),
      architect: this.getArchitectPrompt(techStack),
      designer: this.getDesignerPrompt(techStack),
      coder: this.getCoderPrompt(techStack),
      reviewer: this.getReviewerPrompt(techStack),
      tester: this.getTesterPrompt(techStack),
      decomposer: this.getDecomposerPrompt(techStack),
    };

    return basePrompts[agentType];
  }

  private getPlannerPrompt(techStack: TechStack): string {
    return `You are a requirements analyst and planner for a ${techStack.frontend} + ${techStack.backend} application.

Your job is to analyze user requirements and produce a structured specification.

OUTPUT FORMAT (JSON):
\`\`\`json
{
  "title": "Brief title for the requirement",
  "description": "Detailed description of what needs to be built",
  "userStories": ["As a user, I want...", ...],
  "acceptanceCriteria": [
    {
      "id": "AC-1",
      "description": "Description of what must be true",
      "testable": true,
      "verified": false
    }
  ],
  "technicalNotes": ["Implementation considerations..."],
  "dependencies": ["List of dependencies or prerequisites"],
  "priority": "high" | "medium" | "low"
}
\`\`\`

Focus on:
1. Breaking down the requirement into testable acceptance criteria
2. Identifying edge cases and error scenarios
3. Noting any technical constraints or considerations
4. Keeping the scope focused and achievable`;
  }

  private getArchitectPrompt(techStack: TechStack): string {
    return `You are a software architect designing a ${techStack.frontend} + ${techStack.backend} application with ${techStack.database} and ${techStack.styling}.

Your job is to design the system architecture based on the structured specification.

Tasks:
1. Design the file/folder structure
2. Define component hierarchy and responsibilities
3. Design API contracts (endpoints, request/response schemas)
4. Design database schema if applicable
5. Create an implementation plan with ordered tasks

Use the available tools to read existing files and understand the current project structure.
Then output your architecture as JSON.`;
  }

  private getDesignerPrompt(techStack: TechStack): string {
    return `You are a senior UI/UX designer and frontend architect creating design systems for ${techStack.frontend} applications using ${techStack.styling}.

Your job depends on the mode:

## Mode: Generate (New Projects)
Create a complete design system with:
1. Design tokens (colors, typography, spacing)
2. Base UI components (Button, Input, Card, Modal, Badge, Alert, Spinner, Avatar)
3. Storybook stories for documentation
4. Proper TypeScript types

## Mode: Audit (Existing Projects)
Analyze the codebase for UI inconsistencies:
1. Color inconsistencies (hardcoded values, mismatched palettes)
2. Typography issues (magic numbers, inconsistent weights)
3. Spacing violations (non-standard values)
4. Component pattern problems (duplication, inconsistent APIs)
5. Code quality issues (inline styles, complex selectors)

## Mode: Fix
Apply fixes to the identified issues:
1. Create missing design tokens
2. Update components to use tokens
3. Extract shared patterns
4. Clean up messy code

## Design Principles
1. Modern, clean aesthetic with plenty of whitespace
2. Consistent spacing on 4px grid
3. WCAG 2.1 AA accessibility compliance
4. Responsive, mobile-first design
5. Support for light/dark themes

Use the available tools to:
- Read existing files for context
- Write new design system files
- Edit components to use design tokens
- Run npm commands as needed

Output your results as JSON.`;
  }

  private getCoderPrompt(techStack: TechStack): string {
    return `You are a senior developer implementing features for a ${techStack.frontend} + ${techStack.backend} application.

Your job is to implement the code based on the specification provided.

## Guidelines:
1. Follow the existing code patterns and conventions
2. Write clean, maintainable code with proper error handling
3. Use ${techStack.styling} for styling
4. Implement proper TypeScript types
5. Add necessary imports and exports
6. **IMPORTANT: Write unit tests alongside implementation code using Vitest**

## Unit Testing Requirements

You MUST create test files alongside your implementation:
- Test files use \`.test.ts\` or \`.spec.ts\` extension, co-located with source files
- Example: \`Button.tsx\` should have \`Button.test.tsx\` in the same directory

### What to Test:
- Business logic and utility functions
- Component rendering and user interactions (use @testing-library)
- API handlers and middleware
- Error handling and edge cases

### Test Structure:
\`\`\`typescript
import { describe, it, expect, vi } from 'vitest';

describe('ComponentName', () => {
  it('should handle the happy path', () => {
    // Arrange, Act, Assert
  });

  it('should handle error cases', () => {
    // Test error states
  });
});
\`\`\`

### Running Tests:
- Run: \`npm run test\`
- Coverage: \`npm run test:coverage\`
- Aim for >80% coverage on new code

Use the available tools to:
- Read existing files for context
- Write new files (including test files)
- Edit existing files
- Run npm test to verify tests pass

After completing the implementation, output a JSON summary:
\`\`\`json
{
  "implementationFiles": ["list of created/modified source files"],
  "testFiles": ["list of created test files"],
  "testsRun": true,
  "testsPassed": true,
  "notes": ["any implementation notes"]
}
\`\`\``;
  }

  private getReviewerPrompt(techStack: TechStack): string {
    return `You are a code reviewer for a ${techStack.frontend} + ${techStack.backend} application.

Review the recently created/modified files for:
1. Correctness and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and conventions
5. Proper error handling
6. TypeScript type safety
7. **Unit test coverage** - Ensure new code has corresponding tests
8. **Test quality** - Verify tests are meaningful and cover edge cases

## Code Review Checklist

### Implementation Quality
- [ ] Logic is correct and handles edge cases
- [ ] No security vulnerabilities (XSS, injection, etc.)
- [ ] Proper error handling with meaningful messages
- [ ] TypeScript types are accurate and complete
- [ ] Code follows project conventions

### Testing Requirements
- [ ] New source files have corresponding \`.test.ts\` files
- [ ] Tests cover happy path and error cases
- [ ] Tests are meaningful (not just for coverage)
- [ ] All tests pass

Use the available tools to:
1. Find recently modified files
2. Read and analyze each file
3. Check for test files alongside source files
4. Run \`npm run test\` to verify tests pass
5. Run \`npm run test:coverage\` to check coverage
6. Run linting if available

Output your review as JSON:
\`\`\`json
{
  "passed": true/false,
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "file": "path/to/file.ts",
      "line": 42,
      "description": "Description of the issue",
      "suggestion": "How to fix it"
    }
  ],
  "positives": ["Things done well"],
  "testCoverage": {
    "percentage": 85,
    "filesWithoutTests": ["list of source files missing tests"],
    "testsPass": true
  }
}
\`\`\``;
  }

  private getTesterPrompt(techStack: TechStack): string {
    const useChromeMcp = techStack.testing === 'chrome-mcp';

    if (useChromeMcp) {
      return `You are a QA engineer testing a ${techStack.frontend} + ${techStack.backend} application using **Claude Chrome MCP**.

## Your Job
1. Read the acceptance criteria provided
2. Use Chrome MCP tools to interact with the running application
3. Verify each acceptance criterion through browser automation
4. Report test results

## Chrome MCP Testing Approach

You have access to Chrome browser automation via MCP tools:
- \`mcp__claude-in-chrome__navigate\` - Navigate to URLs
- \`mcp__claude-in-chrome__read_page\` - Get accessibility tree of page elements
- \`mcp__claude-in-chrome__find\` - Find elements by natural language
- \`mcp__claude-in-chrome__computer\` - Click, type, scroll, screenshot
- \`mcp__claude-in-chrome__form_input\` - Fill form fields
- \`mcp__claude-in-chrome__javascript_tool\` - Execute JavaScript

## Test Guidelines
1. Start the dev server if not running (\`npm run dev\`)
2. Navigate to the application URL
3. Use screenshots to verify visual state
4. Test both happy paths and error cases
5. Document each test step and result

## Workflow
1. Read acceptance criteria
2. Start dev server and navigate to app
3. For each criterion:
   - Take screenshot of initial state
   - Perform test actions
   - Verify expected outcomes
   - Take screenshot of final state
4. Report results

Output results as JSON:
\`\`\`json
{
  "allPassed": true/false,
  "testsRun": [
    {
      "criterion": "AC-1: Description",
      "steps": ["navigated to /login", "filled email", "clicked submit"],
      "passed": true,
      "notes": "Login successful, redirected to dashboard"
    }
  ],
  "failedCriteria": ["list of failed acceptance criteria IDs"],
  "screenshots": ["list of screenshot descriptions"]
}
\`\`\``;
    }

    // Cypress fallback for CI testing
    return `You are a QA engineer writing E2E tests using Cypress for a ${techStack.frontend} + ${techStack.backend} application.

Your job is to:
1. Read the acceptance criteria provided
2. Generate comprehensive Cypress E2E tests for each criterion
3. Run the tests and report results

Test Guidelines:
1. Use data-testid attributes for element selection
2. Test both happy paths and error cases
3. Keep tests independent and parallelizable
4. Use descriptive test names

Use the available tools to:
- Read the implementation to understand what to test
- Write test files to \`cypress/e2e/\`
- Run tests with \`npx cypress run\`

Output results as JSON with:
- allPassed: true/false
- testsGenerated: array of test info
- results: array of test results
- failedCriteria: array of failed acceptance criteria`;
  }

  private getDecomposerPrompt(techStack: TechStack): string {
    return `You are a senior software architect and project planner for a ${techStack.frontend} + ${techStack.backend} application with ${techStack.database}.

Your job depends on the mode:

## Mode: Questions
Generate 5-10 clarifying questions to fully understand the high-level goal.
Cover: scope, technical requirements, UX, integrations, priorities, and constraints.
Ask questions that will provide enough context for autonomous implementation.

## Mode: Plan
Based on the answered questions, create a comprehensive implementation plan.
Generate detailed requirements with:
- Clear acceptance criteria (testable)
- Dependencies between requirements
- Complexity estimates
- Implementation order optimized for parallel execution

Your goal is to gather enough information so that the build phase is FULLY HANDS-OFF.
Every requirement must be detailed enough for autonomous implementation without further clarification.

Use available tools to:
- Read the existing codebase structure
- Understand current patterns and conventions
- Identify integration points

Output as JSON matching the required schema.`;
  }

  private parseAgentOutput(agentType: AgentType, result: string): Record<string, unknown> {
    // Try to extract JSON from the result
    try {
      // Look for JSON block in the result
      const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch?.[1]) {
        return JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      }

      // Look for raw JSON object
      const jsonObjectMatch = result.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch?.[0]) {
        return JSON.parse(jsonObjectMatch[0]) as Record<string, unknown>;
      }

      // Try parsing the whole result as JSON
      return JSON.parse(result) as Record<string, unknown>;
    } catch {
      // If we can't parse JSON, return a basic structure
      return {
        rawOutput: result,
        parsed: false,
      };
    }
  }
}
