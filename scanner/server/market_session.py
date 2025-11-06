# server/market_session.py
"""
미국 주식 시장 세션 감지
한국 시간 기준으로 현재 미국 시장 상태 판단
"""
from datetime import datetime, timezone, timedelta

# UTC 기준으로 계산 (미국 동부 = UTC-5/-4)
def get_us_eastern_offset():
    """
    미국 동부 시간 오프셋 반환
    DST 고려 (3월 두번째 일요일 ~ 11월 첫번째 일요일)
    """
    now = datetime.utcnow()
    year = now.year
    
    # DST 시작/종료 날짜 계산
    march_sunday = datetime(year, 3, 8)
    while march_sunday.weekday() != 6:
        march_sunday += timedelta(days=1)
    
    november_sunday = datetime(year, 11, 1)
    while november_sunday.weekday() != 6:
        november_sunday += timedelta(days=1)
    
    # DST 기간 체크
    if march_sunday <= now < november_sunday:
        return timedelta(hours=-4)  # EDT (Eastern Daylight Time)
    else:
        return timedelta(hours=-5)  # EST (Eastern Standard Time)

def get_current_us_time():
    """
    현재 미국 동부 시간 반환
    """
    offset = get_us_eastern_offset()
    return datetime.utcnow() + offset

def get_market_session():
    """
    현재 시장 세션 판단
    
    Returns:
        "RTH": 정규장 (9:30 AM - 4:00 PM ET)
        "PRE": 프리마켓 (4:00 AM - 9:30 AM ET)
        "AFTER": 애프터마켓 (4:00 PM - 8:00 PM ET)
        "CLOSED": 장 마감 (8:00 PM - 4:00 AM ET, 주말)
    """
    now = get_current_us_time()
    
    # 주말 체크 (토요일=5, 일요일=6)
    if now.weekday() >= 5:
        return "CLOSED"
    
    # 시간 체크
    time_now = now.time()
    
    # 정규장: 9:30 AM - 4:00 PM
    if time_now >= datetime.strptime("09:30", "%H:%M").time() and \
       time_now < datetime.strptime("16:00", "%H:%M").time():
        return "RTH"
    
    # 프리마켓: 4:00 AM - 9:30 AM
    elif time_now >= datetime.strptime("04:00", "%H:%M").time() and \
         time_now < datetime.strptime("09:30", "%H:%M").time():
        return "PRE"
    
    # 애프터마켓: 4:00 PM - 8:00 PM
    elif time_now >= datetime.strptime("16:00", "%H:%M").time() and \
         time_now < datetime.strptime("20:00", "%H:%M").time():
        return "AFTER"
    
    # 장 마감: 8:00 PM - 4:00 AM
    else:
        return "CLOSED"

def is_trading_hours():
    """
    현재 거래 가능한 시간인지 (PRE/RTH/AFTER)
    """
    session = get_market_session()
    return session in ["PRE", "RTH", "AFTER"]

def get_session_info():
    """
    현재 세션 상세 정보 반환
    """
    session = get_market_session()
    now = get_current_us_time()
    
    session_names = {
        "RTH": "정규장",
        "PRE": "프리마켓",
        "AFTER": "애프터마켓",
        "CLOSED": "장마감"
    }
    
    offset = get_us_eastern_offset()
    tz_name = "EDT" if offset == timedelta(hours=-4) else "EST"
    
    return {
        "session": session,
        "session_name": session_names.get(session, "알 수 없음"),
        "us_time": now.strftime(f"%Y-%m-%d %H:%M:%S {tz_name}"),
        "is_trading": session in ["PRE", "RTH", "AFTER"],
        "has_intraday_data": session == "RTH",  # 분봉 데이터 사용 가능 여부
    }

if __name__ == "__main__":
    # 테스트
    info = get_session_info()
    print("=== 시장 세션 정보 ===")
    print(f"현재 세션: {info['session_name']} ({info['session']})")
    print(f"미국 시간: {info['us_time']}")
    print(f"거래 가능: {info['is_trading']}")
    print(f"분봉 사용: {info['has_intraday_data']}")

