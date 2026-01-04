import { nanoid } from 'nanoid';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionManager } from '../core/session-manager.js';
import type { Task, TechStack, DesignSystemInfo } from '../core/types.js';
import { AgentInvoker } from '../agents/invoker.js';

// ============================================================================
// Types
// ============================================================================

export interface DesignGenerationResult {
  success: boolean;
  filesCreated: string[];
  components: string[];
  storybookSetup: boolean;
  notes: string[];
  error?: string;
}

export interface DesignIssue {
  id: string;
  category: 'color' | 'typography' | 'spacing' | 'pattern' | 'code-quality';
  severity: 'high' | 'medium' | 'low';
  file: string;
  line?: number;
  description: string;
  currentValue?: string;
  suggestedValue?: string;
  autoFixable: boolean;
}

export interface DesignAuditResult {
  success: boolean;
  summary: {
    totalIssues: number;
    bySeverity: { high: number; medium: number; low: number };
    byCategory: Record<string, number>;
  };
  issues: DesignIssue[];
  recommendations: string[];
  existingPatterns: {
    hasDesignSystem: boolean;
    hasTheme: boolean;
    stylingApproach: string;
  };
  error?: string;
}

export interface DesignFixResult {
  success: boolean;
  fixesApplied: number;
  filesModified: string[];
  tokensCreated: string[];
  issuesRemaining: DesignIssue[];
  notes: string[];
  error?: string;
}

// ============================================================================
// Design Controller
// ============================================================================

export class DesignController {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Generate a design system for a new project
   * Called during `orchestrate init`
   */
  async generateDesignSystem(
    projectPath: string,
    techStack: TechStack
  ): Promise<DesignGenerationResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: 'No active session',
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'generate',
        techStack,
        projectPath,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          filesCreated: [],
          components: [],
          storybookSetup: false,
          notes: [],
          error: 'Design generation failed',
        };
      }

      const output = result.output as unknown as Partial<DesignGenerationResult>;
      return {
        success: output.success ?? true,
        filesCreated: output.filesCreated ?? [],
        components: output.components ?? [],
        storybookSetup: output.storybookSetup ?? false,
        notes: output.notes ?? [],
      };
    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Audit an existing project for design inconsistencies
   * Called during `orchestrate design` or `orchestrate design --audit`
   */
  async auditDesign(
    projectPath: string,
    techStack: TechStack
  ): Promise<DesignAuditResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        summary: {
          totalIssues: 0,
          bySeverity: { high: 0, medium: 0, low: 0 },
          byCategory: {},
        },
        issues: [],
        recommendations: [],
        existingPatterns: {
          hasDesignSystem: false,
          hasTheme: false,
          stylingApproach: 'unknown',
        },
        error: 'No active session',
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'audit',
        techStack,
        projectPath,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          summary: {
            totalIssues: 0,
            bySeverity: { high: 0, medium: 0, low: 0 },
            byCategory: {},
          },
          issues: [],
          recommendations: [],
          existingPatterns: {
            hasDesignSystem: false,
            hasTheme: false,
            stylingApproach: 'unknown',
          },
          error: 'Design audit failed',
        };
      }

      const output = result.output as unknown as Partial<DesignAuditResult>;
      return {
        success: true,
        summary: output.summary ?? {
          totalIssues: 0,
          bySeverity: { high: 0, medium: 0, low: 0 },
          byCategory: {},
        },
        issues: output.issues ?? [],
        recommendations: output.recommendations ?? [],
        existingPatterns: output.existingPatterns ?? {
          hasDesignSystem: false,
          hasTheme: false,
          stylingApproach: 'unknown',
        },
      };
    } catch (error) {
      return {
        success: false,
        summary: {
          totalIssues: 0,
          bySeverity: { high: 0, medium: 0, low: 0 },
          byCategory: {},
        },
        issues: [],
        recommendations: [],
        existingPatterns: {
          hasDesignSystem: false,
          hasTheme: false,
          stylingApproach: 'unknown',
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply fixes for identified design issues
   * Called during `orchestrate design --fix` or after audit approval
   */
  async applyFixes(
    projectPath: string,
    techStack: TechStack,
    issues: DesignIssue[]
  ): Promise<DesignFixResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        fixesApplied: 0,
        filesModified: [],
        tokensCreated: [],
        issuesRemaining: issues,
        notes: [],
        error: 'No active session',
      };
    }

    // Filter to only auto-fixable issues
    const fixableIssues = issues.filter((i) => i.autoFixable);

    if (fixableIssues.length === 0) {
      return {
        success: true,
        fixesApplied: 0,
        filesModified: [],
        tokensCreated: [],
        issuesRemaining: issues,
        notes: ['No auto-fixable issues found'],
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'fix',
        techStack,
        projectPath,
        issues: fixableIssues,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          fixesApplied: 0,
          filesModified: [],
          tokensCreated: [],
          issuesRemaining: issues,
          notes: [],
          error: 'Fix application failed',
        };
      }

      const output = result.output as unknown as Partial<DesignFixResult>;
      return {
        success: output.success ?? true,
        fixesApplied: output.fixesApplied ?? 0,
        filesModified: output.filesModified ?? [],
        tokensCreated: output.tokensCreated ?? [],
        issuesRemaining: output.issuesRemaining ?? [],
        notes: output.notes ?? [],
      };
    } catch (error) {
      return {
        success: false,
        fixesApplied: 0,
        filesModified: [],
        tokensCreated: [],
        issuesRemaining: issues,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate or update a specific component
   * Called with `orchestrate design --component Button`
   */
  async generateComponent(
    projectPath: string,
    techStack: TechStack,
    componentName: string
  ): Promise<DesignGenerationResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: 'No active session',
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'generate',
        techStack,
        projectPath,
        singleComponent: componentName,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          filesCreated: [],
          components: [],
          storybookSetup: false,
          notes: [],
          error: `Failed to generate component: ${componentName}`,
        };
      }

      const output = result.output as unknown as Partial<DesignGenerationResult>;
      return {
        success: output.success ?? true,
        filesCreated: output.filesCreated ?? [],
        components: output.components ?? [componentName],
        storybookSetup: output.storybookSetup ?? false,
        notes: output.notes ?? [],
      };
    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if the tech stack includes a frontend framework
   */
  hasFrontend(techStack: TechStack): boolean {
    const frontendFrameworks = ['nextjs', 'react', 'vue', 'svelte', 'solid', 'nuxt', 'remix'];
    return frontendFrameworks.some(fw =>
      techStack.frontend?.toLowerCase().includes(fw)
    );
  }

  /**
   * Check if a design system already exists in the project
   */
  async hasDesignSystem(projectPath: string): Promise<boolean> {
    // Check for common design system indicators
    const indicators = [
      // Custom design system
      'src/styles/tokens.css',
      'src/styles/design-tokens.css',
      'src/design-system',
      'src/components/ui/Button.tsx',
      'src/components/ui/Button.jsx',
      'src/theme/index.ts',
      'src/theme/index.js',
      // Tailwind (counts as a design system)
      'tailwind.config.js',
      'tailwind.config.ts',
      // shadcn/ui
      'components.json',
      // Chakra UI
      'src/theme.ts',
      // Material UI
      'src/theme/theme.ts',
    ];

    for (const indicator of indicators) {
      const fullPath = path.join(projectPath, indicator);
      if (existsSync(fullPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get information about the existing design system
   */
  async getDesignSystemInfo(projectPath: string, techStack: TechStack): Promise<DesignSystemInfo | null> {
    const hasDS = await this.hasDesignSystem(projectPath);
    if (!hasDS) {
      return null;
    }

    // Determine paths based on what exists
    let tokensPath = '';
    let componentsPath = '';
    let themePath: string | undefined;
    const availableComponents: string[] = [];

    // Check for tokens
    const tokenPaths = [
      'src/styles/tokens.css',
      'src/styles/design-tokens.css',
      'src/styles/variables.css',
    ];
    for (const tp of tokenPaths) {
      if (existsSync(path.join(projectPath, tp))) {
        tokensPath = tp;
        break;
      }
    }

    // Check for components directory
    const componentDirs = [
      'src/components/ui',
      'src/components/common',
      'components/ui',
    ];
    for (const cd of componentDirs) {
      const fullPath = path.join(projectPath, cd);
      if (existsSync(fullPath)) {
        componentsPath = cd;
        // List available components
        try {
          const files = readdirSync(fullPath);
          for (const file of files) {
            if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
              const componentName = file.replace(/\.(tsx|jsx)$/, '');
              if (componentName !== 'index') {
                availableComponents.push(componentName);
              }
            }
          }
        } catch {
          // Ignore read errors
        }
        break;
      }
    }

    // Check for theme
    const themePaths = [
      'src/theme/index.ts',
      'src/theme/index.js',
      'src/theme.ts',
    ];
    for (const tp of themePaths) {
      if (existsSync(path.join(projectPath, tp))) {
        themePath = tp;
        break;
      }
    }

    // Extract colors from tokens if possible
    const colors = await this.extractColors(projectPath, tokensPath, techStack);
    const spacing = this.getDefaultSpacing(techStack);

    const result: DesignSystemInfo = {
      tokensPath: tokensPath || 'src/styles/tokens.css',
      componentsPath: componentsPath || 'src/components/ui',
      availableComponents,
      colors,
      spacing,
      generated: true,
      generatedAt: new Date(),
    };

    if (themePath) {
      result.themePath = themePath;
    }

    return result;
  }

  /**
   * Extract color values from design tokens
   */
  private async extractColors(
    projectPath: string,
    tokensPath: string,
    techStack: TechStack
  ): Promise<DesignSystemInfo['colors']> {
    const defaultColors: DesignSystemInfo['colors'] = {
      primary: '#3b82f6',
      secondary: '#64748b',
      accent: '#8b5cf6',
      background: '#ffffff',
      foreground: '#0f172a',
      muted: '#f1f5f9',
      border: '#e2e8f0',
      error: '#ef4444',
      success: '#22c55e',
      warning: '#f59e0b',
    };

    if (!tokensPath) {
      return defaultColors;
    }

    try {
      const fullPath = path.join(projectPath, tokensPath);
      if (!existsSync(fullPath)) {
        return defaultColors;
      }

      const content = await readFile(fullPath, 'utf-8');

      // Try to extract CSS custom properties
      const colorPatterns: Record<string, RegExp> = {
        primary: /--color-primary:\s*([^;]+);/,
        secondary: /--color-secondary:\s*([^;]+);/,
        accent: /--color-accent:\s*([^;]+);/,
        background: /--color-background:\s*([^;]+);/,
        foreground: /--color-foreground:\s*([^;]+);/,
        muted: /--color-muted:\s*([^;]+);/,
        border: /--color-border:\s*([^;]+);/,
        error: /--color-error:\s*([^;]+);/,
        success: /--color-success:\s*([^;]+);/,
        warning: /--color-warning:\s*([^;]+);/,
      };

      const colors = { ...defaultColors };
      for (const [key, pattern] of Object.entries(colorPatterns)) {
        const match = content.match(pattern);
        if (match && match[1]) {
          colors[key as keyof typeof colors] = match[1].trim();
        }
      }

      return colors;
    } catch {
      return defaultColors;
    }
  }

  /**
   * Get default spacing values based on styling approach
   */
  private getDefaultSpacing(techStack: TechStack): DesignSystemInfo['spacing'] {
    if (techStack.styling === 'tailwind') {
      return {
        xs: '0.25rem',  // 1
        sm: '0.5rem',   // 2
        md: '1rem',     // 4
        lg: '1.5rem',   // 6
        xl: '2rem',     // 8
      };
    }

    return {
      xs: '4px',
      sm: '8px',
      md: '16px',
      lg: '24px',
      xl: '32px',
    };
  }

  /**
   * Create default design system info for a new project
   */
  createDefaultDesignSystemInfo(techStack: TechStack): DesignSystemInfo {
    const result: DesignSystemInfo = {
      tokensPath: 'src/styles/tokens.css',
      componentsPath: 'src/components/ui',
      availableComponents: ['Button', 'Input', 'Card', 'Modal', 'Select', 'Checkbox', 'Badge', 'Avatar'],
      colors: {
        primary: '#3b82f6',
        secondary: '#64748b',
        accent: '#8b5cf6',
        background: '#ffffff',
        foreground: '#0f172a',
        muted: '#f1f5f9',
        border: '#e2e8f0',
        error: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
      },
      spacing: this.getDefaultSpacing(techStack),
      generated: true,
      generatedAt: new Date(),
    };

    if (techStack.frontend === 'nextjs') {
      result.themePath = 'src/theme/index.ts';
    }

    return result;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDesignController(sessionManager: SessionManager): DesignController {
  return new DesignController(sessionManager);
}
