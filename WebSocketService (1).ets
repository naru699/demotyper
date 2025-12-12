import webSocket from '@ohos.net.webSocket';
import { BusinessError } from '@ohos.base';
import { WebSocketMessage, MessageCallback } from '../types/index';

export class WebSocketService {
  private ws: webSocket.WebSocket | null = null;
  private reconnectTimer: number = -1;
  private url: string = 'ws://110.42.61.24:3001/ws';
  private heartbeatTimer: number = -1;
  private isManualClose: boolean = false;
  private reconnectAttempts: number = 0;z
  private maxReconnectAttempts: number = 5;
  private messageCallbacks: Map<string, MessageCallback[]> = new Map();
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

  constructor() {
    console.log('[WebSocketService] 初始化完成');
  }
  

  connect(): void {
    if (this.ws && this.connectionState !== 'disconnected') {
      console.log('[WebSocketService] 已有连接，跳过重复连接');
      return;
    }

    console.log('[WebSocketService] 开始连接到服务器:', this.url);
    this.connectionState = 'connecting';

    try {
      this.ws = webSocket.createWebSocket();
      this.isManualClose = false;

      this.ws.on('open', (err: BusinessError, value: Object) => {
        if (err) {
          console.error('[WebSocketService] 连接打开失败:', JSON.stringify(err));
          this.connectionState = 'disconnected';
          this.handleReconnect();
          return;
        }
        console.log('[WebSocketService] WebSocket连接成功');
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      });

      this.ws.on('message', (err: BusinessError, value: string | ArrayBuffer) => {
        if (err) {
          console.error('[WebSocketService] 接收消息错误:', JSON.stringify(err));
          return;
        }
        try {
          const message = typeof value === 'string' ? value : this.arrayBufferToString(value);
          console.log('[WebSocketService] 收到原始消息:', message);
          const data = JSON.parse(message) as WebSocketMessage;
          console.log('[WebSocketService] 解析后消息类型:', data.type);
          this.handleMessage(data);
        } catch (error) {
          console.error('[WebSocketService] 消息解析失败:', JSON.stringify(error));
        }
      });

      this.ws.on('close', (err: BusinessError, value: webSocket.CloseResult) => {
        console.log('[WebSocketService] WebSocket连接关闭, code:', value?.code, 'reason:', value?.reason);
        this.connectionState = 'disconnected';
        this.stopHeartbeat();
        this.ws = null;

        if (!this.isManualClose) {
          console.log('[WebSocketService] 非手动关闭，准备重连...');
          this.handleReconnect();
        }
      });

      this.ws.on('error', (err: BusinessError) => {
        console.error('[WebSocketService] WebSocket错误:', JSON.stringify(err));
        this.connectionState = 'disconnected';
      });

      this.ws.connect(this.url, (err: BusinessError) => {
        if (err) {
          console.error('[WebSocketService] 连接请求失败:', JSON.stringify(err));
          this.connectionState = 'disconnected';
          this.handleReconnect();
        } else {
          console.log('[WebSocketService] 连接请求已发送，等待服务器响应...');
        }
      });

    } catch (error) {
      console.error('[WebSocketService] 连接异常:', JSON.stringify(error));
      this.connectionState = 'disconnected';
      this.handleReconnect();
    }
  }

  disconnect(): void {
    console.log('[WebSocketService] 手动断开连接');
    this.isManualClose = true;
    this.connectionState = 'disconnected';
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.close((err: BusinessError) => {
          if (err) {
            console.error('[WebSocketService] 关闭连接失败:', JSON.stringify(err));
          } else {
            console.log('[WebSocketService] 连接已关闭');
          }
        });
      } catch (error) {
        console.error('[WebSocketService] 关闭连接异常:', JSON.stringify(error));
      }
      this.ws = null;
    }
  }

  send(data: WebSocketMessage): void {
    if (!this.ws) {
      return;
    }

    try {
      const message = JSON.stringify(data);
      this.ws.send(message, (err: BusinessError) => {
        if (err) {
        }
      });
    } catch (error) {
    }
  }

  on(type: string, callback: MessageCallback): void {
    if (!this.messageCallbacks.has(type)) {
      this.messageCallbacks.set(type, []);
    }
    this.messageCallbacks.get(type)?.push(callback);
    console.log(`[WebSocketService] 订阅消息类型: ${type}, 当前订阅数: ${this.messageCallbacks.get(type)?.length}`);
  }

  off(type: string, callback?: MessageCallback): void {
    if (!callback) {
      this.messageCallbacks.delete(type);
    }

    const callbacks = this.messageCallbacks.get(type);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private handleMessage(data: WebSocketMessage): void {
    const type = data.type;
    const callbacks = this.messageCallbacks.get(type);

    console.log(`[WebSocketService] 处理消息类型: ${type}, 回调数量: ${callbacks?.length || 0}`);

    if (callbacks && callbacks.length > 0) {
      callbacks.forEach((callback, index) => {
        try {
          console.log(`[WebSocketService] 执行回调 ${index + 1}/${callbacks.length} for type: ${type}`);
          callback(data);
        } catch (error) {
          console.error('[WebSocketService] 回调执行失败:', JSON.stringify(error));
        }
      });
    } else {
      console.warn(`[WebSocketService] 没有找到类型"${type}"的订阅回调`);
    }

    if (type === 'pong') {
      console.log('[WebSocketService] 收到心跳响应');
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    console.log('[WebSocketService] 启动心跳，间隔30秒');
    this.heartbeatTimer = setInterval(() => {
      const pingMessage: WebSocketMessage = { type: 'ping' };
      console.log('[WebSocketService] 发送心跳ping');
      this.send(pingMessage);
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== -1) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = -1;
    }
  }

  private handleReconnect(): void {
    if (this.isManualClose) {
      console.log('[WebSocketService] 手动关闭，不进行重连');
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[WebSocketService] 已达到最大重连次数 ${this.maxReconnectAttempts}，停止重连`);
      return;
    }
    this.clearReconnectTimer();
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WebSocketService] 🔄 准备第 ${this.reconnectAttempts} 次重连，延迟 ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.ws = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== -1) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = -1;
    }
  }

  private arrayBufferToString(buffer: ArrayBuffer): string {
    const uint8Array = new Uint8Array(buffer);
    let result = '';
    for (let i = 0; i < uint8Array.length; i++) {
      result += String.fromCharCode(uint8Array[i]);
    }
    return result;
  }

  isConnected(): boolean {
    const connected = this.ws !== null && this.connectionState === 'connected';
    console.log(`[WebSocketService] 连接状态检查: ${connected} (ws: ${this.ws !== null}, state: ${this.connectionState})`);
    return connected;
  }

  getConnectionState(): string {
    return this.connectionState;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}

export const webSocketService = new WebSocketService();
