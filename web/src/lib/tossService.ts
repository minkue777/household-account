/**
 * 토스 송금 딥링크 서비스
 */

// 은행 코드 목록
export const BANK_LIST = [
  { code: '004', name: 'KB국민은행' },
  { code: '088', name: '신한은행' },
  { code: '020', name: '우리은행' },
  { code: '081', name: '하나은행' },
  { code: '011', name: 'NH농협은행' },
  { code: '003', name: 'IBK기업은행' },
  { code: '023', name: 'SC제일은행' },
  { code: '090', name: '카카오뱅크' },
  { code: '092', name: '토스뱅크' },
  { code: '089', name: '케이뱅크' },
  { code: '002', name: 'KDB산업은행' },
  { code: '032', name: '부산은행' },
  { code: '034', name: '광주은행' },
  { code: '035', name: '제주은행' },
  { code: '037', name: '전북은행' },
  { code: '039', name: '경남은행' },
  { code: '045', name: '새마을금고' },
  { code: '048', name: '신협' },
  { code: '071', name: '우체국' },
] as const;

export type BankCode = typeof BANK_LIST[number]['code'];

/**
 * 은행 코드로 은행명 찾기
 */
export function getBankName(code: string): string {
  const bank = BANK_LIST.find(b => b.code === code);
  return bank?.name || '알 수 없는 은행';
}

/**
 * 토스 송금 딥링크 생성
 */
export function createTossTransferLink(params: {
  bankCode: string;
  accountNo: string;
  amount: number;
  message?: string;
}): string {
  const { bankCode, accountNo, amount, message } = params;

  // 토스 송금 딥링크 형식
  // supertoss://send?bank=XXX&accountNo=XXX&amount=XXX&message=XXX
  const url = new URL('supertoss://send');
  url.searchParams.set('bank', bankCode);
  url.searchParams.set('accountNo', accountNo);
  url.searchParams.set('amount', amount.toString());

  if (message) {
    url.searchParams.set('message', message);
  }

  return url.toString();
}

/**
 * 토스 앱으로 송금하기
 */
export function openTossTransfer(params: {
  bankCode: string;
  accountNo: string;
  amount: number;
  message?: string;
}): void {
  const link = createTossTransferLink(params);

  // 딥링크로 이동
  window.location.href = link;
}
