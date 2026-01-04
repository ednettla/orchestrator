import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Session, TechStack, PipelinePhase, SessionStatus, DesignSystemInfo } from './types.js';
import { DEFAULT_TECH_STACK } from './types.js';
import { SQLiteStore, type StateStore } from '../state/store.js';

// ============================================================================
// Session Manager
// ============================================================================

export class SessionManager {
  private store: StateStore | null = null;
  private currentSession: Session | null = null;

  async initialize(projectPath: string): Promise<void> {
    const orchestratorDir = path.join(projectPath, '.orchestrator');

    // Create directory structure if it doesn't exist
    if (!existsSync(orchestratorDir)) {
      await mkdir(orchestratorDir, { recursive: true });
      await mkdir(path.join(orchestratorDir, 'sessions'), { recursive: true });
      await mkdir(path.join(orchestratorDir, 'artifacts'), { recursive: true });
      await mkdir(path.join(orchestratorDir, 'artifacts', 'specs'), { recursive: true });
      await mkdir(path.join(orchestratorDir, 'artifacts', 'architecture'), { recursive: true });
      await mkdir(path.join(orchestratorDir, 'artifacts', 'reviews'), { recursive: true });
      await mkdir(path.join(orchestratorDir, 'logs'), { recursive: true });
    }

    const dbPath = path.join(orchestratorDir, 'orchestrator.db');
    this.store = new SQLiteStore(dbPath);
  }

  getStore(): StateStore {
    if (!this.store) {
      throw new Error('SessionManager not initialized. Call initialize() first.');
    }
    return this.store;
  }

  async createSession(params: {
    projectPath: string;
    projectName: string;
    techStack?: TechStack;
  }): Promise<Session> {
    const store = this.getStore();

    // Check if session already exists for this path
    const existing = store.getSessionByPath(params.projectPath);
    if (existing) {
      throw new Error(`Session already exists for ${params.projectPath}. Use resume command instead.`);
    }

    const session = store.createSession({
      projectPath: params.projectPath,
      projectName: params.projectName,
      techStack: params.techStack ?? DEFAULT_TECH_STACK,
    });

    this.currentSession = session;
    return session;
  }

  async resumeSession(projectPath: string): Promise<Session> {
    const store = this.getStore();

    const session = store.getSessionByPath(projectPath);
    if (!session) {
      throw new Error(`No session found for ${projectPath}. Use init command to create one.`);
    }

    if (session.status === 'completed') {
      throw new Error('Session is already completed. Create a new session for additional work.');
    }

    // Update status to active if it was paused
    if (session.status === 'paused') {
      this.currentSession = store.updateSession(session.id, { status: 'active' });
    } else {
      this.currentSession = session;
    }

    return this.currentSession;
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  async updatePhase(phase: PipelinePhase): Promise<Session> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const store = this.getStore();
    this.currentSession = store.updateSession(this.currentSession.id, { currentPhase: phase });
    return this.currentSession;
  }

  async updateStatus(status: SessionStatus): Promise<Session> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const store = this.getStore();
    this.currentSession = store.updateSession(this.currentSession.id, { status });
    return this.currentSession;
  }

  async pauseSession(): Promise<Session> {
    return this.updateStatus('paused');
  }

  async completeSession(): Promise<Session> {
    const session = await this.updateStatus('completed');
    await this.updatePhase('completed');
    return session;
  }

  async failSession(): Promise<Session> {
    const session = await this.updateStatus('failed');
    await this.updatePhase('failed');
    return session;
  }

  /**
   * Update the design system information for the current session
   */
  updateDesignSystem(designSystem: DesignSystemInfo): Session {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const store = this.getStore();
    this.currentSession = store.updateSession(this.currentSession.id, { designSystem });
    return this.currentSession;
  }

  /**
   * Get the design system information for the current session
   */
  getDesignSystem(): DesignSystemInfo | undefined {
    if (!this.currentSession) {
      return undefined;
    }
    return this.currentSession.designSystem;
  }

  listSessions(): Session[] {
    return this.getStore().listSessions();
  }

  close(): void {
    if (this.store) {
      this.store.close();
      this.store = null;
    }
    this.currentSession = null;
  }
}

// ============================================================================
// Tech Stack Utilities
// ============================================================================

export interface TechStackChoice {
  name: string;
  value: string;
  description: string;
}

export const TECH_STACK_CHOICES: Record<keyof TechStack, TechStackChoice[]> = {
  frontend: [
    { name: 'Next.js', value: 'nextjs', description: 'React framework with SSR, routing, and API routes' },
    { name: 'React', value: 'react', description: 'React SPA with Vite' },
    { name: 'Vue', value: 'vue', description: 'Vue 3 with Vite' },
    { name: 'Svelte', value: 'svelte', description: 'SvelteKit' },
  ],
  backend: [
    { name: 'Express', value: 'express', description: 'Minimal Node.js framework' },
    { name: 'Fastify', value: 'fastify', description: 'Fast Node.js framework' },
    { name: 'NestJS', value: 'nestjs', description: 'Enterprise Node.js framework' },
    { name: 'Hono', value: 'hono', description: 'Lightweight edge-ready framework' },
  ],
  database: [
    { name: 'Supabase', value: 'supabase', description: 'PostgreSQL with built-in auth, realtime, and storage (Recommended)' },
    { name: 'PostgreSQL', value: 'postgresql', description: 'Relational database with Prisma ORM' },
    { name: 'SQLite', value: 'sqlite', description: 'File-based database with Prisma ORM' },
    { name: 'MongoDB', value: 'mongodb', description: 'Document database with Mongoose' },
  ],
  testing: [
    { name: 'Chrome MCP', value: 'chrome-mcp', description: 'Browser testing via Claude Chrome extension' },
    { name: 'Cypress', value: 'cypress', description: 'E2E and component testing for CI' },
  ],
  unitTesting: [
    { name: 'Vitest', value: 'vitest', description: 'Fast unit testing powered by Vite' },
  ],
  styling: [
    { name: 'Tailwind CSS', value: 'tailwind', description: 'Utility-first CSS framework' },
    { name: 'CSS Modules', value: 'css-modules', description: 'Scoped CSS with modules' },
    { name: 'Styled Components', value: 'styled-components', description: 'CSS-in-JS' },
  ],
};

export function getTechStackDescription(stack: TechStack): string {
  const parts = [
    `Frontend: ${stack.frontend}`,
    `Backend: ${stack.backend}`,
    `Database: ${stack.database}`,
    `E2E: ${stack.testing}`,
    `Unit: ${stack.unitTesting ?? 'vitest'}`,
    `Styling: ${stack.styling}`,
  ];
  return parts.join(' | ');
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const sessionManager = new SessionManager();
