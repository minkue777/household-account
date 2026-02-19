'use client';

import { useState, useEffect } from 'react';
import { PersonalAccountStorage, LocalPersonalAccount } from '@/lib/storage/personalAccountStorage';
import { BANK_LIST } from '@/lib/tossService';

export default function PersonalAccountSettings() {
  // 섹션 펼침/접힘 상태
  const [isPersonalAccountOpen, setIsPersonalAccountOpen] = useState(false);

  // 개인 계좌 상태 (localStorage에 저장 - 기기별)
  const [personalAccount, setPersonalAccount] = useState<LocalPersonalAccount | null>(null);
  const [isEditingAccount, setIsEditingAccount] = useState(false);
  const [accountBankCode, setAccountBankCode] = useState('');
  const [accountNo, setAccountNo] = useState('');

  useEffect(() => {
    // 개인 계좌 로드 (localStorage)
    setPersonalAccount(PersonalAccountStorage.get());
  }, []);

  // 개인 계좌 핸들러 (localStorage 기반)
  const handleStartEditAccount = () => {
    if (personalAccount) {
      setAccountBankCode(personalAccount.bankCode);
      setAccountNo(personalAccount.accountNo);
    }
    setIsEditingAccount(true);
  };

  const handleSavePersonalAccount = () => {
    if (!accountBankCode || !accountNo.trim()) return;

    const bank = BANK_LIST.find(b => b.code === accountBankCode);
    const accountData: LocalPersonalAccount = {
      bankCode: accountBankCode,
      bankName: bank?.name || '알 수 없는 은행',
      accountNo: accountNo.replace(/[^0-9]/g, ''),
    };

    PersonalAccountStorage.set(accountData);
    setPersonalAccount(accountData);
    setIsEditingAccount(false);
    setAccountBankCode('');
    setAccountNo('');
  };

  const handleDeletePersonalAccount = () => {
    if (!confirm('계좌 정보를 삭제하시겠습니까?')) return;
    PersonalAccountStorage.clear();
    setPersonalAccount(null);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsPersonalAccountOpen(!isPersonalAccountOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">내 정산 계좌</div>
            <div className="text-sm text-slate-500">
              {personalAccount ? personalAccount.bankName : '미설정'}
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${isPersonalAccountOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isPersonalAccountOpen && (
        <div className="border-t border-slate-100">
          {/* 설명 */}
          <div className="p-4 bg-teal-50 border-b border-teal-100">
            <p className="text-sm text-teal-700">
              지출 수정 화면에서 &quot;정산하기&quot;를 누르면 이 계좌로 송금하는 토스 앱이 열립니다.
              <br />
              <span className="text-teal-600 font-medium">이 기기에만 저장됩니다.</span>
            </p>
          </div>

          {/* 계좌 편집 폼 */}
          {isEditingAccount ? (
            <div className="p-4 space-y-4">
              {/* 은행 선택 */}
              <div>
                <label className="block text-sm text-slate-600 mb-1">은행</label>
                <select
                  value={accountBankCode}
                  onChange={(e) => setAccountBankCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">은행을 선택하세요</option>
                  {BANK_LIST.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 계좌번호 */}
              <div>
                <label className="block text-sm text-slate-600 mb-1">계좌번호</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value.replace(/[^0-9-]/g, ''))}
                  placeholder="계좌번호 입력"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* 버튼 */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsEditingAccount(false);
                    setAccountBankCode('');
                    setAccountNo('');
                  }}
                  className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSavePersonalAccount}
                  disabled={!accountBankCode || !accountNo.trim()}
                  className="flex-1 py-2 px-4 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  저장
                </button>
              </div>
            </div>
          ) : personalAccount ? (
            /* 계좌 표시 */
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center text-white text-sm font-medium">
                    {personalAccount.bankName.slice(0, 2)}
                  </div>
                  <div>
                    <div className="font-medium text-slate-800">
                      {personalAccount.bankName}
                    </div>
                    <div className="text-sm text-slate-500">
                      {personalAccount.accountNo}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleStartEditAccount}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={handleDeletePersonalAccount}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* 계좌 미등록 */
            <button
              onClick={() => setIsEditingAccount(true)}
              className="w-full p-4 flex items-center justify-center gap-2 text-teal-600 hover:bg-teal-50 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="font-medium">계좌 등록하기</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
