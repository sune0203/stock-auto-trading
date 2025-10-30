import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config';
import { DetectionResult, PriceTrackHistory, WSMessage } from './types';

// WebSocket 서버 클래스
export class SurgeWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  // 서버 시작
  start() {
    const port = config.server.wsPort;

    this.wss = new WebSocketServer({ port });

    this.wss.on('listening', () => {
      console.log(`🔌 WebSocket 서버 시작: ws://localhost:${port}`);
    });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('✅ 클라이언트 연결됨');
      this.clients.add(ws);

      // 연결 확인 메시지
      this.sendToClient(ws, {
        type: 'connected',
        data: { message: '급등주 감지 시스템에 연결되었습니다.' },
        timestamp: new Date(),
      });

      // 클라이언트로부터 메시지 수신
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          console.log('📥 클라이언트 메시지:', data);
          
          // 메시지 타입별 처리
          this.handleClientMessage(ws, data);
        } catch (error) {
          console.error('❌ 메시지 파싱 실패:', error);
        }
      });

      // 클라이언트 연결 종료
      ws.on('close', () => {
        console.log('❌ 클라이언트 연결 종료');
        this.clients.delete(ws);
      });

      // 에러 처리
      ws.on('error', (error) => {
        console.error('❌ WebSocket 에러:', error);
        this.clients.delete(ws);
      });
    });

    this.wss.on('error', (error) => {
      console.error('❌ WebSocket 서버 에러:', error);
    });
  }

  // 클라이언트 메시지 처리
  private handleClientMessage(ws: WebSocket, message: any) {
    // 클라이언트에서 보낸 명령 처리 (향후 확장 가능)
    if (message.type === 'ping') {
      this.sendToClient(ws, {
        type: 'pong',
        data: { timestamp: Date.now() },
        timestamp: new Date(),
      });
    }
  }

  // 특정 클라이언트에게 메시지 전송
  private sendToClient(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // 모든 클라이언트에게 브로드캐스트
  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  // 급등 감지 알림
  notifyDetection(detection: DetectionResult) {
    console.log(`📢 감지 알림 전송: ${detection.symbol}`);
    
    this.broadcast({
      type: 'detection',
      data: detection,
      timestamp: new Date(),
    });
  }

  // 가격 업데이트 알림
  notifyPriceUpdate(update: PriceTrackHistory) {
    this.broadcast({
      type: 'price_update',
      data: update,
      timestamp: new Date(),
    });
  }

  // 스캔 완료 알림
  notifyScanComplete(results: {
    detectionCount: number;
    totalScanned: number;
    scanTime: Date;
  }) {
    console.log(`📢 스캔 완료 알림 전송: ${results.detectionCount}개 발견`);
    
    this.broadcast({
      type: 'scan_complete',
      data: results,
      timestamp: new Date(),
    });
  }

  // 에러 알림
  notifyError(error: { message: string; details?: any }) {
    this.broadcast({
      type: 'error',
      data: error,
      timestamp: new Date(),
    });
  }

  // 서버 중지
  stop() {
    if (this.wss) {
      console.log('🔌 WebSocket 서버 종료 중...');
      
      // 모든 클라이언트 연결 종료
      this.clients.forEach((client) => {
        client.close();
      });
      
      this.clients.clear();
      this.wss.close();
      this.wss = null;
      
      console.log('✅ WebSocket 서버 종료 완료');
    }
  }

  // 연결된 클라이언트 수
  getClientCount(): number {
    return this.clients.size;
  }
}

// 싱글톤 인스턴스
export const wsServer = new SurgeWebSocketServer();

