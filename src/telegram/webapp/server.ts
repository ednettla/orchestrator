/**
 * WebApp Express Server
 *
 * Self-hosted Express server bundled with the Telegram daemon.
 * Serves the Mini App static files and provides API endpoints.
 *
 * @module webapp/server
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { getGlobalStore } from '../../core/global-store.js';
import {
  authenticateJWT,
  authenticateFromInitData,
  type AuthenticatedRequest,
  type JWTPayload,
} from './middleware/auth.js';
import { createProjectsRouter } from './routes/projects.js';
import { createRequirementsRouter } from './routes/requirements.js';
import { createPlansRouter } from './routes/plans.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';

// ============================================================================
// Types
// ============================================================================

export interface WebAppServerOptions {
  port: number;
  staticDir?: string;
}

export interface WebSocketClient {
  ws: WebSocket;
  user: JWTPayload;
  subscribedProjects: Set<string>;
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

export type WebSocketEventType =
  | 'project:status'
  | 'requirement:update'
  | 'plan:update'
  | 'plan:question'
  | 'daemon:log'
  | 'notification';

export interface WebSocketMessage {
  type: WebSocketEventType;
  data: unknown;
  projectId?: string;
}

// ============================================================================
// WebApp Server
// ============================================================================

export class WebAppServer {
  private app: Express;
  private server: HttpServer;
  private wss: WebSocketServer;
  private clients: Map<WebSocket, WebSocketClient> = new Map();
  private port: number;
  private staticDir: string;

  constructor(options: WebAppServerOptions) {
    this.port = options.port;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    // Determine static directory
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this.staticDir = options.staticDir ?? path.join(__dirname, '../../../webapp/dist');

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // JSON body parser
    this.app.use(express.json());

    // CORS for Mini App
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Allow Telegram Mini App origin
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }

      next();
    });

    // Request logging in development
    if (process.env.NODE_ENV !== 'production') {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        console.log(`[WebApp] ${req.method} ${req.path}`);
        next();
      });
    }
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Authentication endpoint
    this.app.post('/api/auth/validate', async (req: Request, res: Response) => {
      try {
        const { initData } = req.body as { initData?: string };

        if (!initData) {
          res.status(400).json({
            success: false,
            error: { code: 'MISSING_INIT_DATA', message: 'initData is required' },
          });
          return;
        }

        const result = await authenticateFromInitData(initData);

        if (!result.success) {
          res.status(401).json({
            success: false,
            error: { code: 'AUTH_FAILED', message: result.error },
          });
          return;
        }

        res.json({
          success: true,
          token: result.token,
          user: {
            id: result.user.userId,
            telegramId: result.user.telegramId,
            displayName: result.user.displayName,
            role: result.user.role,
          },
        });
      } catch (error) {
        console.error('[WebApp] Auth error:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Authentication failed' },
        });
      }
    });

    // Protected API routes
    this.app.use('/api/projects', authenticateJWT, createProjectsRouter());
    this.app.use('/api/admin', authenticateJWT, createAdminRouter());
    this.app.use('/api/auth', authenticateJWT, createAuthRouter());

    // Project-scoped routes (nested under projects)
    // These are mounted dynamically in createProjectsRouter

    // Static files for Mini App (serve last)
    if (existsSync(this.staticDir)) {
      this.app.use(express.static(this.staticDir));

      // SPA fallback - serve index.html for client-side routing
      // Using regex to avoid path-to-regexp 8.x issues with bare '*'
      this.app.get(/^(?!\/api\/).*$/, (req: Request, res: Response) => {
        const indexPath = path.join(this.staticDir, 'index.html');
        if (existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send('Mini App not found. Run: npm run build:webapp');
        }
      });
    } else {
      this.app.get('/', (_req: Request, res: Response) => {
        res.send('Orchestrator WebApp - Mini App not built. Run: npm run build:webapp');
      });
    }

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[WebApp] Error:', err);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    });
  }

  /**
   * Setup WebSocket server for real-time updates
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req: { url?: string }) => {
      // Extract token from query string
      const url = new URL(req.url ?? '', `http://localhost:${this.port}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Missing authentication token');
        return;
      }

      // Verify token
      const { verifyToken } = require('./middleware/auth.js');
      const payload = verifyToken(token) as JWTPayload | null;

      if (!payload) {
        ws.close(4002, 'Invalid authentication token');
        return;
      }

      // Register client
      const client: WebSocketClient = {
        ws,
        user: payload,
        subscribedProjects: new Set(),
      };
      this.clients.set(ws, client);

      console.log(`[WebApp] WebSocket connected: ${payload.displayName}`);

      // Handle messages
      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as { action: string; projectId?: string };

          switch (message.action) {
            case 'subscribe':
              if (message.projectId) {
                client.subscribedProjects.add(message.projectId);
                console.log(`[WebApp] ${payload.displayName} subscribed to ${message.projectId}`);
              }
              break;

            case 'unsubscribe':
              if (message.projectId) {
                client.subscribedProjects.delete(message.projectId);
              }
              break;

            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebApp] WebSocket disconnected: ${payload.displayName}`);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        user: { displayName: payload.displayName, role: payload.role },
      }));
    });
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: WebSocketMessage): void {
    const data = JSON.stringify(message);

    for (const [ws, client] of this.clients) {
      // Check if client is subscribed to this project
      if (message.projectId && !client.subscribedProjects.has(message.projectId)) {
        continue;
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Send a message to a specific user
   */
  sendToUser(telegramId: number, message: WebSocketMessage): void {
    const data = JSON.stringify(message);

    for (const [ws, client] of this.clients) {
      if (client.user.telegramId === telegramId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`[WebApp] Server started on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('[WebApp] Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      for (const [ws] of this.clients) {
        ws.close(1001, 'Server shutting down');
      }
      this.clients.clear();

      // Close WebSocket server
      this.wss.close(() => {
        // Close HTTP server
        this.server.close(() => {
          console.log('[WebApp] Server stopped');
          resolve();
        });
      });
    });
  }

  /**
   * Get server port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let serverInstance: WebAppServer | null = null;

export function createWebAppServer(options: WebAppServerOptions): WebAppServer {
  if (serverInstance) {
    return serverInstance;
  }

  serverInstance = new WebAppServer(options);
  return serverInstance;
}

export function getWebAppServer(): WebAppServer | null {
  return serverInstance;
}
