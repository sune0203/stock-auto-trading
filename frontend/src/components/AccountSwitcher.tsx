import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './AccountSwitcher.css'
import AccountManager from './AccountManager'

interface Account {
  ka_id: number
  ka_type: 'REAL'
  ka_name: string
  ka_account_no: string
  ka_is_active: boolean
  ka_is_default: boolean
}

interface CurrentAccount {
  ka_id: number
  ka_type: 'REAL'
  ka_name: string
  ka_account_no: string
}

const AccountSwitcher: React.FC = () => {
  const [currentAccount, setCurrentAccount] = useState<CurrentAccount | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showMenu, setShowMenu] = useState(false)
  const [showManager, setShowManager] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // 현재 계정 정보 로드
  useEffect(() => {
    loadCurrentAccount()
    loadAccounts()
  }, [])

  const loadCurrentAccount = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/accounts/current')
      setCurrentAccount(response.data)
    } catch (error) {
      console.error('현재 계정 조회 실패:', error)
    }
  }

  const loadAccounts = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/accounts')
      setAccounts(response.data.accounts)
    } catch (error) {
      console.error('계정 목록 조회 실패:', error)
    }
  }

  // 실전투자 계정으로 전환 (모의투자 제거)
  const switchAccountType = async () => {
    if (isLoading || currentAccount?.ka_type === 'REAL') return

    setIsLoading(true)
    try {
      const response = await axios.post('http://localhost:3001/api/accounts/switch-type', {})
      if (response.data.success) {
        await loadCurrentAccount()
        alert(response.data.message)
        window.location.reload() // 페이지 새로고침
      }
    } catch (error) {
      console.error('계정 타입 전환 실패:', error)
      alert('계정 전환에 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }

  // 특정 계정으로 전환
  const switchAccount = async (accountId: number) => {
    if (isLoading || currentAccount?.ka_id === accountId) return

    setIsLoading(true)
    try {
      const response = await axios.post('http://localhost:3001/api/accounts/switch', { accountId })
      if (response.data.success) {
        await loadCurrentAccount()
        setShowMenu(false)
        alert(response.data.message)
        window.location.reload() // 페이지 새로고침
      }
    } catch (error) {
      console.error('계정 전환 실패:', error)
      alert('계정 전환에 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }

  // 현재 타입의 계정 필터링
  const currentTypeAccounts = accounts.filter(acc => acc.ka_type === currentAccount?.ka_type)

  return (
    <>
      <div className="account-switcher">
        {/* 실전투자만 지원 */}
        <div className="account-type-toggle">
        <button
          className="toggle-btn active"
          disabled={true}
        >
          실전투자
        </button>
      </div>

      {/* 현재 계정 표시 */}
      {currentAccount && (
        <div className="current-account" onClick={() => setShowMenu(!showMenu)}>
          <div className="account-info">
            <span className="account-name">{currentAccount.ka_name}</span>
            <span className="account-no">{currentAccount.ka_account_no}</span>
          </div>
          <span className="dropdown-arrow">{showMenu ? '▲' : '▼'}</span>
        </div>
      )}

      {/* 계정 선택 메뉴 */}
      {showMenu && (
        <div className="account-menu">
          {currentTypeAccounts.length > 0 ? (
            currentTypeAccounts.map(account => (
              <div
                key={account.ka_id}
                className={`account-item ${account.ka_id === currentAccount?.ka_id ? 'selected' : ''}`}
                onClick={() => switchAccount(account.ka_id)}
              >
                <div className="account-item-info">
                  <span className="account-item-name">{account.ka_name}</span>
                  <span className="account-item-no">{account.ka_account_no}</span>
                </div>
                {account.ka_is_default && <span className="default-badge">기본</span>}
              </div>
            ))
          ) : (
            <div className="account-item empty">
              등록된 계정이 없습니다
            </div>
          )}
          <div className="account-menu-footer">
            <button className="btn-manage" onClick={() => { setShowMenu(false); setShowManager(true); }}>
              계정 관리
            </button>
          </div>
        </div>
      )}
      </div>

      {/* 계정 관리 모달 */}
      {showManager && (
        <div className="modal-overlay" onClick={() => setShowManager(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowManager(false)}>×</button>
            <AccountManager />
          </div>
        </div>
      )}
    </>
  )
}

export default AccountSwitcher

