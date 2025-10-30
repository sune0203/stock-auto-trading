import { useEffect, useState } from 'react';
import { wsService, WSEventType } from '../services/websocket';

// WebSocket 커스텀 훅
export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 연결
    wsService.connect();

    // 연결 상태 체크
    const checkConnection = setInterval(() => {
      setIsConnected(wsService.isConnected());
    }, 1000);

    return () => {
      clearInterval(checkConnection);
    };
  }, []);

  return { isConnected };
}

// 특정 이벤트 구독 훅
export function useWSEvent<T = any>(
  event: WSEventType,
  callback: (data: T) => void
) {
  useEffect(() => {
    wsService.on(event, callback);

    return () => {
      wsService.off(event, callback);
    };
  }, [event, callback]);
}

