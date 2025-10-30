import { WSMessage, DetectionResult, PriceTrackHistory } from '../types';

// WebSocket 이벤트 타입
export type WSEventType = 
  | 'detection' 
  | 'price_update' 
  | 'scan_complete' 
  | 'error' 
  | 'connected';

// 이벤트 리스너 타입
type EventListener = (data: any) => void;

// WebSocket 서비스 클래스
class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectInterval: number = 5000; // 5초
  private reconnectTimer: NodeJS.Timeout | null = null;
  private listeners: Map<WSEventType, Set<EventListener>> = new Map();
  private isConnecting: boolean = false;

  // 연결
  connect(url: string = 'ws://localhost:3006') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('⚠️ WebSocket이 이미 연결되어 있습니다.');
      return;
    }

    if (this.isConnecting) {
      console.log('⚠️ WebSocket 연결 시도 중...');
      return;
    }

    this.isConnecting = true;

    try {
      console.log(`🔌 WebSocket 연결 중... ${url}`);
      this.ws = new WebSocket(url);

      // 연결 성공
      this.ws.onopen = () => {
        console.log('✅ WebSocket 연결 성공');
        this.isConnecting = false;
        
        // 재연결 타이머 취소
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      // 메시지 수신
      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          console.log('📥 WebSocket 메시지:', message.type);
          
          // 이벤트 리스너 호출
          this.emit(message.type as WSEventType, message.data);
        } catch (error) {
          console.error('❌ 메시지 파싱 실패:', error);
        }
      };

      // 연결 종료
      this.ws.onclose = () => {
        console.log('❌ WebSocket 연결 종료');
        this.isConnecting = false;
        this.ws = null;

        // 자동 재연결
        this.scheduleReconnect(url);
      };

      // 에러 처리
      this.ws.onerror = (error) => {
        console.error('❌ WebSocket 에러:', error);
        this.isConnecting = false;
      };

    } catch (error) {
      console.error('❌ WebSocket 연결 실패:', error);
      this.isConnecting = false;
      this.scheduleReconnect(url);
    }
  }

  // 재연결 스케줄
  private scheduleReconnect(url: string) {
    if (this.reconnectTimer) {
      return;
    }

    console.log(`🔄 ${this.reconnectInterval / 1000}초 후 재연결 시도...`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(url);
    }, this.reconnectInterval);
  }

  // 연결 종료
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnecting = false;
    console.log('🔌 WebSocket 연결 종료');
  }

  // 메시지 전송
  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.error('❌ WebSocket이 연결되어 있지 않습니다.');
    }
  }

  // 이벤트 리스너 등록
  on(event: WSEventType, listener: EventListener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  // 이벤트 리스너 제거
  off(event: WSEventType, listener: EventListener) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }

  // 이벤트 발생
  private emit(event: WSEventType, data: any) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`❌ 이벤트 리스너 실행 실패 (${event}):`, error);
        }
      });
    }
  }

  // 연결 상태 확인
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// 싱글톤 인스턴스
export const wsService = new WebSocketService();

