import { useState, useCallback } from 'react';
import { DetectionResult } from './types';
import { useWebSocket, useWSEvent } from './hooks/useWebSocket';
import { FloatingAlert } from './components/FloatingAlert';
import { DetectionPopup } from './components/DetectionPopup';
import { DetectionList } from './components/DetectionList';
import { PriceChart } from './components/PriceChart';
import { ScannerControl } from './components/ScannerControl';
import './App.css';

function App() {
  // WebSocket 연결
  const { isConnected } = useWebSocket();

  // 상태 관리
  const [selectedDetection, setSelectedDetection] = useState<DetectionResult | null>(null);
  const [popupDetection, setPopupDetection] = useState<DetectionResult | null>(null);
  const [newDetectionCount, setNewDetectionCount] = useState(0);
  const [showList, setShowList] = useState(false);

  // 새 감지 이벤트 처리
  const handleNewDetection = useCallback((detection: DetectionResult) => {
    console.log('🎯 새로운 급등 감지:', detection.symbol);
    
    // 팝업 표시
    setPopupDetection(detection);
    
    // 카운트 증가
    setNewDetectionCount(prev => prev + 1);
  }, []);

  // 가격 업데이트 이벤트 처리
  const handlePriceUpdate = useCallback((update: any) => {
    console.log('📊 가격 업데이트:', update.symbol, update.price);
    
    // 선택된 종목의 업데이트면 차트 갱신
    if (selectedDetection && selectedDetection.symbol === update.symbol) {
      // 차트는 자동으로 갱신됨 (내부에서 API 호출)
    }
  }, [selectedDetection]);

  // 스캔 완료 이벤트 처리
  const handleScanComplete = useCallback((data: any) => {
    console.log('✅ 스캔 완료:', data);
  }, []);

  // WebSocket 이벤트 구독
  useWSEvent('detection', handleNewDetection);
  useWSEvent('price_update', handlePriceUpdate);
  useWSEvent('scan_complete', handleScanComplete);

  // 팝업 닫기
  const handleClosePopup = () => {
    setPopupDetection(null);
  };

  // 플로팅 버튼 클릭
  const handleFloatingClick = () => {
    setShowList(!showList);
    setNewDetectionCount(0);
  };

  // 감지 선택
  const handleSelectDetection = (detection: DetectionResult) => {
    setSelectedDetection(detection);
    setShowList(false);
  };

  return (
    <div className="app">
      {/* 헤더 */}
      <header className="app-header">
        <div className="header-content">
          <h1>🚀 나스닥 급등주 감지 시스템</h1>
          <div className="connection-status">
            <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
            <span className="status-text">
              {isConnected ? 'WebSocket 연결됨' : 'WebSocket 연결 중...'}
            </span>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="app-main">
        <div className="main-layout">
          {/* 왼쪽 사이드바 */}
          <aside className="sidebar">
            <ScannerControl />
          </aside>

          {/* 가운데 차트 영역 */}
          <section className="content">
            <PriceChart 
              detection={selectedDetection} 
              onSelectDetection={handleSelectDetection}
            />
          </section>

          {/* 오른쪽 감지 목록 (토글) */}
          {showList && (
            <aside className="detection-sidebar">
              <DetectionList onSelectDetection={handleSelectDetection} />
            </aside>
          )}
        </div>
      </main>

      {/* 플로팅 알림 버튼 */}
      <FloatingAlert
        hasNewDetection={newDetectionCount > 0}
        count={newDetectionCount}
        onClick={handleFloatingClick}
      />

      {/* 감지 팝업 */}
      <DetectionPopup
        detection={popupDetection}
        onClose={handleClosePopup}
      />
    </div>
  );
}

export default App;

