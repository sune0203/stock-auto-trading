import { useState, useEffect, useRef } from 'react';
import { apiService } from '../services/api';
import './ScannerControl.css';

// 스캐너 제어 컴포넌트
export function ScannerControl() {
  const [scanType, setScanType] = useState<'pennystock' | 'active' | 'gainers' | 'most-actives' | 'custom'>('gainers');
  const [customSymbols, setCustomSymbols] = useState('');
  const [maxPrice, setMaxPrice] = useState(5);
  const [minVolume, setMinVolume] = useState(100000);
  const [scanning, setScanning] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // 스캔 실행 (수동/자동 공통)
  const executeScan = async (silent = false) => {
    setScanning(true);

    try {
      let params: any = { scanType };

      if (scanType === 'pennystock') {
        params.maxPrice = maxPrice;
      } else if (scanType === 'active') {
        params.minVolume = minVolume;
      } else if (scanType === 'custom') {
        const symbols = customSymbols
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(s => s.length > 0);

        if (symbols.length === 0 && !silent) {
          alert('심볼을 입력해주세요.');
          return;
        }

        params.symbols = symbols;
      }

      const results = await apiService.runManualScan(params);
      
      if (!silent) {
        alert(`스캔 완료!\n${results.length}개 급등 가능성 종목 발견`);
      }
      
      // 카운트다운 리셋
      setCountdown(30);
    } catch (error) {
      console.error('스캔 실패:', error);
      if (!silent) {
        alert('스캔에 실패했습니다.');
      }
    } finally {
      setScanning(false);
    }
  };

  // 수동 스캔 실행
  const handleScan = () => {
    executeScan(false);
  };

  // 자동 스캔 토글
  const handleAutoScanToggle = () => {
    setAutoScan(!autoScan);
  };

  // 자동 스캔 효과
  useEffect(() => {
    if (autoScan) {
      // 즉시 한 번 실행
      executeScan(true);

      // 30초마다 자동 스캔
      intervalRef.current = setInterval(() => {
        executeScan(true);
      }, 30000);

      // 카운트다운 타이머
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            return 30;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      // 자동 스캔 종료 시 타이머 정리
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdown(30);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoScan, scanType, maxPrice, minVolume, customSymbols]);

  // 단일 종목 분석
  const handleAnalyzeSymbol = async () => {
    const symbol = prompt('분석할 심볼을 입력하세요:');
    if (!symbol) return;

    setScanning(true);

    try {
      const result = await apiService.analyzeSymbol(symbol.toUpperCase());
      
      if (result) {
        alert(
          `${result.symbol} 분석 결과\n\n` +
          `점수: ${result.score}\n` +
          `가격: $${result.currentPrice.toFixed(4)}\n` +
          `이유:\n- ${result.reasons.join('\n- ')}`
        );
      } else {
        alert(`${symbol}은(는) 급등 가능성이 낮습니다.`);
      }
    } catch (error) {
      console.error('분석 실패:', error);
      alert('종목 분석에 실패했습니다.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="scanner-control">
      <h2>스캐너 제어</h2>

      <div className="scan-type-selector">
        <label className="radio-label">
          <input
            type="radio"
            value="gainers"
            checked={scanType === 'gainers'}
            onChange={(e) => setScanType(e.target.value as any)}
          />
          <span>🚀 최대 상승 종목 (추천)</span>
        </label>

        <label className="radio-label">
          <input
            type="radio"
            value="most-actives"
            checked={scanType === 'most-actives'}
            onChange={(e) => setScanType(e.target.value as any)}
          />
          <span>🔥 최대 거래량 종목</span>
        </label>

        <label className="radio-label">
          <input
            type="radio"
            value="active"
            checked={scanType === 'active'}
            onChange={(e) => setScanType(e.target.value as any)}
          />
          <span>활성 거래 종목</span>
        </label>

        <label className="radio-label">
          <input
            type="radio"
            value="pennystock"
            checked={scanType === 'pennystock'}
            onChange={(e) => setScanType(e.target.value as any)}
          />
          <span>나스닥 동전주</span>
        </label>

        <label className="radio-label">
          <input
            type="radio"
            value="custom"
            checked={scanType === 'custom'}
            onChange={(e) => setScanType(e.target.value as any)}
          />
          <span>커스텀 심볼</span>
        </label>
      </div>

      {scanType === 'pennystock' && (
        <div className="scan-option">
          <label>
            최대 가격: $
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              min="1"
              max="10"
              step="0.5"
            />
          </label>
        </div>
      )}

      {scanType === 'active' && (
        <div className="scan-option">
          <label>
            최소 거래량:
            <input
              type="number"
              value={minVolume}
              onChange={(e) => setMinVolume(Number(e.target.value))}
              min="10000"
              step="10000"
            />
          </label>
        </div>
      )}

      {scanType === 'custom' && (
        <div className="scan-option">
          <label>
            심볼 (쉼표로 구분):
            <textarea
              value={customSymbols}
              onChange={(e) => setCustomSymbols(e.target.value)}
              placeholder="AAPL, TSLA, MSFT"
              rows={3}
            />
          </label>
        </div>
      )}

      <div className="scan-buttons">
        <button
          className="scan-button primary"
          onClick={handleScan}
          disabled={scanning || autoScan}
        >
          {scanning ? '스캔 중...' : '🔍 스캔 시작'}
        </button>

        <button
          className={`scan-button ${autoScan ? 'active' : ''}`}
          onClick={handleAutoScanToggle}
          disabled={scanning}
        >
          {autoScan ? `⏸️ 자동 중지 (${countdown}초)` : '▶️ 자동 스캔'}
        </button>

        <button
          className="scan-button"
          onClick={handleAnalyzeSymbol}
          disabled={scanning}
        >
          📊 단일 종목 분석
        </button>
      </div>

      {autoScan && (
        <div className="auto-scan-info">
          <p>✅ 자동 스캔 활성화</p>
          <p>30초마다 자동으로 스캔합니다</p>
        </div>
      )}
    </div>
  );
}

