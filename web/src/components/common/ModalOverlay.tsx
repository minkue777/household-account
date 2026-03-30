'use client';

import { useEffect } from 'react';
import Portal from './Portal';

interface ModalOverlayProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

/**
 * Portal + 오버레이 래퍼
 * 기본: 센터 정렬, bg-black/50, z-[9999]
 * className으로 오버레이 스타일 커스터마이징 가능
 */
export default function ModalOverlay({ children, onClose, className }: ModalOverlayProps) {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  return (
    <Portal>
      <div
        className={
          className ||
          'fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-4 sm:items-center sm:py-6'
        }
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) {
            onClose();
          }
        }}
      >
        {children}
      </div>
    </Portal>
  );
}
