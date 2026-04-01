'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import {
  addRegisteredCard,
  subscribeToRegisteredCards,
  updateRegisteredCardActive,
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
  isActive: boolean;
}

const CARD_IMAGE_MAP: Partial<Record<RegisteredCardLabel, string>> = {
  삼성: '/card-logos/samsung.jpg',
  국민: '/card-logos/kb.jpg',
  농협: '/card-logos/nh.jpg',
  네이버페이: '/card-logos/naverpay.jpg',
  토스: '/card-logos/toss.jpg',
  대전사랑카드: '/card-logos/daejeon-love-card.jpg',
};

const CARD_IMAGE_CLASS_MAP: Partial<Record<RegisteredCardLabel, string>> = {
  네이버페이: 'object-contain p-1 bg-white',
  토스: 'object-contain p-1 bg-white',
};

const CARD_STYLE_MAP: Partial<Record<RegisteredCardLabel, string>> = {
  삼성: 'bg-gradient-to-br from-slate-800 to-slate-600',
  국민: 'bg-[#f6c240]',
  농협: 'bg-gradient-to-br from-emerald-500 to-green-600',
  롯데: 'bg-gradient-to-br from-rose-500 to-red-600',
  비씨: 'bg-gradient-to-br from-indigo-500 to-blue-600',
  네이버페이: 'bg-gradient-to-br from-emerald-500 to-green-600',
  카카오페이: 'bg-[#fde047]',
  토스: 'bg-gradient-to-br from-sky-500 to-blue-600',
  대전사랑카드: 'bg-gradient-to-br from-red-500 to-rose-600',
  온누리: 'bg-gradient-to-br from-orange-400 to-amber-500',
  지역: 'bg-gradient-to-br from-teal-400 to-cyan-500',
};

function getCardImage(cardLabel: string) {
  return CARD_IMAGE_MAP[cardLabel as RegisteredCardLabel] || null;
}

function getCardBackground(cardLabel: string) {
  return CARD_STYLE_MAP[cardLabel as RegisteredCardLabel] || 'bg-gradient-to-br from-slate-700 to-slate-500';
}

function getCardImageClassName(cardLabel: string) {
  return CARD_IMAGE_CLASS_MAP[cardLabel as RegisteredCardLabel] || 'object-cover';
}

function formatCardDisplay(card: CardItem) {
  return card.cardLastFour ? `${card.cardLabel} (${card.cardLastFour})` : card.cardLabel;
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-violet-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function CardSettings({ householdId, ownerName }: CardSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<RegisteredCardLabel>('삼성');
  const [cardLastFour, setCardLastFour] = useState('');
  const [cards, setCards] = useState<CardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingCardId, setUpdatingCardId] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);

    return subscribeToRegisteredCards(householdId, ownerName, (nextCards) => {
      setCards(
        nextCards.map((card) => ({
          id: card.id,
          cardLabel: card.cardLabel,
          cardLastFour: card.cardLastFour,
          isActive: card.isActive,
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

  const handleToggle = async (cardId: string, nextValue: boolean) => {
    setUpdatingCardId(cardId);
    try {
      await updateRegisteredCardActive(cardId, nextValue);
    } finally {
      setUpdatingCardId(null);
    }
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
                <div className="space-y-2.5 p-4">
                  {cards.map((card) => (
                    <div
                      key={card.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${
                        card.isActive
                          ? 'border-slate-200 bg-white'
                          : 'border-slate-200 bg-slate-50 opacity-80'
                      }`}
                    >
                      <div
                        className={`relative flex h-9 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/40 ${getCardBackground(card.cardLabel)}`}
                      >
                        {getCardImage(card.cardLabel) ? (
                          <Image
                            src={getCardImage(card.cardLabel) as string}
                            alt={`${card.cardLabel} 카드`}
                            fill
                            className={getCardImageClassName(card.cardLabel)}
                            sizes="56px"
                          />
                        ) : (
                          <span className="px-1 text-[10px] font-semibold text-white">
                            {card.cardLabel}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {formatCardDisplay(card)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {card.isActive ? '활성' : '비활성'}
                        </span>
                        <Toggle
                          checked={card.isActive}
                          onChange={(nextValue) => {
                            void handleToggle(card.id, nextValue);
                          }}
                        />
                        {updatingCardId === card.id && (
                          <div className="h-3 w-3 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
                        )}
                      </div>
                    </div>
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
    </div>
  );
}
