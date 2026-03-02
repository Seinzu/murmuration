type ToggleCallback = (row: number, col: number) => void;

export class SocketClient {
  private socket: WebSocket | null = null;
  private url: string;
  private heartbeatIntervalId: number | null = null;
  private reconnectTimeoutId: number | null = null;
  private onToggleCallback: ToggleCallback | null = null;

  public isConnected: boolean = false;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    console.log(`[SocketClient] Attempting to connect to ${this.url}...`);
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log('[SocketClient] Connected to server.');
      this.isConnected = true;
      this.startHeartbeat();
      if (this.reconnectTimeoutId !== null) {
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = null;
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'toggle') {
          console.log(`[SocketClient] Received server command: toggle (${data.row}, ${data.col})`);
          if (this.onToggleCallback) {
            this.onToggleCallback(data.row, data.col);
          }
        }
      } catch (e) {
        console.error('[SocketClient] Failed to parse message', event.data);
      }
    };

    this.socket.onclose = () => {
      console.log('[SocketClient] Disconnected. Attempting to reconnect in 5s...');
      this.isConnected = false;
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.socket.onerror = (error) => {
      console.error('[SocketClient] WebSocket error observed:', error);
      // Let onclose handle the reconnection logic
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimeoutId === null) {
      this.reconnectTimeoutId = window.setTimeout(() => {
        this.reconnectTimeoutId = null;
        this.connect();
      }, 5000);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatIntervalId = window.setInterval(() => {
      if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: Date.now()
        }));
      }
    }, 5000); // 5 seconds as requested
  }

  private stopHeartbeat() {
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  public onToggleCommand(callback: ToggleCallback) {
    this.onToggleCallback = callback;
  }

  public sendGridState(cells: boolean[][]) {
    if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'grid_state',
        data: cells
      }));
    }
  }
}
