import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TechStack } from './types.js';

// ============================================================================
// Tech Stack Detector
// ============================================================================

export interface DetectionResult {
  detected: Partial<TechStack>;
  confidence: Record<keyof TechStack, 'high' | 'medium' | 'low' | 'none'>;
  sources: Record<keyof TechStack, string[]>;
}

export async function detectTechStack(projectPath: string): Promise<DetectionResult> {
  const result: DetectionResult = {
    detected: {},
    confidence: {
      frontend: 'none',
      backend: 'none',
      database: 'none',
      testing: 'none',
      unitTesting: 'high', // Always vitest
      styling: 'none',
    },
    sources: {
      frontend: [],
      backend: [],
      database: [],
      testing: [],
      unitTesting: ['default'],
      styling: [],
    },
  };

  // Read package.json
  const pkgPath = path.join(projectPath, 'package.json');
  let deps: Record<string, string> = {};
  let devDeps: Record<string, string> = {};

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = pkg.dependencies ?? {};
      devDeps = pkg.devDependencies ?? {};
    } catch {
      // Invalid package.json, continue with empty deps
    }
  }

  const allDeps = { ...deps, ...devDeps };

  // Detect frontend
  const frontendResult = detectFrontend(allDeps);
  if (frontendResult) {
    result.detected.frontend = frontendResult.value;
    result.confidence.frontend = frontendResult.confidence;
    result.sources.frontend = frontendResult.sources;
  }

  // Detect backend
  const backendResult = detectBackend(allDeps);
  if (backendResult) {
    result.detected.backend = backendResult.value;
    result.confidence.backend = backendResult.confidence;
    result.sources.backend = backendResult.sources;
  }

  // Detect database
  const databaseResult = await detectDatabase(projectPath, allDeps);
  if (databaseResult) {
    result.detected.database = databaseResult.value;
    result.confidence.database = databaseResult.confidence;
    result.sources.database = databaseResult.sources;
  }

  // Detect testing
  const testingResult = await detectTesting(projectPath, allDeps);
  if (testingResult) {
    result.detected.testing = testingResult.value;
    result.confidence.testing = testingResult.confidence;
    result.sources.testing = testingResult.sources;
  }

  // Detect styling
  const stylingResult = await detectStyling(projectPath, allDeps);
  if (stylingResult) {
    result.detected.styling = stylingResult.value;
    result.confidence.styling = stylingResult.confidence;
    result.sources.styling = stylingResult.sources;
  }

  return result;
}

// ============================================================================
// Detection Helpers
// ============================================================================

interface DetectionMatch<T> {
  value: T;
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
}

function detectFrontend(deps: Record<string, string>): DetectionMatch<TechStack['frontend']> | null {
  // Check for Next.js (highest priority - it includes React)
  if ('next' in deps) {
    return { value: 'nextjs', confidence: 'high', sources: ['package.json: next'] };
  }

  // Check for SvelteKit
  if ('@sveltejs/kit' in deps || 'svelte' in deps) {
    return { value: 'svelte', confidence: 'high', sources: ['package.json: svelte'] };
  }

  // Check for Vue
  if ('vue' in deps || 'nuxt' in deps) {
    return { value: 'vue', confidence: 'high', sources: ['package.json: vue'] };
  }

  // Check for React (standalone, not Next.js)
  if ('react' in deps) {
    return { value: 'react', confidence: 'high', sources: ['package.json: react'] };
  }

  return null;
}

function detectBackend(deps: Record<string, string>): DetectionMatch<TechStack['backend']> | null {
  // Check for NestJS
  if ('@nestjs/core' in deps) {
    return { value: 'nestjs', confidence: 'high', sources: ['package.json: @nestjs/core'] };
  }

  // Check for Hono
  if ('hono' in deps) {
    return { value: 'hono', confidence: 'high', sources: ['package.json: hono'] };
  }

  // Check for Fastify
  if ('fastify' in deps) {
    return { value: 'fastify', confidence: 'high', sources: ['package.json: fastify'] };
  }

  // Check for Express
  if ('express' in deps) {
    return { value: 'express', confidence: 'high', sources: ['package.json: express'] };
  }

  return null;
}

async function detectDatabase(
  projectPath: string,
  deps: Record<string, string>
): Promise<DetectionMatch<TechStack['database']> | null> {
  const sources: string[] = [];

  // Check for Supabase
  if ('@supabase/supabase-js' in deps) {
    return { value: 'supabase', confidence: 'high', sources: ['package.json: @supabase/supabase-js'] };
  }

  // Check for MongoDB
  if ('mongoose' in deps || 'mongodb' in deps) {
    return { value: 'mongodb', confidence: 'high', sources: ['package.json: mongoose/mongodb'] };
  }

  // Check for Prisma schema
  const prismaSchemaPath = path.join(projectPath, 'prisma', 'schema.prisma');
  if (existsSync(prismaSchemaPath)) {
    try {
      const schema = await readFile(prismaSchemaPath, 'utf-8');

      if (schema.includes('provider = "postgresql"') || schema.includes('provider = "postgres"')) {
        return { value: 'postgresql', confidence: 'high', sources: ['prisma/schema.prisma: postgresql'] };
      }

      if (schema.includes('provider = "sqlite"')) {
        return { value: 'sqlite', confidence: 'high', sources: ['prisma/schema.prisma: sqlite'] };
      }

      if (schema.includes('provider = "mongodb"')) {
        return { value: 'mongodb', confidence: 'high', sources: ['prisma/schema.prisma: mongodb'] };
      }
    } catch {
      // Failed to read schema
    }
  }

  // Check for pg/postgres packages
  if ('pg' in deps || 'postgres' in deps || '@vercel/postgres' in deps) {
    return { value: 'postgresql', confidence: 'high', sources: ['package.json: pg/postgres'] };
  }

  // Check for better-sqlite3
  if ('better-sqlite3' in deps || 'sqlite3' in deps) {
    return { value: 'sqlite', confidence: 'high', sources: ['package.json: sqlite'] };
  }

  // Check .env for DATABASE_URL
  const envPath = path.join(projectPath, '.env');
  if (existsSync(envPath)) {
    try {
      const env = await readFile(envPath, 'utf-8');
      if (env.includes('DATABASE_URL')) {
        if (env.includes('postgresql://') || env.includes('postgres://')) {
          return { value: 'postgresql', confidence: 'medium', sources: ['.env: DATABASE_URL contains postgresql'] };
        }
        if (env.includes('mongodb://') || env.includes('mongodb+srv://')) {
          return { value: 'mongodb', confidence: 'medium', sources: ['.env: DATABASE_URL contains mongodb'] };
        }
      }
    } catch {
      // Failed to read .env
    }
  }

  return null;
}

async function detectTesting(
  projectPath: string,
  deps: Record<string, string>
): Promise<DetectionMatch<TechStack['testing']> | null> {
  // Check for Cypress config files
  const cypressConfigs = [
    'cypress.config.ts',
    'cypress.config.js',
    'cypress.json',
  ];

  for (const config of cypressConfigs) {
    if (existsSync(path.join(projectPath, config))) {
      return { value: 'cypress', confidence: 'high', sources: [config] };
    }
  }

  // Check package.json dependencies
  if ('cypress' in deps) {
    return { value: 'cypress', confidence: 'high', sources: ['package.json: cypress'] };
  }

  // Default to Chrome MCP for browser testing
  return { value: 'chrome-mcp', confidence: 'medium', sources: ['default'] };
}

async function detectStyling(
  projectPath: string,
  deps: Record<string, string>
): Promise<DetectionMatch<TechStack['styling']> | null> {
  // Check for Tailwind config
  const tailwindConfigs = [
    'tailwind.config.ts',
    'tailwind.config.js',
    'tailwind.config.mjs',
    'tailwind.config.cjs',
  ];

  for (const config of tailwindConfigs) {
    if (existsSync(path.join(projectPath, config))) {
      return { value: 'tailwind', confidence: 'high', sources: [config] };
    }
  }

  // Check package.json
  if ('tailwindcss' in deps) {
    return { value: 'tailwind', confidence: 'high', sources: ['package.json: tailwindcss'] };
  }

  if ('styled-components' in deps) {
    return { value: 'styled-components', confidence: 'high', sources: ['package.json: styled-components'] };
  }

  // Check for CSS modules (look for *.module.css files)
  // This is a low-confidence detection since it's just a convention
  const srcPath = path.join(projectPath, 'src');
  if (existsSync(srcPath)) {
    // We could do a more thorough search, but for now just check package.json
    // CSS modules don't require a specific package
  }

  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatDetectionResult(result: DetectionResult): string {
  const lines: string[] = [];

  const components: (keyof TechStack)[] = ['frontend', 'backend', 'database', 'testing', 'styling'];

  for (const component of components) {
    const value = result.detected[component];
    const confidence = result.confidence[component];
    const sources = result.sources[component];

    if (value) {
      const confidenceIcon = confidence === 'high' ? '●' : confidence === 'medium' ? '◐' : '○';
      lines.push(`  ${confidenceIcon} ${component}: ${value}`);
      if (sources.length > 0) {
        lines.push(`    └─ ${sources.join(', ')}`);
      }
    } else {
      lines.push(`  ○ ${component}: not detected`);
    }
  }

  return lines.join('\n');
}
