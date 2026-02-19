'use client';

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
  return (
    <Portal>
      <div
        className={className || 'fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]'}
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
