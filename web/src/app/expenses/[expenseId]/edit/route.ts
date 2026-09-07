export const dynamic = 'force-dynamic';

/** 알림 주소는 HTML을 렌더링하지 않고 기존 원장 수정 화면으로 이동합니다. */
export function GET(_request: Request, { params }: { params: { expenseId: string } }) {
  const query = new URLSearchParams({ edit: params.expenseId });
  // 동적 HTML의 inline script는 정적 빌드의 CSP hash에 포함되지 않습니다.
  // HTTP redirect는 구 worker가 만든 주소도 script 실행 없이 연결합니다.
  return new Response(null, {
    status: 307,
    // 서버가 정규화한 host 대신 사용자가 연 origin과 로그인 저장소를 유지합니다.
    headers: { Location: `/?${query}`, 'Cache-Control': 'no-store' },
  });
}
