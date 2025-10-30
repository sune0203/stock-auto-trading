import { useState, useEffect } from 'react';
import './FloatingAlert.css';

interface FloatingAlertProps {
  hasNewDetection: boolean;
  count: number;
  onClick: () => void;
}

// 플로팅 알림 버튼 컴포넌트
export function FloatingAlert({ hasNewDetection, count, onClick }: FloatingAlertProps) {
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    if (hasNewDetection) {
      setIsBlinking(true);
      // 10초 후 깜빡임 중지
      const timer = setTimeout(() => {
        setIsBlinking(false);
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [hasNewDetection]);

  return (
    <div
      className={`floating-alert ${isBlinking ? 'blinking' : ''} ${hasNewDetection ? 'active' : ''}`}
      onClick={onClick}
      title="새로운 급등 가능성 종목 발견!"
    >
      <div className="alert-icon">🚀</div>
      {count > 0 && (
        <div className="alert-badge">{count}</div>
      )}
    </div>
  );
}

