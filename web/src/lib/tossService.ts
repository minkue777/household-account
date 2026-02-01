/**
 * 토스 송금 딥링크 서비스
 */

// 은행 코드 목록 (code: 금융결제원 코드, name: 표시명, tossName: 토스 딥링크용)
export const BANK_LIST = [
  { code: '004', name: 'KB국민은행', tossName: '국민' },
  { code: '088', name: '신한은행', tossName: '신한' },
  { code: '020', name: '우리은행', tossName: '우리' },
  { code: '081', name: '하나은행', tossName: '하나' },
  { code: '011', name: 'NH농협은행', tossName: '농협' },
  { code: '003', name: 'IBK기업은행', tossName: '기업' },
  { code: '023', name: 'SC제일은행', tossName: 'SC제일' },
  { code: '090', name: '카카오뱅크', tossName: '카카오뱅크' },
  { code: '092', name: '토스뱅크', tossName: '토스뱅크' },
  { code: '089', name: '케이뱅크', tossName: '케이뱅크' },
  { code: '002', name: 'KDB산업은행', tossName: '산업' },
  { code: '032', name: '부산은행', tossName: '부산' },
  { code: '034', name: '광주은행', tossName: '광주' },
  { code: '035', name: '제주은행', tossName: '제주' },
  { code: '037', name: '전북은행', tossName: '전북' },
  { code: '039', name: '경남은행', tossName: '경남' },
  { code: '045', name: '새마을금고', tossName: '새마을' },
  { code: '048', name: '신협', tossName: '신협' },
  { code: '071', name: '우체국', tossName: '우체국' },
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
 * 은행 코드로 토스용 은행명 찾기
 */
export function getTossBankName(code: string): string {
  const bank = BANK_LIST.find(b => b.code === code);
  return bank?.tossName || '국민';
}

/**
 * 안드로이드 여부 확인
 */
function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * iOS 여부 확인
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
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

  // 토스용 은행명으로 변환 (코드 → 한글)
  const tossBankName = getTossBankName(bankCode);

  // 쿼리 파라미터 생성
  const queryParams = new URLSearchParams();
  queryParams.set('bank', tossBankName);
  queryParams.set('accountNo', accountNo);
  queryParams.set('amount', amount.toString());
  if (message) {
    queryParams.set('message', message);
  }

  if (isAndroid()) {
    // 안드로이드: intent:// URL 사용
    // intent://send?params#Intent;scheme=supertoss;package=viva.republica.toss;end
    return `intent://send?${queryParams.toString()}#Intent;scheme=supertoss;package=viva.republica.toss;end`;
  } else {
    // iOS 및 기타: 기본 딥링크
    return `supertoss://send?${queryParams.toString()}`;
  }
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

  // <a> 태그를 동적으로 생성해서 클릭 (더 안정적인 방식)
  const anchor = document.createElement('a');
  anchor.href = link;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
