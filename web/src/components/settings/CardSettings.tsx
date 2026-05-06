'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, ModalOverlay } from '@/components/common';
import { ChevronDown, CreditCard, Plus, X } from 'lucide-react';
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

type CardTab = 'credit' | 'local' | 'simple';

const CARD_TAB_ITEMS: Array<{ key: CardTab; label: string }> = [
  { key: 'credit', label: '신용/체크카드' },
  { key: 'local', label: '지역화폐' },
  { key: 'simple', label: '간편결제' },
];

function getCardLabelTitle(tab: CardTab): string {
  switch (tab) {
    case 'local':
      return '지역화폐 종류';
    case 'simple':
      return '간편결제 종류';
    default:
      return '카드 종류';
  }
}

function getCardNumberHint(tab: CardTab): string {
  switch (tab) {
    case 'simple':
      return '';
    default:
      return '입력하지 않으면 해당 카드의 모든 결제를 가계부에 등록합니다.';
  }
}

function getCardCategory(cardLabel: string): CardTab {
  if (['네이버페이', '카카오페이', '토스'].includes(cardLabel)) {
    return 'simple';
  }

  if (['대전사랑카드', '온누리상품권', '경기지역화폐', '여민전'].includes(cardLabel)) {
    return 'local';
  }

  return 'credit';
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
    case '우리':
      return '우리카드';
    case '신한':
      return '신한카드';
    case '하나':
      return '하나카드';
    case '네이버페이':
      return 'NAVER Pay';
    case '카카오페이':
      return '카카오페이';
    case '토스':
      return '토스';
    case '대전사랑카드':
      return '대전사랑카드';
    case '온누리상품권':
      return '온누리상품권';
    case '경기지역화폐':
      return '경기지역화폐';
    case '여민전':
      return '여민전';
    default:
      return cardLabel;
  }
}

function getCardStyle(cardLabel: string) {
  switch (cardLabel) {
    case '국민':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#fff4b6] to-[#f6ce4d] shadow-[0_3px_8px_rgba(120,53,15,0.10),0_22px_40px_-18px_rgba(161,98,7,0.50),0_1px_0_rgba(255,255,255,0.30)_inset,0_14px_20px_-14px_rgba(255,255,255,0.14)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-900',
        mark: 'text-amber-700/70',
      };
    case '삼성':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#bfe8ff] to-[#5fb8e8] shadow-[0_3px_8px_rgba(8,47,73,0.10),0_18px_34px_-16px_rgba(8,47,73,0.34),0_1px_0_rgba(255,255,255,0.30)_inset,0_14px_20px_-14px_rgba(255,255,255,0.14)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-900',
        mark: 'text-cyan-700/70',
      };
    case '농협':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#37528c] to-[#1d3058] shadow-[0_3px_8px_rgba(15,23,42,0.14),0_16px_30px_-16px_rgba(15,23,42,0.46),0_1px_0_rgba(255,255,255,0.22)_inset,0_14px_20px_-14px_rgba(255,255,255,0.10)_inset] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/70',
      };
    case '롯데':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#f6f6f8] to-[#dfdfe4] shadow-[0_3px_8px_rgba(100,116,139,0.10),0_18px_34px_-16px_rgba(100,116,139,0.34),0_1px_0_rgba(255,255,255,0.30)_inset,0_14px_20px_-14px_rgba(255,255,255,0.14)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-900',
        mark: 'text-sky-600/65',
      };
    case '비씨':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#fad7dd] to-[#efacb3] shadow-[0_3px_8px_rgba(190,24,93,0.10),0_20px_34px_-18px_rgba(190,24,93,0.30),0_1px_0_rgba(255,255,255,0.28)_inset,0_14px_20px_-14px_rgba(255,255,255,0.12)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-900',
        mark: 'text-rose-500/70',
      };
    case '현대':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#515151] to-[#272727] shadow-[0_3px_8px_rgba(0,0,0,0.16),0_16px_30px_-16px_rgba(0,0,0,0.46),0_1px_0_rgba(255,255,255,0.20)_inset,0_14px_20px_-14px_rgba(255,255,255,0.08)_inset] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/65',
      };
    case '우리':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#e3fff5] to-[#69e0bb] shadow-[0_3px_8px_rgba(5,150,105,0.10),0_18px_34px_-16px_rgba(5,150,105,0.34),0_1px_0_rgba(255,255,255,0.30)_inset,0_14px_20px_-14px_rgba(255,255,255,0.14)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-900',
        mark: 'text-emerald-700/70',
      };
    case '신한':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#8fb4ff] to-[#2f5fc8] shadow-[0_3px_8px_rgba(37,99,235,0.10),0_18px_34px_-16px_rgba(37,99,235,0.34),0_1px_0_rgba(255,255,255,0.26)_inset,0_14px_20px_-14px_rgba(255,255,255,0.12)_inset] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/70',
      };
    case '하나':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#86d8c9] to-[#0d8e73] shadow-[0_3px_8px_rgba(13,148,136,0.12),0_18px_34px_-16px_rgba(13,148,136,0.40),0_1px_0_rgba(255,255,255,0.22)_inset,0_14px_20px_-14px_rgba(255,255,255,0.10)_inset] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/70',
      };
    case '네이버페이':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#29df60] to-[#10c747] shadow-[0_3px_8px_rgba(22,163,74,0.10),0_16px_30px_-16px_rgba(22,163,74,0.38),0_1px_0_rgba(255,255,255,0.28)_inset,0_14px_20px_-14px_rgba(255,255,255,0.12)_inset] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/90',
        mark: 'text-white/70',
      };
    case '카카오페이':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#ffef7d] to-[#ffde34] shadow-[0_3px_8px_rgba(161,98,7,0.10),0_16px_30px_-16px_rgba(161,98,7,0.32),0_1px_0_rgba(255,255,255,0.30)_inset,0_14px_20px_-14px_rgba(255,255,255,0.14)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-800',
        mark: 'text-slate-800/70',
      };
    case '토스':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#4f89ff] to-[#2d61ea] shadow-[0_3px_8px_rgba(29,78,216,0.12),0_16px_30px_-16px_rgba(29,78,216,0.44),0_1px_0_rgba(255,255,255,0.24)_inset,0_14px_20px_-14px_rgba(255,255,255,0.10)_inset] hover:border-transparent',
        title: 'text-white',
        number: 'text-white/95',
        mark: 'text-white/70',
      };
    case '대전사랑카드':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#ffffff] to-[#f2ebeb] shadow-[0_3px_8px_rgba(127,29,29,0.08),0_18px_32px_-16px_rgba(127,29,29,0.28),0_1px_0_rgba(255,255,255,0.28)_inset,0_14px_20px_-14px_rgba(255,255,255,0.12)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-800',
        mark: 'text-red-500/70',
      };
    case '온누리상품권':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#fffaf2] to-[#f6ecde] shadow-[0_3px_8px_rgba(194,65,12,0.08),0_18px_32px_-16px_rgba(194,65,12,0.28),0_1px_0_rgba(255,255,255,0.24)_inset,0_14px_20px_-14px_rgba(255,255,255,0.10)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-800',
        mark: 'text-orange-500/70',
      };
    case '경기지역화폐':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#fbfdff] to-[#edf3ff] shadow-[0_3px_8px_rgba(37,99,235,0.08),0_18px_32px_-16px_rgba(37,99,235,0.24),0_1px_0_rgba(255,255,255,0.24)_inset,0_14px_20px_-14px_rgba(255,255,255,0.10)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-800',
        mark: 'text-blue-500/70',
      };
    case '여민전':
      return {
        container:
          'border border-transparent bg-gradient-to-br from-[#ffffff] via-[#f7fbff] to-[#e9f5ff] shadow-[0_3px_8px_rgba(14,116,144,0.08),0_18px_32px_-16px_rgba(14,116,144,0.24),0_1px_0_rgba(255,255,255,0.30)_inset,0_14px_20px_-14px_rgba(255,255,255,0.12)_inset] hover:border-transparent',
        title: 'text-slate-900',
        number: 'text-slate-700',
        mark: 'text-sky-600/70',
      };
    default:
      return {
        container:
          'border border-slate-200 bg-gradient-to-br from-[#ffffff] to-[#f7f9fb] shadow-[0_3px_8px_rgba(15,23,42,0.08),0_16px_30px_-18px_rgba(15,23,42,0.34),0_1px_0_rgba(255,255,255,0.28)_inset,0_14px_20px_-14px_rgba(255,255,255,0.12)_inset] hover:border-violet-200',
        title: 'text-slate-900',
        number: 'text-slate-600',
        mark: 'text-slate-300',
      };
  }
}

export default function CardSettings({ householdId, ownerName }: CardSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<CardTab>('credit');
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
  const filteredCards = useMemo(
    () => cards.filter((card) => getCardCategory(card.cardLabel) === selectedTab),
    [cards, selectedTab]
  );
  const tabLabelOptions = useMemo(
    () => REGISTERED_CARD_LABELS.filter((label) => getCardCategory(label) === selectedTab),
    [selectedTab]
  );
  const canSave = hidesCardNumber || cardLastFour.length === 4 || cardLastFour.length === 0;
  const canSaveDetail =
    detailHidesCardNumber || detailCardLastFour.length === 4 || detailCardLastFour.length === 0;
  const selectedCardTab = selectedCard ? getCardCategory(selectedCard.cardLabel) : selectedTab;

  useEffect(() => {
    if (hidesCardNumber) {
      setCardLastFour('');
    }
  }, [hidesCardNumber]);

  useEffect(() => {
    if (!tabLabelOptions.includes(selectedLabel)) {
      setSelectedLabel(tabLabelOptions[0] ?? '삼성');
    }
  }, [selectedLabel, tabLabelOptions]);

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
    setSelectedLabel(tabLabelOptions[0] ?? '삼성');
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
            <CreditCard className="h-5 w-5 text-violet-600" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">카드 등록</div>
            <div className="text-sm text-slate-500">
              {ownerName ? `${ownerName}님 카드 ${cards.length}개` : '구성원을 먼저 선택해주세요'}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="border-t border-slate-100">
          {!ownerName ? (
            <div className="p-4 text-sm text-slate-500">
              카드를 등록하려면 먼저 사용할 구성원을 선택해주세요.
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
                  {CARD_TAB_ITEMS.map((tab) => {
                    const isActive = selectedTab === tab.key;

                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setSelectedTab(tab.key)}
                        className={`rounded-xl px-2 py-2 text-[13px] font-medium leading-none whitespace-nowrap transition-colors sm:px-3 sm:text-sm ${
                          isActive
                            ? 'bg-white text-violet-700 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isAdding && (
                <div className="border-b border-slate-200 bg-slate-50 p-4">
                  <div className="space-y-4">
                    <div className="font-medium text-slate-800">카드 등록</div>

                    <div>
                      <label className="mb-2 block text-sm text-slate-600">
                        {getCardLabelTitle(selectedTab)}
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {tabLabelOptions.map((label) => (
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
                        {getCardNumberHint(selectedTab) ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {getCardNumberHint(selectedTab)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      getCardNumberHint(selectedTab) ? (
                        <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-700">
                          {getCardNumberHint(selectedTab)}
                        </div>
                      ) : null
                    )}

                    {formError && <p className="text-sm text-red-500">{formError}</p>}

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setIsAdding(false);
                          setCardLastFour('');
                          setSelectedLabel(tabLabelOptions[0] ?? '삼성');
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
              ) : filteredCards.length === 0 && !isAdding ? (
                <div className="p-6 text-center text-sm text-slate-400">
                  {cards.length === 0 ? '등록된 카드가 없습니다.' : '이 분류에 등록된 카드가 없습니다.'}
                </div>
              ) : (
                <div className={`grid grid-cols-3 gap-2 p-4 ${draggingCardId ? 'touch-none' : ''}`}>
                  {filteredCards.map((card) => (
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
                  <Plus className="h-5 w-5" />
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
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="mb-1 block text-sm text-slate-600">
                  {getCardLabelTitle(selectedCardTab)}
                </label>
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
                  {getCardNumberHint(selectedCardTab) ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {getCardNumberHint(selectedCardTab)}
                    </p>
                  ) : null}
                </div>
              ) : (
                getCardNumberHint(selectedCardTab) ? (
                  <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-700">
                    {getCardNumberHint(selectedCardTab)}
                  </div>
                ) : null
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
  const isOnnuri = card.cardLabel === '온누리상품권';
  const isGyeonggiLocalCurrency = card.cardLabel === '경기지역화폐';
  const isYeominjeon = card.cardLabel === '여민전';
  const isLogoOnlyCard = isNaverPay || isKakaoPay || isToss;
  const isLocalAccentCard = isDaejeonLoveCard || isOnnuri || isGyeonggiLocalCurrency;

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
      {isOnnuri && (
        <div className="pointer-events-none absolute -bottom-[2px] left-[-2px] right-[-2px] h-[24%] rounded-b-[12px] bg-[#f58220]" />
      )}
      {isGyeonggiLocalCurrency && (
        <div className="pointer-events-none absolute -bottom-[2px] left-[-2px] right-[-2px] h-[24%] rounded-b-[12px] bg-[#2f76db]" />
      )}
      {isYeominjeon && (
        <>
          <div
            className="pointer-events-none absolute right-[5px] bottom-[13%] text-[34px] leading-none tracking-[-0.04em] text-[#6aa8cf]/20"
            style={{
              fontFamily: '"Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
              fontWeight: 900,
            }}
          >
            세종
          </div>
        </>
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
        {isYeominjeon && (
          <>
            <div className="absolute left-1 top-1">
              <p className="text-[10px] font-semibold tracking-tight text-slate-900">세종지역화폐</p>
            </div>
          </>
        )}

        {!isLogoOnlyCard && !isYeominjeon && (
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
            <div className="relative h-[18px] w-[18px] rounded-full bg-current">
              <div className="absolute -bottom-[3px] left-[3px] h-0 w-0 border-l-[4px] border-r-[2px] border-t-[6px] border-l-transparent border-r-transparent border-t-current" />
            </div>
            <span className="text-[18px] font-black tracking-[-0.06em] leading-none">pay</span>
          </div>
        )}

        {isToss && (
          <div className="absolute left-1/2 top-[50%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 text-white">
            <svg
              className="h-[18px] w-[18px] fill-current"
              viewBox="0 0 28 28"
              aria-hidden="true"
            >
              <path d="M18.3 4.2c4.8 0 8.5 3.4 8.5 7.8 0 4.6-3.8 8.2-8.7 8.2-1.1 0-2.2-.2-3.2-.5L5.1 23.8l2.6-7.2c-1.8-1.2-2.8-2.8-2.8-4.6 0-4.4 3.8-7.8 8.7-7.8h4.7Z" />
            </svg>
              <span className="text-[16px] font-bold tracking-[-0.05em] leading-none">toss</span>
          </div>
        )}

        {card.cardLastFour && !isYeominjeon ? (
          <div
            className={
              isLocalAccentCard ? 'absolute bottom-[12px] right-1.5' : 'absolute bottom-1 right-1.5'
            }
          >
            <p className={`text-[11px] font-semibold tracking-[0.14em] ${style.number}`}>{card.cardLastFour}</p>
          </div>
        ) : null}
      </div>
    </button>
  );
}
