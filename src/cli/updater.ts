import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

// ============================================================================
// Version Management
// ============================================================================

const REPO_URL = 'https://github.com/ednettla/orchestrator.git';
const INSTALL_DIR = path.join(process.env.HOME ?? '', '.orchestrator-cli');

interface VersionInfo {
  current: string;
  latest: string;
  isOutdated: boolean;
  commitsBehind: number;
}

/**
 * Get the current installed version
 */
export function getCurrentVersion(): string {
  try {
    // Try to read from package.json in install directory
    const pkgPath = path.join(INSTALL_DIR, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version ?? '0.0.0';
    }

    // Fallback to the package.json relative to this file
    const localPkgPath = path.resolve(import.meta.dirname, '../../package.json');
    if (existsSync(localPkgPath)) {
      const pkg = JSON.parse(readFileSync(localPkgPath, 'utf-8'));
      return pkg.version ?? '0.0.0';
    }

    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Get the current git commit hash
 */
export function getGitCommit(): string {
  try {
    const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: INSTALL_DIR,
      encoding: 'utf-8',
    });
    return result.stdout?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Check if updates are available
 */
export async function checkForUpdates(): Promise<VersionInfo> {
  const current = getCurrentVersion();

  try {
    // Fetch latest from remote
    spawnSync('git', ['fetch', 'origin', 'main'], {
      cwd: INSTALL_DIR,
      stdio: 'pipe',
    });

    // Get local and remote commit counts
    const localResult = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: INSTALL_DIR,
      encoding: 'utf-8',
    });

    const remoteResult = spawnSync('git', ['rev-list', '--count', 'origin/main'], {
      cwd: INSTALL_DIR,
      encoding: 'utf-8',
    });

    const localCount = parseInt(localResult.stdout?.trim() ?? '0', 10);
    const remoteCount = parseInt(remoteResult.stdout?.trim() ?? '0', 10);
    const commitsBehind = Math.max(0, remoteCount - localCount);

    // Get latest version from remote package.json
    const showResult = spawnSync('git', ['show', 'origin/main:package.json'], {
      cwd: INSTALL_DIR,
      encoding: 'utf-8',
    });

    let latest = current;
    if (showResult.stdout) {
      try {
        const remotePkg = JSON.parse(showResult.stdout);
        latest = remotePkg.version ?? current;
      } catch {
        // Ignore parse errors
      }
    }

    return {
      current,
      latest,
      isOutdated: commitsBehind > 0,
      commitsBehind,
    };
  } catch {
    return {
      current,
      latest: current,
      isOutdated: false,
      commitsBehind: 0,
    };
  }
}

/**
 * Update the installation to latest version
 */
export async function updateToLatest(options: { force?: boolean } = {}): Promise<{
  success: boolean;
  previousVersion: string;
  newVersion: string;
  error?: string;
}> {
  const previousVersion = getCurrentVersion();

  console.log(chalk.cyan('Checking for updates...\n'));

  const versionInfo = await checkForUpdates();

  if (!versionInfo.isOutdated && !options.force) {
    console.log(chalk.green('✓ Already up to date!'));
    console.log(chalk.dim(`  Version: ${versionInfo.current}`));
    return {
      success: true,
      previousVersion,
      newVersion: previousVersion,
    };
  }

  console.log(chalk.yellow(`Updates available: ${versionInfo.commitsBehind} commits behind`));
  console.log(chalk.dim(`  Current: ${versionInfo.current}`));
  console.log(chalk.dim(`  Latest:  ${versionInfo.latest}\n`));

  try {
    // Pull latest changes
    console.log(chalk.dim('Pulling latest changes...'));
    const pullResult = spawnSync('git', ['pull', 'origin', 'main'], {
      cwd: INSTALL_DIR,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    if (pullResult.status !== 0) {
      throw new Error(pullResult.stderr || 'Git pull failed');
    }

    // Install dependencies
    console.log(chalk.dim('Installing dependencies...'));
    const installResult = spawnSync('npm', ['install'], {
      cwd: INSTALL_DIR,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    if (installResult.status !== 0) {
      throw new Error(installResult.stderr || 'npm install failed');
    }

    // Build
    console.log(chalk.dim('Building...'));
    const buildResult = spawnSync('npm', ['run', 'build'], {
      cwd: INSTALL_DIR,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    if (buildResult.status !== 0) {
      throw new Error(buildResult.stderr || 'Build failed');
    }

    const newVersion = getCurrentVersion();

    console.log(chalk.green(`\n✓ Updated successfully!`));
    console.log(chalk.dim(`  ${previousVersion} → ${newVersion}`));

    return {
      success: true,
      previousVersion,
      newVersion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.log(chalk.red(`\n✗ Update failed: ${message}`));
    return {
      success: false,
      previousVersion,
      newVersion: previousVersion,
      error: message,
    };
  }
}

/**
 * Bump the version in package.json
 */
export function bumpVersion(type: 'major' | 'minor' | 'patch' = 'patch'): string {
  const pkgPath = path.join(INSTALL_DIR, 'package.json');

  if (!existsSync(pkgPath)) {
    throw new Error('package.json not found');
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const [major, minor, patch] = (pkg.version ?? '0.0.0').split('.').map(Number);

  let newVersion: string;
  switch (type) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case 'patch':
    default:
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
  }

  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  return newVersion;
}

/**
 * Print version information
 */
export function printVersion(): void {
  const version = getCurrentVersion();
  const commit = getGitCommit();

  console.log(`orchestrator v${version} (${commit})`);
}

/**
 * Print detailed version info
 */
export async function printVersionDetails(): Promise<void> {
  console.log(chalk.bold('\n📦 Orchestrator Version Info\n'));

  const version = getCurrentVersion();
  const commit = getGitCommit();

  console.log(chalk.dim('Version:    ') + version);
  console.log(chalk.dim('Commit:     ') + commit);
  console.log(chalk.dim('Install:    ') + INSTALL_DIR);

  console.log(chalk.dim('\nChecking for updates...'));

  const versionInfo = await checkForUpdates();

  if (versionInfo.isOutdated) {
    console.log(chalk.yellow(`\n⚠ Updates available (${versionInfo.commitsBehind} commits behind)`));
    console.log(chalk.dim(`  Latest version: ${versionInfo.latest}`));
    console.log(chalk.dim('  Run: orchestrate update'));
  } else {
    console.log(chalk.green('\n✓ Up to date'));
  }

  console.log();
}
