type ToggleCallback = (row: number, col: number) => void;

export interface ArcParam {
  name: string;
  min: number;
  max: number;
  default: number;
  oscPath: string;
}

export interface ArcMappingsData {
  availableParams: ArcParam[];
  encoderMap: number[];
  encoders: ArcParam[];
}

type ArcMappingsCallback = (data: ArcMappingsData) => void;

export class SocketClient {
  private socket: WebSocket | null = null;
  private url: string;
  private heartbeatIntervalId: number | null = null;
  private reconnectTimeoutId: number | null = null;
  private onToggleCallback: ToggleCallback | null = null;
  private onArcMappingsCallback: ArcMappingsCallback | null = null;

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
        } else if (data.type === 'arc_mappings') {
          if (this.onArcMappingsCallback) {
            this.onArcMappingsCallback(data);
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
    }, 5000);
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

  public sendAudioEvent(event: Record<string, unknown>) {
    if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'audio_event', ...event }));
    }
  }

  public onArcMappingsUpdate(callback: ArcMappingsCallback) {
    this.onArcMappingsCallback = callback;
  }

  public requestArcMappings() {
    if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'get_arc_mappings' }));
    }
  }

  public sendArcMapping(encoder: number, paramIndex: number) {
    if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'set_arc_mapping', encoder, paramIndex }));
    }
  }

  public sendAddArcParam(param: ArcParam) {
    if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'add_arc_param', param }));
    }
  }
}
