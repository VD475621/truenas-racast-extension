import WebSocket from 'ws';

// Types
export interface TrueNASConfig {
  host: string;
  apiKey: string;
  port?: number;
  secure?: boolean;
}

export interface JSONRPCRequest {
  id: string;
  msg: 'method';
  method: string;
  params?: any[];
}

export interface JSONRPCResponse {
  id: string;
  msg: 'result' | 'error' | 'connected';
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export interface VMState {
  id: number;
  name: string;
  status: {
    state: string;
    pid: number | null;
  };
}

export interface AppState {
  id: string;
  name: string;
  state: string;
  active: boolean;
}

// Main TrueNAS Client Class
export class TrueNASClient {
  private ws: WebSocket | null = null;
  private config: TrueNASConfig;
  private requestCounter = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();
  private authenticated = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private intentionalDisconnect = false;

  constructor(config: TrueNASConfig) {
    this.config = {
      port: config.secure !== false ? 443 : 80,
      secure: true,
      ...config
    };
  }

  // Connect to WebSocket
  async connect(): Promise<void> {
    // Reset intentional disconnect flag when starting a new connection
    this.intentionalDisconnect = false;
    
    return new Promise((resolve, reject) => {
      const protocol = this.config.secure ? 'wss' : 'ws';
      const url = `${protocol}://${this.config.host}:${this.config.port}/websocket`;

      this.ws = new WebSocket(url, {
        rejectUnauthorized: false // For self-signed certificates
      });

      this.ws.on('open', async () => {
        console.log('WebSocket connected');
        
        // Wait a bit to ensure WebSocket is fully ready
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Send initial connection message that TrueNAS expects
            const connectMsg = {
              msg: 'connect',
              version: '1',
              support: ['1']
            };
            this.ws.send(JSON.stringify(connectMsg));
            
            // Wait a moment then try authentication
            setTimeout(async () => {
              try {
                await this.authenticate();
                this.reconnectAttempts = 0;
                resolve();
              } catch (error) {
                reject(error);
              }
            }, 1000);
          } else {
            reject(new Error('WebSocket not ready after open event'));
          }
        }, 100); // Small delay to ensure WebSocket is fully ready
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('WebSocket closed');
        this.authenticated = false;
        this.handleReconnect();
      });
    });
  }

  // Handle reconnection
  private async handleReconnect(): Promise<void> {
    // Don't reconnect if the disconnection was intentional
    if (this.intentionalDisconnect) {
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
      setTimeout(() => {
        this.connect().catch(() => {
          // Silently handle reconnection failures
        });
      }, 2000 * this.reconnectAttempts);
    }
  }

  // Handle incoming messages
  private handleMessage(data: string): void {
    try {
      const response: any = JSON.parse(data);
      
      // Handle different TrueNAS response formats
      if (response.msg === 'connected') {
        return; // Initial connection message
      }

      if (response.msg === 'failed') {
        // Try alternative authentication method
        this.tryAlternativeAuth().catch(console.error);
        return;
      }

      if (response.msg === 'pong') {
        return; // Pong response
      }

      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        if (response.msg === 'result') {
          pending.resolve(response.result);
        } else if (response.msg === 'error') {
          pending.reject(new Error(response.error?.message || 'Unknown error'));
        }
        this.pendingRequests.delete(response.id);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  // Send JSON-RPC request
  private async call<T>(method: string, params?: any[]): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const id = `${Date.now()}-${this.requestCounter++}`;
    const request: JSONRPCRequest = {
      id,
      msg: 'method',
      method,
      params: params || []
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      this.ws!.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  // Authenticate with API key
  private async authenticate(): Promise<void> {
    // Try DDP-style authentication message
    const authMessage = {
      msg: 'method',
      method: 'auth.login_with_api_key',
      params: [this.config.apiKey],
      id: `${Date.now()}-auth`
    };
    
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not connected'));
        return;
      }

      // Set up a one-time listener for auth response
      const originalHandler = this.handleMessage.bind(this);
      const authHandler = (data: string) => {
        try {
          const response = JSON.parse(data);
          
          if (response.id === authMessage.id) {
            if (response.msg === 'result' && response.result === true) {
              this.authenticated = true;
              console.log('Authentication successful');
              resolve();
            } else {
              reject(new Error('Authentication failed: ' + (response.error?.message || 'Invalid credentials')));
            }
          } else {
            // Handle other messages normally
            originalHandler(data);
          }
        } catch (error) {
          originalHandler(data);
        }
      };

      // Send the auth message with state check
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(authMessage));
      } else {
        reject(new Error('WebSocket not ready for authentication'));
        return;
      }

      // Set timeout for auth response
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 10000);

      // Wait for auth response
      const messageListener = (data: Buffer) => {
        authHandler(data.toString());
        clearTimeout(timeout);
        this.ws?.off('message', messageListener);
      };

      this.ws.on('message', messageListener);
    });
  }

  // Try alternative authentication method
  private async tryAlternativeAuth(): Promise<void> {
    // Try sending auth message in different format
    const authMessage = {
      id: `${Date.now()}-auth`,
      msg: 'auth',
      data: {
        api_key: this.config.apiKey
      }
    };
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(authMessage));
      
      // Wait a bit and try to set authenticated
      setTimeout(() => {
        this.authenticated = true;
      }, 1000);
    }
  }

  // VM Methods
  async getVMs(): Promise<VMState[]> {
    return this.call<VMState[]>('vm.query');
  }

  async getVMState(vmId: number): Promise<VMState> {
    const vms = await this.call<VMState[]>('vm.query', [[['id', '=', vmId]]]);
    if (vms.length === 0) {
      throw new Error(`VM with id ${vmId} not found`);
    }
    const vm = vms[0];
    if (!vm) {
      throw new Error(`VM with id ${vmId} not found`);
    }
    return vm;
  }

  async startVM(vmId: number): Promise<void> {
    await this.call<void>('vm.start', [vmId]);
    console.log(`VM ${vmId} started`);
  }

  async stopVM(vmId: number, options?: { force?: boolean }): Promise<void> {
    const force = options?.force || false;
    await this.call<void>('vm.stop', [vmId, { force }]);
    console.log(`VM ${vmId} stopped`);
  }

  async restartVM(vmId: number): Promise<void> {
    await this.stopVM(vmId, { force: true });
    // Wait for the VM to stop
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    await this.startVM(vmId);
    console.log(`VM ${vmId} restarted`);
  }

  // App Methods
  async getApps(): Promise<AppState[]> {
    return this.call<AppState[]>('app.query');
  }

  async getAppState(appName: string): Promise<AppState> {
    const apps = await this.call<AppState[]>('app.query', [[['name', '=', appName]]]);
    if (apps.length === 0) {
      throw new Error(`App ${appName} not found`);
    }
    const app = apps[0];
    if (!app) {
      throw new Error(`App ${appName} not found`);
    }
    return app;
  }

  async startApp(appName: string): Promise<void> {
    await this.call<void>('app.start', [appName]);
    console.log(`App ${appName} started`);
  }

  async stopApp(appName: string): Promise<void> {
    await this.call<void>('app.stop', [appName]);
    console.log(`App ${appName} stopped`);
  }

  async restartApp(appName: string): Promise<void> {
    await this.stopApp(appName);
    await this.startApp(appName);
    console.log(`App ${appName} restarted`);
  }

  // Disconnect
  disconnect(): void {
    if (this.ws) {
      this.intentionalDisconnect = true;
      this.ws.close();
      this.ws = null;
      this.authenticated = false;
      console.log('Disconnected from TrueNAS');
    }
  }

  // Check connection status
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.authenticated;
  }
}

// Example usage
export async function example() {
  const client = new TrueNASClient({
    host: 'truenas.local',
    apiKey: 'your-api-key-here',
    secure: true
  });

  try {
    // Connect to TrueNAS
    await client.connect();

    // Get all VMs
    const vms = await client.getVMs();
    console.log('VMs:', vms);

    // Start a VM
    await client.startVM(1);

    // Get all apps
    const apps = await client.getApps();
    console.log('Apps:', apps);

    // Restart an app
    await client.restartApp('plex');

    // Stop an app
    await client.stopApp('plex');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.disconnect();
  }
}

export default TrueNASClient;