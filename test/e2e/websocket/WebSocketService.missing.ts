import webSocket from '@ohos.net.webSocket';
import { BusinessError } from '@ohos.base';
import { WebSocketMessage, MessageCallback } from '../types/index';

export class WebSocketService {
  private ws: webSocket.WebSocket | null = null;
  private reconnectTimer: number = -1;
  private url: string = 'ws://110.42.61.24:3001/ws';
  private heartbeatTimer: number = -1;
  private isManualClose: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private messageCallbacks: Map<string, MessageCallback[]> = new Map();
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

  constructor() {
    console.log('[WebSocketService] 初始化完成');
  }
  
  // ... 其他方法保持不变 ...

  // [DELETED] on 方法被删除，用于测试智能补全

  // ... 其他方法保持不变 ...
}

export const webSocketService = new WebSocketService();
