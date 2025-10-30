import { useState, useEffect } from 'react';
import { DetectionResult } from '../types';
import { apiService } from '../services/api';
import './DetectionList.css';

interface DetectionListProps {
  onSelectDetection: (detection: DetectionResult) => void;
}

// 감지 목록 컴포넌트
export function DetectionList({ onSelectDetection }: DetectionListProps) {
  const [detections, setDetections] = useState<DetectionResult[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(false);

  // 감지 목록 로드
  const loadDetections = async () => {
    setLoading(true);
    try {
      const data = activeOnly
        ? await apiService.getActiveDetections()
        : await apiService.getDetections(50, 0);
      
      setDetections(data);
    } catch (error) {
      console.error('감지 목록 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetections();
    
    // 10초마다 갱신
    const interval = setInterval(loadDetections, 10000);
    return () => clearInterval(interval);
  }, [activeOnly]);

  // 추적 중지
  const handleStopTracking = async (e: React.MouseEvent, detectionId: number) => {
    e.stopPropagation();
    
    if (!confirm('이 종목의 추적을 중지하시겠습니까?')) {
      return;
    }

    try {
      await apiService.stopTracking(detectionId);
      loadDetections();
    } catch (error) {
      console.error('추적 중지 실패:', error);
      alert('추적 중지에 실패했습니다.');
    }
  };

  // 시간 포맷
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="detection-list">
      <div className="list-header">
        <h2>급등 감지 목록</h2>
        
        <div className="list-controls">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <span>추적 중만 표시</span>
          </label>
          
          <button className="refresh-button" onClick={loadDetections}>
            🔄 새로고침
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : detections.length === 0 ? (
        <div className="empty-message">
          {activeOnly ? '추적 중인 종목이 없습니다.' : '감지된 종목이 없습니다.'}
        </div>
      ) : (
        <div className="detection-items">
          {detections.map((detection) => (
            <div
              key={detection.id}
              className="detection-item"
              onClick={() => onSelectDetection(detection)}
            >
              <div className="item-header">
                <div className="item-symbol">{detection.symbol}</div>
                <div className="item-score">{detection.score}점</div>
              </div>

              <div className="item-price">
                ${detection.currentPrice.toFixed(4)}
                <span className="item-session">{detection.session}</span>
              </div>

              <div className="item-time">
                {formatTime(detection.detectedAt)}
              </div>

              <div className="item-reasons">
                {detection.reasons.slice(0, 2).map((reason, index) => (
                  <span key={index} className="reason-tag">
                    {reason}
                  </span>
                ))}
              </div>

              {detection.secEvent && (
                <div className="item-sec-info">
                  <div className="sec-badge-small">
                    📋 {detection.secEvent.type}
                    {detection.secEvent.url && (
                      <a 
                        href={detection.secEvent.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="sec-link-small"
                      >
                        보기
                      </a>
                    )}
                  </div>
                  
                  {detection.secEvent.analysis && (
                    <div className="analysis-mini">
                      <span className="analysis-positive">
                        호재 {detection.secEvent.analysis.positiveScore}
                      </span>
                      <span className="analysis-negative">
                        악재 {detection.secEvent.analysis.negativeScore}
                      </span>
                      <span className="analysis-prob">
                        ↑{detection.secEvent.analysis.upProbability}%
                      </span>
                    </div>
                  )}
                </div>
              )}

              {detection.isTracking && (
                <button
                  className="stop-button"
                  onClick={(e) => handleStopTracking(e, detection.id!)}
                >
                  추적 중지
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

