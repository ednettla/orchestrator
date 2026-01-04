/**
 * API Client
 *
 * HTTP client with JWT authentication for the Orchestrator API.
 */

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface AuthResponse {
  token: string;
  user: {
    id: number;
    role: string;
    displayName: string;
  };
}

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
    this.token = localStorage.getItem('auth_token');
  }

  /**
   * Authenticate with Telegram initData
   */
  async authenticate(initData: string): Promise<AuthResponse> {
    const response = await this.post<AuthResponse>('/auth/validate', { initData });

    if (response.data) {
      this.token = response.data.token;
      localStorage.setItem('auth_token', this.token);
      return response.data;
    }

    throw new Error(response.error?.message ?? 'Authentication failed');
  }

  /**
   * Clear authentication
   */
  logout(): void {
    this.token = null;
    localStorage.removeItem('auth_token');
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.token !== null;
  }

  /**
   * GET request
   */
  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  /**
   * POST request
   */
  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  /**
   * PUT request
   */
  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  /**
   * Generic request method
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error ?? {
            code: 'HTTP_ERROR',
            message: `HTTP ${response.status}`,
          },
        };
      }

      return {
        success: true,
        data: data as T,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }
}

// Singleton instance
export const api = new ApiClient();

// Type exports
export type { ApiResponse, AuthResponse };
