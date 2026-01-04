/**
 * shadcn/ui Setup
 *
 * Handles installation and configuration of shadcn/ui component library.
 * Installs minimal base components during project initialization.
 *
 * @module shadcn-setup
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface ShadcnSetupResult {
  success: boolean;
  initialized: boolean;
  componentsInstalled: string[];
  errors: string[];
}

export interface ShadcnConfig {
  style: string;
  rsc: boolean;
  tsx: boolean;
  tailwind: {
    config: string;
    css: string;
  };
  aliases: {
    components: string;
    utils: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimal set of essential components installed by default
 */
export const MINIMAL_COMPONENTS = ['button', 'input', 'card', 'label', 'form'];

/**
 * Standard set includes minimal plus common UI elements
 */
export const STANDARD_COMPONENTS = [
  ...MINIMAL_COMPONENTS,
  'dialog',
  'dropdown-menu',
  'select',
  'checkbox',
  'badge',
  'avatar',
  'alert',
];

// ============================================================================
// Setup Functions
// ============================================================================

/**
 * Initialize and set up shadcn/ui in a project
 *
 * @param projectPath - Path to the project
 * @param options - Setup options
 * @returns Setup result with list of installed components
 */
export async function setupShadcn(
  projectPath: string,
  options: {
    components?: string[];
    skipInit?: boolean;
  } = {}
): Promise<ShadcnSetupResult> {
  const result: ShadcnSetupResult = {
    success: false,
    initialized: false,
    componentsInstalled: [],
    errors: [],
  };

  // Check if project has package.json
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    result.errors.push('No package.json found - is this a Node.js project?');
    return result;
  }

  // Check if already initialized
  if (isShadcnInstalled(projectPath)) {
    result.initialized = true;
  }

  // Initialize shadcn/ui if not already done
  if (!result.initialized && !options.skipInit) {
    const initSuccess = await initializeShadcn(projectPath);
    if (!initSuccess.success) {
      result.errors.push(...initSuccess.errors);
      return result;
    }
    result.initialized = true;
  }

  // Install components
  const components = options.components ?? MINIMAL_COMPONENTS;

  for (const component of components) {
    const addResult = addComponent(projectPath, component);
    if (addResult.success) {
      result.componentsInstalled.push(component);
    } else {
      result.errors.push(`Failed to install ${component}: ${addResult.error}`);
    }
  }

  result.success = result.componentsInstalled.length > 0;
  return result;
}

/**
 * Initialize shadcn/ui in a project
 */
async function initializeShadcn(
  projectPath: string
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Run shadcn init with defaults
  // -y: yes to all prompts
  // -d: use defaults
  const initResult = spawnSync('npx', ['shadcn@latest', 'init', '-y', '-d'], {
    cwd: projectPath,
    stdio: 'pipe',
    encoding: 'utf-8',
    timeout: 120000, // 2 minute timeout
  });

  if (initResult.status !== 0) {
    const errorMsg = initResult.stderr || initResult.stdout || 'shadcn init failed';
    errors.push(errorMsg.trim());
    return { success: false, errors };
  }

  return { success: true, errors: [] };
}

/**
 * Add a single component to the project
 */
function addComponent(
  projectPath: string,
  componentName: string
): { success: boolean; error?: string } {
  const addResult = spawnSync(
    'npx',
    ['shadcn@latest', 'add', componentName, '-y', '--overwrite'],
    {
      cwd: projectPath,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000, // 1 minute timeout per component
    }
  );

  if (addResult.status !== 0) {
    const error = addResult.stderr || addResult.stdout || 'Unknown error';
    return { success: false, error: error.trim() };
  }

  return { success: true };
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Check if shadcn/ui is already installed in a project
 */
export function isShadcnInstalled(projectPath: string): boolean {
  return existsSync(path.join(projectPath, 'components.json'));
}

/**
 * Get shadcn/ui configuration from a project
 */
export function getShadcnConfig(projectPath: string): ShadcnConfig | null {
  const configPath = path.join(projectPath, 'components.json');

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as ShadcnConfig;
  } catch {
    return null;
  }
}

/**
 * Get list of installed shadcn components
 */
export function getInstalledComponents(projectPath: string): string[] {
  const config = getShadcnConfig(projectPath);
  if (!config) {
    return [];
  }

  // Check the components/ui directory
  const componentsPath = path.join(projectPath, 'src', 'components', 'ui');
  if (!existsSync(componentsPath)) {
    return [];
  }

  try {
    const { readdirSync } = require('node:fs');
    const files = readdirSync(componentsPath) as string[];

    // Extract component names from filenames (e.g., button.tsx -> button)
    return files
      .filter((f: string) => f.endsWith('.tsx'))
      .map((f: string) => f.replace('.tsx', ''));
  } catch {
    return [];
  }
}

/**
 * Check if a specific component is installed
 */
export function isComponentInstalled(
  projectPath: string,
  componentName: string
): boolean {
  const componentsPath = path.join(projectPath, 'src', 'components', 'ui');
  return existsSync(path.join(componentsPath, `${componentName}.tsx`));
}
