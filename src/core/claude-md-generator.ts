/**
 * CLAUDE.md Generator
 *
 * Generates project context files (CLAUDE.md) for Claude Code.
 * These files provide Claude Code with essential information about:
 * - Tech stack configuration
 * - Project structure conventions
 * - MCP server availability
 * - Testing requirements and coverage targets
 * - Code conventions and patterns
 * - Build commands
 *
 * @module claude-md-generator
 */

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TechStack } from './types.js';
import { createSecretsManager, type SecretEnvironment } from './secrets-manager.js';
import { getProjectRegistry } from './project-registry.js';

// ============================================================================
// Types
// ============================================================================

export interface ClaudeMdConfig {
  techStack: TechStack;
  projectName: string;
  projectPath: string;
  unitTesting: {
    framework: 'vitest';
    coverageThreshold: number;
  };
  mcpServers: string[];
}

export interface RegenerateOptions {
  /** Inject secrets into template placeholders */
  injectSecrets?: boolean | undefined;
  /** Environment to use when injecting secrets (default: 'development') */
  environment?: SecretEnvironment | undefined;
  /** Include cloud service URLs in the output */
  includeCloudServices?: boolean | undefined;
}

// ============================================================================
// CLAUDE.md Generator
// ============================================================================

export class ClaudeMdGenerator {
  /**
   * Generate CLAUDE.md content based on configuration
   */
  generateContent(config: ClaudeMdConfig): string {
    const { techStack, projectName, unitTesting, mcpServers } = config;

    const sections: string[] = [
      this.generateHeader(projectName),
      this.generateTechStack(techStack),
      this.generateProjectStructure(techStack),
    ];

    // Add Supabase section if using Supabase
    if (techStack.database === 'supabase') {
      sections.push(this.generateSupabaseSection());
    }

    // Add shadcn section if using Tailwind (shadcn requires Tailwind)
    if (techStack.styling === 'tailwind') {
      sections.push(this.generateShadcnSection());
    }

    sections.push(
      this.generateMcpSection(mcpServers),
      this.generateTestingSection(techStack, unitTesting),
      this.generateCodeConventions(techStack),
      this.generateBuildCommands(techStack),
    );

    return sections.join('\n\n');
  }

  /**
   * Write CLAUDE.md to project root
   */
  async writeClaudeMd(projectPath: string, content: string): Promise<void> {
    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
    await writeFile(claudeMdPath, content, 'utf-8');
  }

  /**
   * Regenerate CLAUDE.md with new configuration
   */
  async regenerate(
    projectPath: string,
    config: ClaudeMdConfig,
    options?: RegenerateOptions
  ): Promise<void> {
    let content = this.generateContent(config);

    // Add cloud services section if requested and available
    if (options?.includeCloudServices) {
      const cloudServicesSection = await this.generateCloudServicesSection(projectPath);
      if (cloudServicesSection) {
        content += '\n\n' + cloudServicesSection;
      }
    }

    // Inject secrets if requested
    if (options?.injectSecrets) {
      content = this.resolveTemplates(projectPath, content, options.environment ?? 'development');
    }

    await this.writeClaudeMd(projectPath, content);
  }

  /**
   * Check if CLAUDE.md exists in project
   */
  exists(projectPath: string): boolean {
    return existsSync(path.join(projectPath, 'CLAUDE.md'));
  }

  /**
   * Read existing CLAUDE.md content
   */
  async read(projectPath: string): Promise<string | null> {
    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) {
      return null;
    }
    return readFile(claudeMdPath, 'utf-8');
  }

  // ============================================================================
  // Section Generators
  // ============================================================================

  private generateHeader(projectName: string): string {
    return `# Project: ${projectName}

This file provides context for Claude Code when working on this project.`;
  }

  private generateTechStack(techStack: TechStack): string {
    return `## Tech Stack

- **Frontend**: ${this.formatTechName(techStack.frontend)}
- **Backend**: ${this.formatTechName(techStack.backend)}
- **Database**: ${this.formatTechName(techStack.database)}
- **E2E Testing**: ${this.formatTechName(techStack.testing)}
- **Unit Testing**: Vitest
- **Styling**: ${this.formatTechName(techStack.styling)}`;
  }

  private generateProjectStructure(techStack: TechStack): string {
    const structures: Record<string, string> = {
      nextjs: `## Project Structure

\`\`\`
src/
├── app/              # Next.js App Router pages
├── components/       # React components
│   ├── ui/          # Base UI components (Button, Input, etc.)
│   └── features/    # Feature-specific components
├── lib/             # Utility functions and helpers
├── hooks/           # Custom React hooks
├── styles/          # Global styles and design tokens
├── types/           # TypeScript type definitions
└── api/             # API route handlers (if using route handlers)
\`\`\``,

      react: `## Project Structure

\`\`\`
src/
├── components/       # React components
│   ├── ui/          # Base UI components
│   └── features/    # Feature-specific components
├── pages/           # Page components
├── hooks/           # Custom React hooks
├── lib/             # Utility functions
├── styles/          # Styles and design tokens
└── types/           # TypeScript types
\`\`\``,

      vue: `## Project Structure

\`\`\`
src/
├── components/       # Vue components
│   ├── ui/          # Base UI components
│   └── features/    # Feature-specific components
├── views/           # Page/view components
├── composables/     # Vue composables (hooks)
├── stores/          # Pinia stores
├── lib/             # Utility functions
└── types/           # TypeScript types
\`\`\``,

      svelte: `## Project Structure

\`\`\`
src/
├── lib/
│   ├── components/  # Svelte components
│   │   ├── ui/     # Base UI components
│   │   └── features/
│   ├── stores/     # Svelte stores
│   └── utils/      # Utility functions
├── routes/          # SvelteKit routes
└── app.d.ts         # TypeScript declarations
\`\`\``,
    };

    return structures[techStack.frontend] ?? structures['react'] ?? '';
  }

  private generateMcpSection(mcpServers: string[]): string {
    const serverList = mcpServers.length > 0
      ? mcpServers.map(s => `- ${s}`).join('\n')
      : '- claude-in-chrome (browser automation)';

    return `## MCP Server Configuration

This project uses **Claude-in-Chrome MCP** for browser automation.

### Available MCP Servers
${serverList}

### Browser Automation Guidelines
- **Use Claude Chrome MCP** for all browser interactions and testing
- Chrome MCP provides real browser context with full DevTools access
- Available tools: navigate, read_page, find, computer (click/type/screenshot), form_input
- Use for: visual testing, form interactions, debugging UI, E2E verification`;
  }

  private generateTestingSection(
    techStack: TechStack,
    unitTesting: ClaudeMdConfig['unitTesting']
  ): string {
    const useChromeMcp = techStack.testing === 'chrome-mcp';

    const e2eSection = useChromeMcp
      ? `### Browser Testing (Chrome MCP)

Use Claude Chrome MCP for E2E and integration testing.

#### Chrome MCP Tools
- \`mcp__claude-in-chrome__navigate\` - Navigate to URLs
- \`mcp__claude-in-chrome__read_page\` - Get accessibility tree
- \`mcp__claude-in-chrome__find\` - Find elements by description
- \`mcp__claude-in-chrome__computer\` - Click, type, scroll, screenshot
- \`mcp__claude-in-chrome__form_input\` - Fill form fields

#### Testing Workflow
1. Start dev server: \`npm run dev\`
2. Navigate to app URL
3. Interact with UI elements
4. Verify expected outcomes
5. Take screenshots to document state`
      : `### E2E Tests (Cypress)

E2E tests verify user flows and acceptance criteria.

- **Run**: \`npx cypress run\`
- **Location**: \`cypress/e2e/\` directory
- Focus on critical user journeys, not implementation details`;

    return `## Testing Requirements

### Unit Tests (Vitest)

All new code must include unit tests.

- **Test files**: \`*.test.ts\` or \`*.spec.ts\` co-located with source files
- **Run tests**: \`npm run test\`
- **Watch mode**: \`npm run test\` (runs in watch by default)
- **Coverage**: \`npm run test:coverage\`
- **Coverage target**: ${unitTesting.coverageThreshold}%

#### What to Test
- Business logic and utility functions
- React/Vue/Svelte component rendering and interactions
- API route handlers and middleware
- Error handling and edge cases
- Custom hooks/composables

#### Test Structure
\`\`\`typescript
import { describe, it, expect } from 'vitest';

describe('ComponentName', () => {
  it('should handle the happy path', () => {
    // Arrange
    // Act
    // Assert
  });

  it('should handle edge cases', () => {
    // Test error states, empty inputs, etc.
  });
});
\`\`\`

${e2eSection}`;
  }

  private generateCodeConventions(techStack: TechStack): string {
    const conventions: string[] = [
      `## Code Conventions`,
      '',
      '### General',
      '- Use TypeScript for all new code',
      '- Prefer named exports over default exports',
      '- Use async/await over .then() chains',
      '- Handle errors explicitly, avoid silent failures',
    ];

    // Framework-specific conventions
    if (techStack.frontend === 'nextjs' || techStack.frontend === 'react') {
      conventions.push(
        '',
        '### React/Next.js',
        '- Use functional components with hooks',
        '- Prefer Server Components where possible (Next.js)',
        '- Use `use client` directive only when needed',
        '- Co-locate component tests: `Button.tsx` → `Button.test.tsx`',
        "- Import order: react, next, third-party, local (@/)",
      );
    } else if (techStack.frontend === 'vue') {
      conventions.push(
        '',
        '### Vue',
        '- Use Composition API with `<script setup>`',
        '- Use Pinia for state management',
        '- Co-locate component tests with source files',
        '- Use auto-imports for Vue APIs',
      );
    } else if (techStack.frontend === 'svelte') {
      conventions.push(
        '',
        '### Svelte',
        '- Use TypeScript in components',
        '- Prefer Svelte stores for shared state',
        '- Use +page.server.ts for server-side logic',
        '- Co-locate component tests with source files',
      );
    }

    // Styling conventions
    if (techStack.styling === 'tailwind') {
      conventions.push(
        '',
        '### Styling (Tailwind CSS)',
        '- Use design tokens from tailwind.config.ts',
        '- Extract repeated patterns to @apply classes',
        '- Use cn() utility for conditional classes',
        '- Follow mobile-first responsive design',
      );
    } else if (techStack.styling === 'css-modules') {
      conventions.push(
        '',
        '### Styling (CSS Modules)',
        '- Use .module.css files co-located with components',
        '- Use design tokens via CSS custom properties',
        '- Prefer composition over inheritance',
      );
    } else if (techStack.styling === 'styled-components') {
      conventions.push(
        '',
        '### Styling (Styled Components)',
        '- Define styled components in separate .styles.ts files',
        '- Use theme provider for design tokens',
        '- Prefer transient props ($prop) for styling-only props',
      );
    }

    return conventions.join('\n');
  }

  private generateSupabaseSection(): string {
    return `## Supabase Integration

This project uses **Supabase** for database, authentication, and realtime features.

### Client Setup
\`\`\`typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
\`\`\`

### Available Features
- **Database**: PostgreSQL with Row Level Security (RLS)
- **Auth**: Email/password, OAuth providers, magic links
- **Realtime**: Subscribe to database changes
- **Storage**: File uploads and management

### Environment Variables
- \`NEXT_PUBLIC_SUPABASE_URL\` - Supabase project URL
- \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` - Public client key
- \`SUPABASE_SERVICE_ROLE_KEY\` - Server-side key (never expose to client)

### Best Practices
- Use RLS policies for data access control
- Use Server Components for authenticated data fetching
- Use \`supabase.auth.getUser()\` to verify sessions server-side
- Store service role key only in server environment`;
  }

  private generateShadcnSection(): string {
    return `## UI Components (shadcn/ui)

This project uses **shadcn/ui** for accessible, customizable UI components.

### Available Components
Located in \`src/components/ui/\`:
- Button, Input, Card, Label, Form (base components)

### Adding More Components
\`\`\`bash
npx shadcn@latest add [component-name]
\`\`\`

Common additions: dialog, dropdown-menu, select, checkbox, badge, avatar, alert

### Styling Guidelines
- Components use CSS variables from \`globals.css\`
- Use the \`cn()\` utility for conditional class merging:
\`\`\`typescript
import { cn } from "@/lib/utils"
cn("base-class", condition && "conditional-class")
\`\`\`
- Customize component styles via the \`className\` prop
- Theme colors are in \`tailwind.config.ts\``;
  }

  private generateBuildCommands(techStack: TechStack): string {
    const devCommand = techStack.frontend === 'nextjs'
      ? 'npm run dev'
      : 'npm run dev';

    const buildCommand = 'npm run build';

    return `## Build Commands

| Command | Description |
|---------|-------------|
| \`${devCommand}\` | Start development server |
| \`${buildCommand}\` | Build for production |
| \`npm run test\` | Run unit tests (watch mode) |
| \`npm run test:coverage\` | Run tests with coverage report |
| \`npm run lint\` | Run ESLint |
| \`npm run typecheck\` | Run TypeScript type checking |`;
  }

  // ============================================================================
  // Template Resolution
  // ============================================================================

  /**
   * Resolve template placeholders in content
   *
   * Supported placeholders:
   * - {{secrets.env.key}} - Resolve secrets (e.g., {{secrets.production.supabase_url}})
   * - {{cloud.service.field}} - Resolve cloud service URLs (e.g., {{cloud.github.url}})
   */
  private resolveTemplates(
    projectPath: string,
    content: string,
    defaultEnv: SecretEnvironment
  ): string {
    // Resolve secrets placeholders: {{secrets.env.key}}
    content = content.replace(
      /\{\{secrets\.(\w+)\.(\w+)\}\}/g,
      (match, envStr: string, key: string) => {
        const env = this.parseEnvironment(envStr) ?? defaultEnv;
        const secrets = createSecretsManager(projectPath);
        const value = secrets.getSecret(env, key);
        return value ?? match; // Keep original if not found
      }
    );

    // Resolve cloud service placeholders: {{cloud.service.field}}
    content = content.replace(
      /\{\{cloud\.(\w+)\.(\w+)\}\}/g,
      (match, service: string, field: string) => {
        const registry = getProjectRegistry();
        const project = registry.getProject(projectPath);
        if (!project?.cloudServices) return match;

        const serviceUrl = project.cloudServices[service as keyof typeof project.cloudServices];
        if (!serviceUrl) return match;

        // For now, we only support 'url' field
        if (field === 'url') {
          return serviceUrl;
        }

        return match;
      }
    );

    return content;
  }

  /**
   * Parse environment string to SecretEnvironment type
   */
  private parseEnvironment(env: string): SecretEnvironment | null {
    if (env === 'development' || env === 'staging' || env === 'production') {
      return env;
    }
    return null;
  }

  /**
   * Generate cloud services section from project registry
   */
  private async generateCloudServicesSection(projectPath: string): Promise<string | null> {
    const registry = getProjectRegistry();
    const project = registry.getProject(projectPath);

    if (!project?.cloudServices) {
      return null;
    }

    const { github, supabase, vercel } = project.cloudServices;

    if (!github && !supabase && !vercel) {
      return null;
    }

    const lines = ['## Cloud Services', ''];

    if (github) {
      lines.push(`- **GitHub**: ${github}`);
    }
    if (supabase) {
      lines.push(`- **Supabase**: ${supabase}`);
    }
    if (vercel) {
      lines.push(`- **Vercel**: ${vercel}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate environment configuration section with secrets placeholders
   */
  generateEnvironmentSection(envs: SecretEnvironment[] = ['production', 'staging', 'development']): string {
    const sections: string[] = ['## Environment Configuration', ''];

    for (const env of envs) {
      const envName = env.charAt(0).toUpperCase() + env.slice(1);
      sections.push(`### ${envName}`);
      sections.push('```');
      sections.push(`SUPABASE_URL={{secrets.${env}.supabase_url}}`);
      sections.push(`SUPABASE_ANON_KEY={{secrets.${env}.supabase_anon_key}}`);
      sections.push('```');
      sections.push('');
    }

    return sections.join('\n');
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private formatTechName(tech: string): string {
    const names: Record<string, string> = {
      nextjs: 'Next.js',
      react: 'React',
      vue: 'Vue 3',
      svelte: 'SvelteKit',
      express: 'Express',
      fastify: 'Fastify',
      nestjs: 'NestJS',
      hono: 'Hono',
      postgresql: 'PostgreSQL',
      sqlite: 'SQLite',
      mongodb: 'MongoDB',
      supabase: 'Supabase',
      'chrome-mcp': 'Chrome MCP',
      cypress: 'Cypress',
      vitest: 'Vitest',
      tailwind: 'Tailwind CSS',
      'css-modules': 'CSS Modules',
      'styled-components': 'Styled Components',
    };
    return names[tech] ?? tech;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createClaudeMdGenerator(): ClaudeMdGenerator {
  return new ClaudeMdGenerator();
}
