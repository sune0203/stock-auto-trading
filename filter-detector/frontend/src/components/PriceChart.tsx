import { useEffect, useState } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend 
} from 'recharts';
import { DetectionResult, PriceTrackHistory } from '../types';
import { apiService } from '../services/api';
import './PriceChart.css';

interface PriceChartProps {
  detection: DetectionResult | null;
  onSelectDetection?: (detection: DetectionResult) => void;
}

// 가격 차트 컴포넌트
export function PriceChart({ detection, onSelectDetection }: PriceChartProps) {
  const [history, setHistory] = useState<PriceTrackHistory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (detection && detection.id) {
      loadHistory(detection.id);

      // 30초마다 갱신
      const interval = setInterval(() => {
        loadHistory(detection.id!);
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [detection]);

  const loadHistory = async (detectionId: number) => {
    setLoading(true);
    try {
      const data = await apiService.getPriceHistory(detectionId);
      setHistory(data);
    } catch (error) {
      console.error('가격 히스토리 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 감지 목록 로드 (차트가 비어있을 때)
  const [allDetections, setAllDetections] = useState<DetectionResult[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!detection) {
      loadAllDetections();
      
      // 10초마다 감지 목록 갱신
      const interval = setInterval(loadAllDetections, 10000);
      return () => clearInterval(interval);
    }
  }, [detection]);

  const loadAllDetections = async () => {
    setLoadingList(true);
    try {
      const data = await apiService.getActiveDetections();
      setAllDetections(data);
    } catch (error) {
      console.error('감지 목록 로드 실패:', error);
    } finally {
      setLoadingList(false);
    }
  };

  const handleStopTracking = async (detectionId: number) => {
    if (!confirm('이 종목의 추적을 중지하시겠습니까?')) {
      return;
    }

    try {
      await apiService.stopTracking(detectionId);
      loadAllDetections();
    } catch (error) {
      console.error('추적 중지 실패:', error);
      alert('추적 중지에 실패했습니다.');
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!detection) {
    return (
      <div className="price-chart empty">
        <div className="empty-header">
          <h3>📊 감지된 급등 가능성 종목</h3>
          <button className="refresh-btn" onClick={loadAllDetections}>
            🔄 새로고침
          </button>
        </div>

        {loadingList ? (
          <div className="empty-loading">로딩 중...</div>
        ) : allDetections.length === 0 ? (
          <div className="empty-message">
            <p>아직 감지된 종목이 없습니다.</p>
            <p>왼쪽에서 스캔을 시작해보세요!</p>
          </div>
        ) : (
          <div className="detection-grid">
            {allDetections.map((det) => (
              <div key={det.id} className="detection-card" onClick={() => onSelectDetection(det)}>
                <div className="card-header">
                  <div className="card-symbol">{det.symbol}</div>
                  <div className="card-score">{det.score}점</div>
                </div>

                <div className="card-price">
                  ${det.currentPrice.toFixed(4)}
                  <span className="card-session">{det.session}</span>
                </div>

                <div className="card-time">
                  {formatTime(det.detectedAt)}
                </div>

                <div className="card-reasons">
                  {det.reasons.slice(0, 2).map((reason, index) => (
                    <div key={index} className="reason-badge">
                      {reason}
                    </div>
                  ))}
                </div>

                {det.secEvent ? (
                  <div className="card-sec-section">
                    <div className="card-sec-badge">
                      📋 {det.secEvent.type} 공시
                      {det.secEvent.url && (
                        <a 
                          href={det.secEvent.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="sec-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          보기
                        </a>
                      )}
                    </div>
                    
                    {det.secEvent.analysis && (
                      <div className="sec-analysis">
                        <div className="analysis-summary">{det.secEvent.analysis.summary}</div>
                        <div className="analysis-scores">
                          <span className="score-item positive">
                            호재 {det.secEvent.analysis.positiveScore}/10
                          </span>
                          <span className="score-item negative">
                            악재 {det.secEvent.analysis.negativeScore}/10
                          </span>
                          <span className="score-item probability">
                            상승확률 {det.secEvent.analysis.upProbability}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                <button
                  className="card-stop-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStopTracking(det.id!);
                  }}
                >
                  추적 중지
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 차트 데이터 변환
  const chartData = history.map(item => ({
    time: new Date(item.timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    price: item.price,
    change: item.changePercent,
  }));

  // 현재 변동률
  const latestHistory = history[history.length - 1];
  const changePercent = latestHistory ? latestHistory.changePercent : 0;
  const isPositive = changePercent >= 0;

  return (
    <div className="price-chart">
      <div className="chart-header">
        <button 
          className="chart-back-btn"
          onClick={() => onSelectDetection?.(null as any)}
          title="목록으로 돌아가기"
        >
          ✕
        </button>
        
        <div className="chart-title">
          <h3>{detection.symbol} 가격 추적</h3>
          <span className="chart-score">점수: {detection.score}</span>
        </div>

        <div className="chart-stats">
          <div className="stat-item">
            <span className="stat-label">감지가</span>
            <span className="stat-value">
              ${detection.currentPrice.toFixed(4)}
            </span>
          </div>

          {latestHistory && (
            <>
              <div className="stat-item">
                <span className="stat-label">현재가</span>
                <span className="stat-value">
                  ${latestHistory.price.toFixed(4)}
                </span>
              </div>

              <div className="stat-item">
                <span className="stat-label">변동률</span>
                <span className={`stat-value ${isPositive ? 'positive' : 'negative'}`}>
                  {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {loading && history.length === 0 ? (
        <div className="chart-loading">차트 로딩 중...</div>
      ) : history.length === 0 ? (
        <div className="chart-empty">가격 데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="time" 
              tick={{ fontSize: 12 }}
              stroke="#999"
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              stroke="#999"
              domain={['auto', 'auto']}
            />
            <Tooltip 
              contentStyle={{
                background: 'white',
                border: '1px solid #ddd',
                borderRadius: '6px',
              }}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="price" 
              name="가격"
              stroke="#667eea" 
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="chart-info">
        <div className="info-item">
          <strong>거래량:</strong> {detection.volume.toLocaleString()}
        </div>
        <div className="info-item">
          <strong>세션:</strong> {detection.session}
        </div>
        <div className="info-item">
          <strong>감지 시간:</strong> {new Date(detection.detectedAt).toLocaleString('ko-KR')}
        </div>
      </div>

      <div className="chart-reasons">
        <strong>감지 이유:</strong>
        <ul>
          {detection.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

