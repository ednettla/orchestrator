/**
 * Vitest Setup Utility
 *
 * Configures Vitest unit testing in target projects.
 * Handles:
 * - Adding vitest and coverage dependencies to package.json
 * - Creating vitest.config.ts with framework-specific settings
 * - Adding test scripts (test, test:coverage, test:ui)
 * - Installing testing-library for React/Vue/Svelte projects
 *
 * This utility is called during `orchestrate init` to ensure
 * all generated code has proper unit test infrastructure.
 *
 * @module vitest-setup
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TechStack } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface VitestSetupResult {
  success: boolean;
  configCreated: boolean;
  dependenciesAdded: boolean;
  scriptsAdded: boolean;
  errors: string[];
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// ============================================================================
// Vitest Setup
// ============================================================================

/**
 * Setup Vitest in a target project
 * - Checks if vitest is already configured
 * - Adds vitest and coverage dependencies if missing
 * - Creates vitest.config.ts if it doesn't exist
 * - Adds test scripts to package.json
 */
export async function setupVitest(
  projectPath: string,
  techStack?: TechStack
): Promise<VitestSetupResult> {
  const result: VitestSetupResult = {
    success: true,
    configCreated: false,
    dependenciesAdded: false,
    scriptsAdded: false,
    errors: [],
  };

  const packageJsonPath = path.join(projectPath, 'package.json');
  const vitestConfigPath = path.join(projectPath, 'vitest.config.ts');

  // Check if package.json exists
  if (!existsSync(packageJsonPath)) {
    result.errors.push('No package.json found - cannot setup Vitest');
    result.success = false;
    return result;
  }

  try {
    // Read package.json
    const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
    const packageJson: PackageJson = JSON.parse(packageJsonContent);

    // Check if vitest is already a dependency
    const hasVitest =
      packageJson.devDependencies?.['vitest'] || packageJson.dependencies?.['vitest'];

    // Add dependencies if not present
    if (!hasVitest) {
      packageJson.devDependencies = packageJson.devDependencies ?? {};
      packageJson.devDependencies['vitest'] = '^2.1.0';
      packageJson.devDependencies['@vitest/coverage-v8'] = '^2.1.0';

      // Add testing library based on frontend framework
      if (techStack?.frontend === 'react' || techStack?.frontend === 'nextjs') {
        packageJson.devDependencies['@testing-library/react'] = '^16.0.0';
        packageJson.devDependencies['@testing-library/jest-dom'] = '^6.6.0';
        packageJson.devDependencies['jsdom'] = '^25.0.0';
      } else if (techStack?.frontend === 'vue') {
        packageJson.devDependencies['@testing-library/vue'] = '^8.0.0';
        packageJson.devDependencies['jsdom'] = '^25.0.0';
      } else if (techStack?.frontend === 'svelte') {
        packageJson.devDependencies['@testing-library/svelte'] = '^5.0.0';
        packageJson.devDependencies['jsdom'] = '^25.0.0';
      }

      result.dependenciesAdded = true;
    }

    // Add test scripts if not present
    packageJson.scripts = packageJson.scripts ?? {};
    let scriptsChanged = false;

    if (!packageJson.scripts['test']) {
      packageJson.scripts['test'] = 'vitest';
      scriptsChanged = true;
    }
    if (!packageJson.scripts['test:coverage']) {
      packageJson.scripts['test:coverage'] = 'vitest --coverage';
      scriptsChanged = true;
    }
    if (!packageJson.scripts['test:ui']) {
      packageJson.scripts['test:ui'] = 'vitest --ui';
      scriptsChanged = true;
    }

    if (scriptsChanged) {
      result.scriptsAdded = true;
    }

    // Write updated package.json
    if (result.dependenciesAdded || result.scriptsAdded) {
      await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
    }

    // Create vitest.config.ts if it doesn't exist
    if (!existsSync(vitestConfigPath)) {
      const configContent = generateVitestConfig(techStack);
      await writeFile(vitestConfigPath, configContent, 'utf-8');
      result.configCreated = true;
    }
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Generate vitest.config.ts content based on tech stack
 */
export function generateVitestConfig(techStack?: TechStack): string {
  const isReact = techStack?.frontend === 'react' || techStack?.frontend === 'nextjs';
  const isVue = techStack?.frontend === 'vue';
  const isSvelte = techStack?.frontend === 'svelte';

  const imports: string[] = ["import { defineConfig } from 'vitest/config';"];
  const plugins: string[] = [];

  if (isReact) {
    imports.push("import react from '@vitejs/plugin-react';");
    plugins.push('react()');
  } else if (isVue) {
    imports.push("import vue from '@vitejs/plugin-vue';");
    plugins.push('vue()');
  } else if (isSvelte) {
    imports.push("import { svelte } from '@sveltejs/vite-plugin-svelte';");
    plugins.push('svelte()');
  }

  const environment = isReact || isVue || isSvelte ? 'jsdom' : 'node';

  return `${imports.join('\n')}

export default defineConfig({
  ${plugins.length > 0 ? `plugins: [${plugins.join(', ')}],\n  ` : ''}test: {
    globals: true,
    environment: '${environment}',
    include: ['**/*.{test,spec}.{ts,tsx,js,jsx}'],
    exclude: ['node_modules', 'dist', '.orchestrator'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'dist',
        '.orchestrator',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
`;
}

/**
 * Check if Vitest is already configured in a project
 */
export function isVitestConfigured(projectPath: string): boolean {
  const vitestConfigPath = path.join(projectPath, 'vitest.config.ts');
  const vitestConfigJsPath = path.join(projectPath, 'vitest.config.js');
  const vitestConfigMtsPath = path.join(projectPath, 'vitest.config.mts');

  return (
    existsSync(vitestConfigPath) || existsSync(vitestConfigJsPath) || existsSync(vitestConfigMtsPath)
  );
}
