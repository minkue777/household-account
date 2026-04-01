'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, ModalOverlay } from '@/components/common';
import {
  addRegisteredCard,
  deleteRegisteredCard,
  subscribeToRegisteredCards,
  updateRegisteredCard,
  updateRegisteredCardOrder,
} from '@/lib/registeredCardService';
import {
  NUMBERLESS_REGISTERED_CARD_LABELS,
  REGISTERED_CARD_LABELS,
  RegisteredCardLabel,
} from '@/types/registeredCard';

interface CardSettingsProps {
  householdId?: string | null;
  ownerName?: string | null;
}

interface CardItem {
  id: string;
  cardLabel: string;
  cardLastFour: string;
  orderIndex?: number;
}

function moveCard(cards: CardItem[], sourceId: string, targetId: string): CardItem[] {
  const sourceIndex = cards.findIndex((card) => card.id === sourceId);
  const targetIndex = cards.findIndex((card) => card.id === targetId);

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return cards;
  }

  const nextCards = [...cards];
  const [movedCard] = nextCards.splice(sourceIndex, 1);
  nextCards.splice(targetIndex, 0, movedCard);
  return nextCards;
}

function formatCardDisplay(card: CardItem) {
  return card.cardLastFour ? `${card.cardLabel} (${card.cardLastFour})` : card.cardLabel;
}

function isNumberlessLabel(label: string) {
  return NUMBERLESS_REGISTERED_CARD_LABELS.has(label as RegisteredCardLabel);
}

function getCardDisplayName(cardLabel: string) {
  switch (cardLabel) {
    case '국민':
      return 'KB국민카드';
    case '삼성':
      return '삼성카드';
    case '농협':
      return 'NH농협카드';
    case '롯데':
      return '롯데카드';
    case '비씨':
      return 'BC카드';
    case '현대':
      return '현대카드';
    case '네이버페이':
      return 'NAVER Pay';
    case '카카오페이':
      return '카카오페이';
    case '토스':
      return '토스';
    case '대전사랑카드':
      return '대전사랑카드';
    case '온누리':
      return '온누리상품권';
    case '지역':
      return '지역카드';
    default:
      return cardLabel;
  }
}

function getCardStyle(cardLabel: string) {
  switch (cardLabel) {
    case '국민':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#ffea8d] to-[#f0bf36] shadow-[0_2px_6px_rgba(120,53,15,0.10),0_18px_34px_-18px_rgba(161,98,7,0.52)] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-amber-900',
        mark: 'text-amber-700/70',
      };
    case '삼성':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#a9d0ef] to-[#5d96cc] shadow-[0_2px_6px_rgba(8,47,73,0.10),0_14px_28px_-16px_rgba(8,47,73,0.34)] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-sky-900',
        mark: 'text-sky-700/70',
      };
    case '농협':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#2d467d] to-[#172848] shadow-[0_2px_6px_rgba(15,23,42,0.16),0_10px_24px_-16px_rgba(15,23,42,0.48)] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/70',
      };
    case '롯데':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#f1f1f3] to-[#d4d4d9] shadow-[0_2px_6px_rgba(100,116,139,0.10),0_14px_28px_-16px_rgba(100,116,139,0.34)] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-700',
        mark: 'text-sky-600/65',
      };
    case '비씨':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#f7cad1] to-[#e78f9a] shadow-[0_2px_6px_rgba(190,24,93,0.10),0_16px_30px_-18px_rgba(190,24,93,0.28)] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-rose-700',
        mark: 'text-rose-500/70',
      };
    case '현대':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#444444] to-[#1c1c1c] shadow-[0_2px_6px_rgba(0,0,0,0.18),0_12px_26px_-16px_rgba(0,0,0,0.46)] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/65',
      };
    case '네이버페이':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#1bd953] to-[#07b93a] shadow-[0_2px_6px_rgba(22,163,74,0.10),0_10px_24px_-16px_rgba(22,163,74,0.38)] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/90',
        mark: 'text-white/70',
      };
    case '카카오페이':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#ffea61] to-[#ffd418] shadow-[0_2px_6px_rgba(161,98,7,0.10),0_10px_24px_-16px_rgba(161,98,7,0.3)] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-800',
        mark: 'text-slate-800/70',
      };
    case '토스':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#3775ff] to-[#1f52df] shadow-[0_2px_6px_rgba(29,78,216,0.12),0_10px_24px_-16px_rgba(29,78,216,0.46)] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/70',
      };
    case '대전사랑카드':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#fffdfd] to-[#efe6e6] shadow-[0_2px_6px_rgba(127,29,29,0.08),0_14px_28px_-16px_rgba(127,29,29,0.26)] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-800',
        mark: 'text-red-500/70',
      };
    default:
      return {
        container:
          'border border-slate-200 bg-gradient-to-br from-[#ffffff] to-[#f5f7fa] shadow-[0_2px_6px_rgba(15,23,42,0.08),0_10px_24px_-18px_rgba(15,23,42,0.35)] hover:border-violet-200',
        title: 'text-slate-900',
        number: 'text-slate-600',
        mark: 'text-slate-300',
      };
  }
}

export default function CardSettings({ householdId, ownerName }: CardSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<RegisteredCardLabel>('삼성');
  const [cardLastFour, setCardLastFour] = useState('');
  const [cards, setCards] = useState<CardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [detailCardLastFour, setDetailCardLastFour] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const cardsRef = useRef<CardItem[]>([]);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStateRef = useRef<{ cardId: string; active: boolean } | null>(null);
  const dragUnsubscribeRef = useRef<(() => void) | null>(null);
  const lastDragEndRef = useRef(0);

  useEffect(() => {
    setIsLoading(true);

    return subscribeToRegisteredCards(householdId, ownerName, (nextCards) => {
      setCards(
        nextCards.map((card) => ({
          id: card.id,
          cardLabel: card.cardLabel,
          cardLastFour: card.cardLastFour,
          orderIndex: card.orderIndex,
        }))
      );
      setIsLoading(false);
    });
  }, [householdId, ownerName]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    if (!householdId || !ownerName || cards.length === 0) {
      return;
    }

    if (!cards.some((card) => typeof card.orderIndex !== 'number')) {
      return;
    }

    void updateRegisteredCardOrder(cards.map((card) => card.id));
  }, [cards, householdId, ownerName]);

  const hidesCardNumber = useMemo(
    () => NUMBERLESS_REGISTERED_CARD_LABELS.has(selectedLabel),
    [selectedLabel]
  );
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
  const pendingDeleteCard = cards.find((card) => card.id === pendingDeleteId) ?? null;
  const detailHidesCardNumber = selectedCard ? isNumberlessLabel(selectedCard.cardLabel) : false;
  const canSave = hidesCardNumber || cardLastFour.length === 4 || cardLastFour.length === 0;
  const canSaveDetail =
    detailHidesCardNumber || detailCardLastFour.length === 4 || detailCardLastFour.length === 0;

  useEffect(() => {
    if (hidesCardNumber) {
      setCardLastFour('');
    }
  }, [hidesCardNumber]);

  useEffect(() => {
    setFormError('');
  }, [selectedLabel, cardLastFour]);

  useEffect(() => {
    if (!selectedCard) {
      setDetailCardLastFour('');
      setDetailError('');
      return;
    }

    setDetailCardLastFour(selectedCard.cardLastFour);
    setDetailError('');
  }, [selectedCard]);

  useEffect(() => {
    if (detailHidesCardNumber) {
      setDetailCardLastFour('');
    }
  }, [detailHidesCardNumber]);

  useEffect(() => {
    setDetailError('');
  }, [detailCardLastFour]);

  const handleSave = async () => {
    if (!householdId || !ownerName) {
      return;
    }

    const documentId = await addRegisteredCard({
      householdId,
      owner: ownerName,
      cardLabel: selectedLabel,
      cardLastFour: hidesCardNumber ? '' : cardLastFour,
    });

    if (!documentId) {
      setFormError('이미 등록된 카드입니다.');
      return;
    }

    setCardLastFour('');
    setSelectedLabel('삼성');
    setFormError('');
    setIsAdding(false);
  };

  const handleSaveDetail = async () => {
    if (!householdId || !ownerName || !selectedCard) {
      return;
    }

    const updated = await updateRegisteredCard({
      cardId: selectedCard.id,
      householdId,
      owner: ownerName,
      cardLabel: selectedCard.cardLabel,
      cardLastFour: detailHidesCardNumber ? '' : detailCardLastFour,
    });

    if (!updated) {
      setDetailError('이미 등록된 카드입니다.');
      return;
    }

    setSelectedCardId(null);
    setDetailError('');
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) {
      return;
    }

    await deleteRegisteredCard(pendingDeleteId);

    if (selectedCardId === pendingDeleteId) {
      setSelectedCardId(null);
    }

    setPendingDeleteId(null);
  };

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const cleanupDragListeners = () => {
    dragUnsubscribeRef.current?.();
    dragUnsubscribeRef.current = null;
  };

  const finishDrag = async () => {
    clearPressTimer();
    cleanupDragListeners();

    if (!dragStateRef.current?.active) {
      dragStateRef.current = null;
      return;
    }

    dragStateRef.current = null;
    setDraggingCardId(null);
    lastDragEndRef.current = Date.now();

    if (householdId && ownerName) {
      await updateRegisteredCardOrder(cardsRef.current.map((card) => card.id));
    }
  };

  const handleCardPointerDown = (cardId: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    dragStateRef.current = { cardId, active: false };

    clearPressTimer();
    cleanupDragListeners();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const movedDistance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!dragState.active && movedDistance > 8) {
        clearPressTimer();
      }

      if (!dragState.active) {
        return;
      }

      moveEvent.preventDefault();
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const targetCard = target?.closest('[data-card-id]') as HTMLElement | null;
      const targetId = targetCard?.dataset.cardId;

      if (!targetId || targetId === dragState.cardId) {
        return;
      }

      setCards((prev) => moveCard(prev, dragState.cardId, targetId));
    };

    const handlePointerUp = () => {
      void finishDrag();
    };

    dragUnsubscribeRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    pressTimerRef.current = setTimeout(() => {
      if (!dragStateRef.current || dragStateRef.current.cardId !== cardId) {
        return;
      }

      dragStateRef.current.active = true;
      setDraggingCardId(cardId);
    }, 240);
  };

  useEffect(() => {
    return () => {
      clearPressTimer();
      cleanupDragListeners();
    };
  }, []);

  useEffect(() => {
    if (!draggingCardId) {
      return;
    }

    const preventScroll = (event: TouchEvent) => {
      event.preventDefault();
    };

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.removeEventListener('touchmove', preventScroll);
    };
  }, [draggingCardId]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between p-4 transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
            <svg className="h-5 w-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m3 0h2m6-8H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2z"
              />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">등록 카드</div>
            <div className="text-sm text-slate-500">
              {ownerName ? `${ownerName}님 카드 ${cards.length}개` : '구성원을 먼저 선택해주세요'}
            </div>
          </div>
        </div>
        <svg
          className={`h-5 w-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-slate-100">
          {!ownerName ? (
            <div className="p-4 text-sm text-slate-500">
              카드를 등록하려면 먼저 사용할 구성원을 선택해주세요.
            </div>
          ) : (
            <>
              {isAdding && (
                <div className="border-b border-slate-200 bg-slate-50 p-4">
                  <div className="space-y-4">
                    <div className="font-medium text-slate-800">카드 등록</div>

                    <div>
                      <label className="mb-2 block text-sm text-slate-600">카드 종류</label>
                      <div className="grid grid-cols-3 gap-2">
                        {REGISTERED_CARD_LABELS.map((label) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setSelectedLabel(label)}
                            className={`rounded-lg border-2 px-3 py-2 text-sm transition-colors ${
                              selectedLabel === label
                                ? 'border-violet-500 bg-violet-50 text-violet-700'
                                : 'border-slate-200 text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {!hidesCardNumber ? (
                      <div>
                        <label className="mb-1 block text-sm text-slate-600">
                          카드번호 끝 4자리 <span className="text-slate-400">(선택)</span>
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          value={cardLastFour}
                          onChange={(event) =>
                            setCardLastFour(event.target.value.replace(/\D/g, '').slice(0, 4))
                          }
                          placeholder="예: 1234"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                        <p className="mt-1 text-xs text-slate-500">
                          비워두면 {selectedLabel} 결제는 번호와 상관없이 전부 인식합니다.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-700">
                        {selectedLabel}는 카드번호 없이 등록되고, 해당 종류 결제를 전부 인식합니다.
                      </div>
                    )}

                    {formError && <p className="text-sm text-red-500">{formError}</p>}

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setIsAdding(false);
                          setCardLastFour('');
                          setSelectedLabel('삼성');
                          setFormError('');
                        }}
                        className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-100"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => {
                          void handleSave();
                        }}
                        disabled={!canSave}
                        className="flex-1 rounded-lg bg-violet-500 px-4 py-2 text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="p-6 text-center text-sm text-slate-400">불러오는 중입니다.</div>
              ) : cards.length === 0 && !isAdding ? (
                <div className="p-6 text-center text-sm text-slate-400">
                  등록된 카드가 없습니다.
                </div>
              ) : (
                <div className={`grid grid-cols-3 gap-2 p-4 ${draggingCardId ? 'touch-none' : ''}`}>
                  {cards.map((card) => (
                    <RegisteredCardTile
                      key={card.id}
                      card={card}
                      isDragging={draggingCardId === card.id}
                      onPointerDown={handleCardPointerDown(card.id)}
                      onClick={() => {
                        if (Date.now() - lastDragEndRef.current < 250) {
                          return;
                        }

                        setSelectedCardId(card.id);
                      }}
                    />
                  ))}
                </div>
              )}

              {!isAdding && ownerName && (
                <button
                  onClick={() => setIsAdding(true)}
                  className="flex w-full items-center justify-center gap-2 border-t border-slate-200 p-4 font-medium text-violet-600 transition-colors hover:bg-violet-50"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  카드 등록
                </button>
              )}
            </>
          )}
        </div>
      )}

      {selectedCard && (
        <ModalOverlay onClose={() => setSelectedCardId(null)}>
          <div
            className="my-auto w-full max-w-md rounded-3xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">등록 카드 수정</h3>
                <p className="mt-1 text-sm text-slate-500">{formatCardDisplay(selectedCard)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCardId(null)}
                className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="mb-1 block text-sm text-slate-600">카드 종류</label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-800">
                  {selectedCard.cardLabel}
                </div>
              </div>

              {!detailHidesCardNumber ? (
                <div>
                  <label className="mb-1 block text-sm text-slate-600">
                    카드번호 끝 4자리 <span className="text-slate-400">(선택)</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={detailCardLastFour}
                    onChange={(event) =>
                      setDetailCardLastFour(event.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                    placeholder="예: 1234"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    비워두면 {selectedCard.cardLabel} 결제는 번호와 상관없이 전부 인식합니다.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-700">
                  {selectedCard.cardLabel}는 카드번호 없이 등록되고, 해당 종류 결제를 전부 인식합니다.
                </div>
              )}

              {detailError && <p className="text-sm text-red-500">{detailError}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(selectedCard.id)}
                  className="flex-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-600 transition-colors hover:bg-red-100"
                >
                  삭제
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSaveDetail();
                  }}
                  disabled={!canSaveDetail}
                  className="flex-1 rounded-2xl bg-violet-500 px-4 py-3 font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      <ConfirmDialog
        isOpen={!!pendingDeleteCard}
        title="등록 카드 삭제"
        message={pendingDeleteCard ? `${formatCardDisplay(pendingDeleteCard)} 카드를 삭제하시겠습니까?` : ''}
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}

function RegisteredCardTile({
  card,
  isDragging = false,
  onPointerDown,
  onClick,
}: {
  card: CardItem;
  isDragging?: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onClick: () => void;
}) {
  const style = getCardStyle(card.cardLabel);
  const isNaverPay = card.cardLabel === '네이버페이';
  const isKakaoPay = card.cardLabel === '카카오페이';
  const isToss = card.cardLabel === '토스';
  const isDaejeonLoveCard = card.cardLabel === '대전사랑카드';
  const isLogoOnlyCard = isNaverPay || isKakaoPay || isToss;

  return (
    <button
      type="button"
      data-card-id={card.id}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`group relative block w-full min-w-0 overflow-hidden rounded-[13px] p-1.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${style.container} ${
        isDragging ? 'z-10 scale-[1.03] ring-2 ring-violet-300 shadow-lg' : ''
      }`}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[13px] border border-black/[0.08]" />
      {isDaejeonLoveCard && (
        <div className="pointer-events-none absolute -bottom-[2px] left-[-2px] right-[-2px] h-[24%] rounded-b-[12px] bg-[#c91f27]" />
      )}
      {!isLogoOnlyCard && (
        <div className="pointer-events-none absolute left-2 top-[57%] -translate-y-1/2 opacity-95">
        <div className="relative h-[16px] w-[21px] rounded-[4px] border border-[#b7852b]/35 bg-gradient-to-br from-[#ebcc82] via-[#d9b066] to-[#bc8d3a] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="absolute left-[32%] top-[2px] bottom-[2px] w-px bg-black/10" />
          <div className="absolute left-1/2 top-[1px] bottom-[1px] w-px -translate-x-1/2 bg-black/12" />
          <div className="absolute right-[32%] top-[2px] bottom-[2px] w-px bg-black/10" />
          <div className="absolute inset-x-[4px] top-[5px] h-px bg-black/10" />
          <div className="absolute inset-x-[4px] bottom-[5px] h-px bg-black/10" />
        </div>
        </div>
      )}
      <div className="relative aspect-[1.586/1]">
        {!isLogoOnlyCard && (
          <div className="absolute left-1 top-0.5">
            <p className={`text-[10px] font-semibold tracking-tight ${style.title}`}>
              {getCardDisplayName(card.cardLabel)}
            </p>
          </div>
        )}

        {isNaverPay && (
          <div className="absolute left-1/2 top-[50%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 text-white">
            <div className="flex h-[18px] w-[18px] items-center justify-center bg-white text-[14px] font-black text-[#06c755] shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              N
            </div>
            <span className="text-[16px] font-semibold tracking-[-0.04em] leading-none">Pay</span>
          </div>
        )}

        {isKakaoPay && (
          <div className="absolute left-1/2 top-[50%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 text-slate-900">
            <div className="relative h-[15px] w-[19px] rounded-[999px] bg-current">
              <div
                className="absolute left-[3px] top-[11px] h-[6px] w-[6px] bg-current"
                style={{ clipPath: 'polygon(0 0, 100% 12%, 30% 100%)' }}
              />
            </div>
            <span className="text-[18px] font-black tracking-[-0.06em] leading-none">pay</span>
          </div>
        )}

        {isToss && (
          <>
            <div className="absolute left-1/2 top-[50%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 text-white">
              <div className="relative h-[18px] w-[18px]">
                <div className="absolute right-0 top-[2px] h-[14px] w-[14px] rounded-full bg-white" />
                <div
                  className="absolute left-[1px] top-[6px] h-[9px] w-[8px] -rotate-[18deg] bg-white"
                  style={{ clipPath: 'polygon(18% 8%, 100% 0, 84% 72%, 38% 100%, 0 72%)' }}
                />
              </div>
              <span className="text-[16px] font-bold tracking-[-0.05em] leading-none">toss</span>
            </div>
          </>
        )}

        {card.cardLastFour ? (
          <div className={isDaejeonLoveCard ? 'absolute bottom-[12px] right-1.5' : 'absolute bottom-1 right-1.5'}>
            <p className={`text-[11px] font-semibold tracking-[0.14em] ${style.number}`}>{card.cardLastFour}</p>
          </div>
        ) : null}
      </div>
    </button>
  );
}
