@echo off
REM 병렬 스캐너 실행 (Windows)
REM 약 4860개 종목을 10개 배치로 분할 (각 486개씩)

echo ========================================
echo 병렬 스캐너 실행
echo ========================================
echo.
echo 총 4860개 종목을 10개 배치로 분할합니다.
echo 각 배치를 별도 터미널에서 실행하세요.
echo.
echo ========================================
echo 실행 명령어:
echo ========================================
echo.

echo 배치 1:  python offline/scanner.py --start 0 --end 486 --batch 1
echo 배치 2:  python offline/scanner.py --start 486 --end 972 --batch 2
echo 배치 3:  python offline/scanner.py --start 972 --end 1458 --batch 3
echo 배치 4:  python offline/scanner.py --start 1458 --end 1944 --batch 4
echo 배치 5:  python offline/scanner.py --start 1944 --end 2430 --batch 5
echo 배치 6:  python offline/scanner.py --start 2430 --end 2916 --batch 6
echo 배치 7:  python offline/scanner.py --start 2916 --end 3402 --batch 7
echo 배치 8:  python offline/scanner.py --start 3402 --end 3888 --batch 8
echo 배치 9:  python offline/scanner.py --start 3888 --end 4374 --batch 9
echo 배치 10: python offline/scanner.py --start 4374 --end 4860 --batch 10
echo.
echo ========================================
echo.
echo 모든 배치 완료 후:
echo   python offline/merge_batches.py
echo.
echo 배치 파일 정리:
echo   python offline/cleanup_batches.py
echo.
echo ========================================

pause

