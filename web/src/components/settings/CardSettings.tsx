'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/common';
import {
  addRegisteredCard,
  deleteRegisteredCard,
  subscribeToRegisteredCards,
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
}

const CARD_IMAGE_MAP: Partial<Record<RegisteredCardLabel, string>> = {
  삼성: '/card-logos/samsung.jpg',
  국민: '/card-logos/kb.jpg',
  네이버페이: '/card-logos/naverpay.jpg',
  농협: '/card-logos/nh.jpg',
  대전사랑카드: '/card-logos/daejeon-love-card.jpg',
  토스: '/card-logos/toss.jpg',
};

const CARD_STYLE_MAP: Partial<
  Record<
    RegisteredCardLabel,
    {
      bgClassName: string;
      textClassName: string;
      badgeClassName: string;
    }
  >
> = {
  삼성: {
    bgClassName: 'bg-gradient-to-br from-slate-800 to-slate-600',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/20 text-white',
  },
  국민: {
    bgClassName: 'bg-[#f6c240]',
    textClassName: 'text-slate-900',
    badgeClassName: 'bg-black/10 text-slate-800',
  },
  농협: {
    bgClassName: 'bg-gradient-to-br from-emerald-500 to-green-600',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
  롯데: {
    bgClassName: 'bg-gradient-to-br from-rose-500 to-red-600',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
  비씨: {
    bgClassName: 'bg-gradient-to-br from-indigo-500 to-blue-600',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
  네이버페이: {
    bgClassName: 'bg-gradient-to-br from-emerald-500 to-green-600',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
  카카오페이: {
    bgClassName: 'bg-[#fde047]',
    textClassName: 'text-slate-900',
    badgeClassName: 'bg-black/10 text-slate-800',
  },
  토스: {
    bgClassName: 'bg-gradient-to-br from-sky-500 to-blue-600',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
  대전사랑카드: {
    bgClassName: 'bg-gradient-to-br from-red-500 to-rose-600',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
  온누리: {
    bgClassName: 'bg-gradient-to-br from-orange-400 to-amber-500',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
  지역: {
    bgClassName: 'bg-gradient-to-br from-teal-400 to-cyan-500',
    textClassName: 'text-white',
    badgeClassName: 'bg-white/15 text-white',
  },
};

function getCardVisualStyle(cardLabel: string) {
  return (
    CARD_STYLE_MAP[cardLabel as RegisteredCardLabel] || {
      bgClassName: 'bg-gradient-to-br from-slate-700 to-slate-500',
      textClassName: 'text-white',
      badgeClassName: 'bg-white/15 text-white',
    }
  );
}

function getCardImage(cardLabel: string) {
  return CARD_IMAGE_MAP[cardLabel as RegisteredCardLabel] || null;
}

function getCardDescription(card: CardItem) {
  return card.cardLastFour
    ? `끝 4자리 ${card.cardLastFour} 결제만 인식`
    : '번호와 상관없이 전체 결제를 인식';
}

function getCardTokenChip(card: CardItem) {
  return card.cardLastFour || '전체 인식';
}

export default function CardSettings({ householdId, ownerName }: CardSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<RegisteredCardLabel>('삼성');
  const [cardLastFour, setCardLastFour] = useState('');
  const [cards, setCards] = useState<CardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);

    return subscribeToRegisteredCards(householdId, ownerName, (nextCards) => {
      setCards(
        nextCards.map((card) => ({
          id: card.id,
          cardLabel: card.cardLabel,
          cardLastFour: card.cardLastFour,
        }))
      );
      setIsLoading(false);
    });
  }, [householdId, ownerName]);

  const hidesCardNumber = useMemo(
    () => NUMBERLESS_REGISTERED_CARD_LABELS.has(selectedLabel),
    [selectedLabel]
  );

  useEffect(() => {
    if (hidesCardNumber) {
      setCardLastFour('');
    }
  }, [hidesCardNumber]);

  const pendingDeleteCard = cards.find((card) => card.id === pendingDeleteId) ?? null;
  const canSave = hidesCardNumber || cardLastFour.length === 4 || cardLastFour.length === 0;

  const handleSave = async () => {
    if (!householdId || !ownerName) {
      return;
    }

    await addRegisteredCard({
      householdId,
      owner: ownerName,
      cardLabel: selectedLabel,
      cardLastFour: hidesCardNumber ? '' : cardLastFour,
    });

    setCardLastFour('');
    setSelectedLabel('삼성');
    setIsAdding(false);
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) {
      return;
    }

    await deleteRegisteredCard(pendingDeleteId);
    setPendingDeleteId(null);
  };

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

                    {!hidesCardNumber && (
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
                    )}

                    {hidesCardNumber && (
                      <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-700">
                        {selectedLabel}는 카드번호 없이 등록되고, 해당 종류 결제를 전부 인식합니다.
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setIsAdding(false);
                          setCardLastFour('');
                          setSelectedLabel('삼성');
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
                <div className="space-y-3 p-4">
                  {cards.map((card) => {
                    const imageSrc = getCardImage(card.cardLabel);
                    const style = getCardVisualStyle(card.cardLabel);

                    return (
                      <div
                        key={card.id}
                        className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                      >
                        <div
                          className={`relative flex h-12 w-[78px] flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/30 shadow-sm ${style.bgClassName}`}
                        >
                          {imageSrc ? (
                            <Image
                              src={imageSrc}
                              alt={`${card.cardLabel} 카드`}
                              fill
                              className="object-cover"
                              sizes="78px"
                            />
                          ) : (
                            <span className={`text-sm font-semibold ${style.textClassName}`}>
                              {card.cardLabel}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-slate-800">{card.cardLabel}</p>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${style.badgeClassName}`}
                            >
                              등록됨
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold tracking-[0.22em] text-white">
                              {getCardTokenChip(card)}
                            </span>
                            <span className="text-sm text-slate-500">{getCardDescription(card)}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => setPendingDeleteId(card.id)}
                          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
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

      <ConfirmDialog
        isOpen={!!pendingDeleteCard}
        title="등록 카드 삭제"
        message={
          pendingDeleteCard
            ? `${pendingDeleteCard.cardLabel} 카드를 삭제하시겠습니까?`
            : ''
        }
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
