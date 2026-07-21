import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: '배당 스냅샷 쓰기는 서버의 배당 공시 수집 작업으로 이동했습니다.',
      code: 'DIVIDEND_WRITER_MOVED_TO_FUNCTIONS',
    },
    { status: 410 }
  );
}
