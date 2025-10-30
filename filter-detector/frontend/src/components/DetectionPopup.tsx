import { useEffect, useState } from 'react';
import { DetectionResult } from '../types';
import './DetectionPopup.css';

interface DetectionPopupProps {
  detection: DetectionResult | null;
  onClose: () => void;
}

// 감지 알림 팝업 컴포넌트
export function DetectionPopup({ detection, onClose }: DetectionPopupProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (detection) {
      setIsVisible(true);

      // 10초 후 자동 닫기
      const timer = setTimeout(() => {
        handleClose();
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [detection]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300); // 애니메이션 후 닫기
  };

  if (!detection) return null;

  return (
    <div className={`detection-popup ${isVisible ? 'visible' : ''}`}>
      <div className="popup-header">
        <div className="popup-title">
          <span className="popup-icon">🎯</span>
          <span>급등 가능성 감지!</span>
        </div>
        <button className="popup-close" onClick={handleClose}>
          ✕
        </button>
      </div>

      <div className="popup-content">
        <div className="popup-symbol">
          {detection.symbol}
        </div>

        <div className="popup-price">
          ${detection.currentPrice.toFixed(4)}
          <span className="popup-session">{detection.session}</span>
        </div>

        <div className="popup-score">
          점수: <strong>{detection.score}</strong>
        </div>

        <div className="popup-reasons">
          {detection.reasons.map((reason, index) => (
            <div key={index} className="reason-item">
              • {reason}
            </div>
          ))}
        </div>

        {detection.secEvent && (
          <div className="popup-sec-event">
            📋 최근 SEC 공시 발견
          </div>
        )}
      </div>
    </div>
  );
}

