import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './AccountManager.css'

interface Account {
  ka_id: number
  ka_type: 'REAL'
  ka_name: string
  ka_account_no: string
  ka_is_active: boolean
  ka_is_default: boolean
}

const AccountManager: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    ka_type: 'REAL' as 'REAL',
    ka_name: '',
    ka_account_no: '',
    ka_account_password: '',
    ka_app_key: '',
    ka_app_secret: ''
  })

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/accounts')
      setAccounts(response.data.accounts)
    } catch (error) {
      console.error('계정 목록 조회 실패:', error)
    }
  }

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const response = await axios.post('http://localhost:3001/api/accounts/add', formData)
      if (response.data.success) {
        alert('계정이 추가되었습니다')
        setShowAddForm(false)
        setFormData({
          ka_type: 'REAL',
          ka_name: '',
          ka_account_no: '',
          ka_account_password: '',
          ka_app_key: '',
          ka_app_secret: ''
        })
        loadAccounts()
      }
    } catch (error) {
      console.error('계정 추가 실패:', error)
      alert('계정 추가에 실패했습니다')
    }
  }

  const handleSetDefault = async (accountId: number) => {
    try {
      const response = await axios.post('http://localhost:3001/api/accounts/set-default', { accountId })
      if (response.data.success) {
        alert('기본 계정이 설정되었습니다')
        loadAccounts()
      }
    } catch (error) {
      console.error('기본 계정 설정 실패:', error)
      alert('기본 계정 설정에 실패했습니다')
    }
  }

  return (
    <div className="account-manager">
      <div className="manager-header">
        <h2>계정 관리</h2>
        <button className="btn-add" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? '취소' : '계정 추가'}
        </button>
      </div>

      {showAddForm && (
        <form className="add-account-form" onSubmit={handleAddAccount}>
          <div className="form-group">
            <label>계정 타입</label>
            <input
              type="text"
              value="실전투자"
              disabled
              style={{ backgroundColor: '#f5f5f5', color: '#666' }}
            />
          </div>

          <div className="form-group">
            <label>계정 이름</label>
            <input
              type="text"
              value={formData.ka_name}
              onChange={(e) => setFormData({ ...formData, ka_name: e.target.value })}
              placeholder="예: 실전투자 서브"
              required
            />
          </div>

          <div className="form-group">
            <label>계좌번호 (10자리)</label>
            <input
              type="text"
              value={formData.ka_account_no}
              onChange={(e) => setFormData({ ...formData, ka_account_no: e.target.value })}
              placeholder="1234567890"
              maxLength={10}
              required
            />
          </div>

          <div className="form-group">
            <label>계좌 비밀번호 (4자리)</label>
            <input
              type="password"
              value={formData.ka_account_password}
              onChange={(e) => setFormData({ ...formData, ka_account_password: e.target.value })}
              placeholder="1234"
              maxLength={4}
              required
            />
          </div>

          <div className="form-group">
            <label>APP KEY</label>
            <input
              type="text"
              value={formData.ka_app_key}
              onChange={(e) => setFormData({ ...formData, ka_app_key: e.target.value })}
              placeholder="PS..."
              required
            />
          </div>

          <div className="form-group">
            <label>APP SECRET</label>
            <textarea
              value={formData.ka_app_secret}
              onChange={(e) => setFormData({ ...formData, ka_app_secret: e.target.value })}
              placeholder="..."
              rows={3}
              required
            />
          </div>

          <button type="submit" className="btn-submit">계정 추가</button>
        </form>
      )}

      <div className="accounts-list">
        {accounts.map(account => (
          <div key={account.ka_id} className="account-card">
            <div className="account-header">
              <h3>{account.ka_name}</h3>
              <span className={`type-badge ${account.ka_type.toLowerCase()}`}>
                {account.ka_type === 'REAL' ? '실전' : '모의'}
              </span>
            </div>
            <div className="account-info">
              <p>계좌번호: {account.ka_account_no}</p>
              <p>상태: {account.ka_is_active ? '활성' : '비활성'}</p>
            </div>
            <div className="account-actions">
              {!account.ka_is_default && (
                <button
                  className="btn-set-default"
                  onClick={() => handleSetDefault(account.ka_id)}
                >
                  기본 계정으로 설정
                </button>
              )}
              {account.ka_is_default && (
                <span className="default-label">기본 계정</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AccountManager

