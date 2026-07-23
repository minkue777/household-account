'use client';

import { createPortal } from 'react-dom';

interface PortalProps {
  children: React.ReactNode;
}

export default function Portal({ children }: PortalProps) {
  // 모달은 사용자 상호작용 뒤 클라이언트에서만 열립니다. 별도 mounted
  // effect를 거치면 모든 모달 표시가 한 React commit 늦어집니다.
  if (typeof document === 'undefined') return null;

  return createPortal(children, document.body);
}
