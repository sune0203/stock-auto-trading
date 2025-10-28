#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KIS 종목 마스터 파일을 MySQL DB에 Import하는 스크립트

사용법:
    python import_stocks_from_kis.py

필요 패키지:
    pip install mysql-connector-python python-dotenv
"""

import mysql.connector
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Windows 콘솔 UTF-8 설정
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# .env 파일 로드
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

# DB 연결 정보
DB_CONFIG = {
    'host': os.getenv('DB_HOST', '116.122.37.82'),
    'user': os.getenv('DB_USER', 'nasdaq'),
    'password': os.getenv('DB_PASSWORD', 'core1601!'),
    'database': os.getenv('DB_NAME', 'nasdaq'),
    'charset': 'utf8mb4',
    'collation': 'utf8mb4_unicode_ci'
}

# 파일 경로
DATA_DIR = Path(__file__).parent.parent.parent / 'data'
FILES = {
    'NASDAQ': DATA_DIR / 'nasmst.txt',
    'NYSE': DATA_DIR / 'nysmst.txt',
    'AMEX': DATA_DIR / 'amsmst.txt'
}

def parse_line(line, exchange):
    """한 줄을 파싱하여 딕셔너리로 반환"""
    try:
        parts = line.strip().split('\t')
        if len(parts) < 10:
            return None
        
        ticker = parts[4].strip()
        name_kr = parts[6].strip()
        name_en = parts[7].strip()
        
        # 빈 값 체크
        if not ticker or not name_kr or not name_en:
            return None
        
        # 특수 문자 제거 (유닛, 워런트 등)
        # ticker가 /가 포함되어 있으면 스킵 (AAM/UN 같은 경우)
        if '/' in ticker or ' ' in ticker:
            return None
        
        return {
            'ticker': ticker,
            'name_kr': name_kr,
            'name_en': name_en,
            'exchange': exchange
        }
    except Exception as e:
        print(f"⚠️ 파싱 오류: {str(e)[:50]}")
        return None

def import_stocks():
    """종목 데이터를 DB에 Import"""
    print("=" * 60)
    print("🚀 KIS 종목 마스터 데이터 Import 시작")
    print("=" * 60)
    
    # DB 연결
    print(f"\n📡 DB 연결 중... ({DB_CONFIG['host']}:{DB_CONFIG['database']})")
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()
        print("✅ DB 연결 성공")
    except Exception as e:
        print(f"❌ DB 연결 실패: {e}")
        return
    
    try:
        # 기존 데이터 삭제 (선택사항)
        print("\n🗑️ 기존 데이터 삭제 중...")
        cursor.execute("DELETE FROM _STOCKS")
        conn.commit()
        print(f"✅ 기존 데이터 삭제 완료 ({cursor.rowcount}개)")
        
        # INSERT 쿼리 준비
        insert_query = """
            INSERT INTO _STOCKS (s_ticker, s_name, s_name_kr, s_exchange)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                s_name = VALUES(s_name),
                s_name_kr = VALUES(s_name_kr),
                s_exchange = VALUES(s_exchange),
                s_updated_at = CURRENT_TIMESTAMP
        """
        
        total_count = 0
        success_count = 0
        
        # 각 파일 처리
        for exchange, file_path in FILES.items():
            print(f"\n📁 {exchange} 파일 처리 중: {file_path.name}")
            
            if not file_path.exists():
                print(f"⚠️ 파일 없음: {file_path}")
                continue
            
            file_count = 0
            batch = []
            
            with open(file_path, 'r', encoding='utf-8') as f:
                for line_num, line in enumerate(f, 1):
                    total_count += 1
                    
                    stock = parse_line(line, exchange)
                    if stock:
                        batch.append((
                            stock['ticker'],
                            stock['name_en'],
                            stock['name_kr'],
                            stock['exchange']
                        ))
                        file_count += 1
                        
                        # 1000개마다 배치 INSERT
                        if len(batch) >= 1000:
                            cursor.executemany(insert_query, batch)
                            conn.commit()
                            success_count += len(batch)
                            print(f"   💾 {success_count}개 저장 완료...")
                            batch = []
            
            # 남은 데이터 INSERT
            if batch:
                cursor.executemany(insert_query, batch)
                conn.commit()
                success_count += len(batch)
            
            print(f"✅ {exchange}: {file_count}개 처리 완료")
        
        print("\n" + "=" * 60)
        print(f"✅ Import 완료!")
        print(f"   📊 총 라인: {total_count:,}")
        print(f"   ✅ 저장 성공: {success_count:,}")
        print(f"   ⚠️ 스킵: {total_count - success_count:,}")
        print("=" * 60)
        
        # 샘플 데이터 확인
        print("\n📋 샘플 데이터 (10개):")
        cursor.execute("""
            SELECT s_ticker, s_name_kr, s_name, s_exchange 
            FROM _STOCKS 
            ORDER BY s_ticker 
            LIMIT 10
        """)
        for row in cursor.fetchall():
            print(f"   {row[0]:8} | {row[1]:20} | {row[2]:40} | {row[3]}")
        
    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()
        print("\n🔌 DB 연결 종료")

if __name__ == '__main__':
    import_stocks()

