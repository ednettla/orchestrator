/**
 * Project Registry
 *
 * Global registry of all orchestrator projects.
 * Stored as JSON at ~/.orchestrator/projects.json
 *
 * @module project-registry
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nanoid } from 'nanoid';

// ============================================================================
// Types
// ============================================================================

export type ProjectStatus = 'active' | 'archived';

export interface TechStackInfo {
  frontend?: string | undefined;
  backend?: string | undefined;
  database?: string | undefined;
}

export interface CloudServicesInfo {
  github?: string | undefined;
  supabase?: string | undefined;
  vercel?: string | undefined;
}

export interface RegisteredProject {
  id: string;
  path: string;
  name: string;
  alias: string | null;
  techStack: TechStackInfo | null;
  cloudServices: CloudServicesInfo | null;
  status: ProjectStatus;
  lastAccessedAt: Date;
  createdAt: Date;
}

interface ProjectRegistryData {
  version: number;
  projects: Record<string, StoredProject>;
  updatedAt: string;
}

interface StoredProject {
  id: string;
  path: string;
  name: string;
  alias: string | null;
  techStack: TechStackInfo | null;
  cloudServices: CloudServicesInfo | null;
  status: ProjectStatus;
  lastAccessedAt: string;
  createdAt: string;
}

export interface ListProjectsOptions {
  status?: ProjectStatus | 'all';
  sortBy?: 'name' | 'lastAccessed' | 'created';
  limit?: number;
}

// ============================================================================
// Project Registry Manager
// ============================================================================

export class ProjectRegistryManager {
  private registryPath: string;
  private cache: ProjectRegistryData | null = null;

  constructor() {
    const globalDir = path.join(os.homedir(), '.orchestrator');
    this.registryPath = path.join(globalDir, 'projects.json');
  }

  /**
   * Load registry from disk
   */
  private load(): ProjectRegistryData {
    if (this.cache) return this.cache;

    if (!existsSync(this.registryPath)) {
      this.cache = {
        version: 1,
        projects: {},
        updatedAt: new Date().toISOString(),
      };
      return this.cache;
    }

    try {
      const content = readFileSync(this.registryPath, 'utf-8');
      this.cache = JSON.parse(content) as ProjectRegistryData;
      return this.cache;
    } catch {
      // Corrupted file, start fresh
      this.cache = {
        version: 1,
        projects: {},
        updatedAt: new Date().toISOString(),
      };
      return this.cache;
    }
  }

  /**
   * Save registry to disk
   */
  private save(): void {
    if (!this.cache) return;

    const dir = path.dirname(this.registryPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.cache.updatedAt = new Date().toISOString();
    writeFileSync(this.registryPath, JSON.stringify(this.cache, null, 2));
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Convert stored project to RegisteredProject
   */
  private toProject(stored: StoredProject): RegisteredProject {
    return {
      id: stored.id,
      path: stored.path,
      name: stored.name,
      alias: stored.alias,
      techStack: stored.techStack,
      cloudServices: stored.cloudServices,
      status: stored.status,
      lastAccessedAt: new Date(stored.lastAccessedAt),
      createdAt: new Date(stored.createdAt),
    };
  }

  /**
   * Register a new project
   */
  registerProject(params: {
    path: string;
    name: string;
    alias?: string;
    techStack?: TechStackInfo;
    cloudServices?: CloudServicesInfo;
  }): RegisteredProject {
    const data = this.load();
    const normalizedPath = path.resolve(params.path);

    // Check if already exists
    const existing = data.projects[normalizedPath];
    if (existing) {
      // Update existing
      existing.name = params.name;
      existing.alias = params.alias ?? existing.alias;
      existing.techStack = params.techStack ?? existing.techStack;
      existing.cloudServices = params.cloudServices ?? existing.cloudServices;
      existing.lastAccessedAt = new Date().toISOString();
      existing.status = 'active';
      this.save();
      return this.toProject(existing);
    }

    // Create new
    const now = new Date().toISOString();
    const project: StoredProject = {
      id: nanoid(),
      path: normalizedPath,
      name: params.name,
      alias: params.alias ?? null,
      techStack: params.techStack ?? null,
      cloudServices: params.cloudServices ?? null,
      status: 'active',
      lastAccessedAt: now,
      createdAt: now,
    };

    data.projects[normalizedPath] = project;
    this.save();
    return this.toProject(project);
  }

  /**
   * Get project by path, name, or alias
   */
  getProject(pathOrNameOrAlias: string): RegisteredProject | null {
    const data = this.load();

    // Try by path first (exact match)
    const normalizedPath = path.resolve(pathOrNameOrAlias);
    if (data.projects[normalizedPath]) {
      return this.toProject(data.projects[normalizedPath]);
    }

    // Try by name or alias
    for (const stored of Object.values(data.projects)) {
      if (
        stored.name.toLowerCase() === pathOrNameOrAlias.toLowerCase() ||
        stored.alias?.toLowerCase() === pathOrNameOrAlias.toLowerCase()
      ) {
        return this.toProject(stored);
      }
    }

    return null;
  }

  /**
   * Get project by ID
   */
  getProjectById(id: string): RegisteredProject | null {
    const data = this.load();

    for (const stored of Object.values(data.projects)) {
      if (stored.id === id) {
        return this.toProject(stored);
      }
    }

    return null;
  }

  /**
   * List all projects
   */
  listProjects(options?: ListProjectsOptions): RegisteredProject[] {
    const data = this.load();
    let projects = Object.values(data.projects).map(p => this.toProject(p));

    // Filter by status
    const status = options?.status ?? 'active';
    if (status !== 'all') {
      projects = projects.filter(p => p.status === status);
    }

    // Sort
    const sortBy = options?.sortBy ?? 'lastAccessed';
    projects.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return b.createdAt.getTime() - a.createdAt.getTime();
        case 'lastAccessed':
        default:
          return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
      }
    });

    // Limit
    if (options?.limit) {
      projects = projects.slice(0, options.limit);
    }

    return projects;
  }

  /**
   * Update last accessed timestamp
   */
  touchProject(projectPath: string): void {
    const data = this.load();
    const normalizedPath = path.resolve(projectPath);

    if (data.projects[normalizedPath]) {
      data.projects[normalizedPath].lastAccessedAt = new Date().toISOString();
      this.save();
    }
  }

  /**
   * Update project details
   */
  updateProject(
    projectPath: string,
    updates: {
      name?: string;
      alias?: string | null;
      techStack?: TechStackInfo | null;
      cloudServices?: CloudServicesInfo | null;
    }
  ): RegisteredProject | null {
    const data = this.load();
    const normalizedPath = path.resolve(projectPath);
    const stored = data.projects[normalizedPath];

    if (!stored) return null;

    if (updates.name !== undefined) stored.name = updates.name;
    if (updates.alias !== undefined) stored.alias = updates.alias;
    if (updates.techStack !== undefined) stored.techStack = updates.techStack;
    if (updates.cloudServices !== undefined) stored.cloudServices = updates.cloudServices;

    this.save();
    return this.toProject(stored);
  }

  /**
   * Set project alias
   */
  setAlias(projectPath: string, alias: string | null): boolean {
    const data = this.load();
    const normalizedPath = path.resolve(projectPath);

    if (!data.projects[normalizedPath]) return false;

    // Check for alias conflicts
    if (alias) {
      for (const [p, stored] of Object.entries(data.projects)) {
        if (p !== normalizedPath && stored.alias?.toLowerCase() === alias.toLowerCase()) {
          return false; // Alias already in use
        }
      }
    }

    data.projects[normalizedPath].alias = alias;
    this.save();
    return true;
  }

  /**
   * Archive a project
   */
  archiveProject(projectPath: string): boolean {
    const data = this.load();
    const normalizedPath = path.resolve(projectPath);

    if (!data.projects[normalizedPath]) return false;

    data.projects[normalizedPath].status = 'archived';
    this.save();
    return true;
  }

  /**
   * Unarchive a project
   */
  unarchiveProject(projectPath: string): boolean {
    const data = this.load();
    const normalizedPath = path.resolve(projectPath);

    if (!data.projects[normalizedPath]) return false;

    data.projects[normalizedPath].status = 'active';
    this.save();
    return true;
  }

  /**
   * Remove project from registry
   */
  unregisterProject(projectPath: string): boolean {
    const data = this.load();
    const normalizedPath = path.resolve(projectPath);

    if (!data.projects[normalizedPath]) return false;

    delete data.projects[normalizedPath];
    this.save();
    return true;
  }

  /**
   * Remove projects that no longer exist on disk
   */
  cleanupStaleProjects(): string[] {
    const data = this.load();
    const removed: string[] = [];

    for (const projectPath of Object.keys(data.projects)) {
      const orchestratorDir = path.join(projectPath, '.orchestrator');
      if (!existsSync(orchestratorDir)) {
        removed.push(projectPath);
        delete data.projects[projectPath];
      }
    }

    if (removed.length > 0) {
      this.save();
    }

    return removed;
  }

  /**
   * Search projects by name or alias
   */
  searchProjects(query: string): RegisteredProject[] {
    const data = this.load();
    const lowerQuery = query.toLowerCase();

    return Object.values(data.projects)
      .filter(
        stored =>
          stored.status === 'active' &&
          (stored.name.toLowerCase().includes(lowerQuery) ||
            stored.alias?.toLowerCase().includes(lowerQuery) ||
            stored.path.toLowerCase().includes(lowerQuery))
      )
      .map(p => this.toProject(p));
  }

  /**
   * Get project count
   */
  getProjectCount(status?: ProjectStatus | 'all'): number {
    const data = this.load();
    const projects = Object.values(data.projects);

    if (!status || status === 'all') {
      return projects.length;
    }

    return projects.filter(p => p.status === status).length;
  }

  /**
   * Update cloud services for a project
   */
  updateCloudServices(projectPath: string, services: CloudServicesInfo): boolean {
    const data = this.load();
    const normalizedPath = path.resolve(projectPath);
    const stored = data.projects[normalizedPath];

    if (!stored) return false;

    stored.cloudServices = {
      ...stored.cloudServices,
      ...services,
    };

    this.save();
    return true;
  }
}

// ============================================================================
// Singleton & Exports
// ============================================================================

let registryInstance: ProjectRegistryManager | null = null;

export function getProjectRegistry(): ProjectRegistryManager {
  if (!registryInstance) {
    registryInstance = new ProjectRegistryManager();
  }
  return registryInstance;
}

export { ProjectRegistryManager as ProjectRegistry };
