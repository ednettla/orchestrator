/**
 * WebSocket Hook
 *
 * Real-time updates from the Orchestrator backend.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

type WebSocketEventType =
  | 'project:status'
  | 'requirement:update'
  | 'plan:update'
  | 'plan:question'
  | 'daemon:log'
  | 'notification'
  | 'connected'
  | 'pong';

interface WebSocketMessage {
  type: WebSocketEventType;
  data?: unknown;
  projectId?: string;
}

interface UseWebSocketOptions {
  autoConnect?: boolean;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  subscribe: (projectId: string) => void;
  unsubscribe: (projectId: string) => void;
  connect: () => void;
  disconnect: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    autoConnect = true,
    reconnectAttempts = 5,
    reconnectInterval = 3000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const getWebSocketUrl = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}?token=${encodeURIComponent(token)}`;
  }, []);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const url = getWebSocketUrl();
    if (!url) {
      console.log('[WebSocket] No auth token, cannot connect');
      return;
    }

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);
        reconnectCountRef.current = 0;
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        setIsConnected(false);
        wsRef.current = null;

        // Auto reconnect on unexpected disconnect
        if (event.code !== 1000 && event.code !== 1001) {
          if (reconnectCountRef.current < reconnectAttempts) {
            reconnectCountRef.current++;
            console.log(`[WebSocket] Reconnecting (${reconnectCountRef.current}/${reconnectAttempts})...`);
            reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
          }
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
        } catch {
          console.warn('[WebSocket] Invalid message:', event.data);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
    }
  }, [getWebSocketUrl, reconnectAttempts, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnect');
      wsRef.current = null;
    }

    setIsConnected(false);
  }, []);

  const subscribe = useCallback((projectId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'subscribe',
        projectId,
      }));
    }
  }, []);

  const unsubscribe = useCallback((projectId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'unsubscribe',
        projectId,
      }));
    }
  }, []);

  // Auto connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Heartbeat to keep connection alive
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'ping' }));
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isConnected]);

  return {
    isConnected,
    lastMessage,
    subscribe,
    unsubscribe,
    connect,
    disconnect,
  };
}

export default useWebSocket;
