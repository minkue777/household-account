'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog, ModalOverlay } from '@/components/common';
import {
  addRegisteredCard,
  deleteRegisteredCard,
  subscribeToRegisteredCards,
  updateRegisteredCard,
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
  if (cardLabel === '국민') {
    return {
      container:
        'border-2 border-amber-300 bg-gradient-to-br from-[#fffdf8] via-[#fffdf7] to-[#fffaf0] shadow-[0_10px_24px_-16px_rgba(161,98,7,0.5),0_2px_6px_rgba(255,255,255,0.7)_inset] hover:border-amber-400',
      title: 'text-slate-900',
      number: 'text-amber-800',
      mark: 'text-amber-600/70',
    };
  }

  return {
    container:
      'border border-slate-200 bg-gradient-to-br from-[#fdfefe] via-[#fcfdfe] to-[#fafbfd] shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35),0_2px_6px_rgba(255,255,255,0.7)_inset] hover:border-violet-200',
    title: 'text-slate-900',
    number: 'text-slate-600',
    mark: 'text-slate-300',
  };
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
                <div className="grid grid-cols-3 gap-2 p-4">
                  {cards.map((card) => (
                    <RegisteredCardTile
                      key={card.id}
                      card={card}
                      onClick={() => setSelectedCardId(card.id)}
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
  onClick,
}: {
  card: CardItem;
  onClick: () => void;
}) {
  const style = getCardStyle(card.cardLabel);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative block w-full min-w-0 overflow-hidden rounded-[13px] p-1.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${style.container}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.42),transparent_46%)]" />
      <div className="pointer-events-none absolute inset-0 rounded-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(15,23,42,0.04)]" />
      <div className="pointer-events-none absolute left-2 top-[57%] -translate-y-1/2 opacity-95">
        <div className="relative h-[16px] w-[21px] rounded-[4px] border border-[#b7852b]/35 bg-gradient-to-br from-[#ebcc82] via-[#d9b066] to-[#bc8d3a] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          <div className="absolute inset-[1px] rounded-[3px] border border-black/6" />
          <div className="absolute left-[30%] top-[2px] bottom-[2px] w-px bg-black/6" />
          <div className="absolute left-1/2 top-[2px] bottom-[2px] w-px -translate-x-1/2 bg-black/9" />
          <div className="absolute right-[30%] top-[2px] bottom-[2px] w-px bg-black/6" />
          <div className="absolute inset-x-[3px] top-[5px] h-px bg-black/6" />
          <div className="absolute inset-x-[3px] bottom-[5px] h-px bg-black/6" />
        </div>
      </div>
      <div className="relative aspect-[1.586/1]">
        <div className="absolute left-1 top-0.5">
          <p className={`text-[10px] font-semibold tracking-tight ${style.title}`}>
            {getCardDisplayName(card.cardLabel)}
          </p>
        </div>

        <div className="absolute bottom-1 right-1.5">
          {card.cardLastFour ? (
            <p className={`text-[11px] font-semibold tracking-[0.14em] ${style.number}`}>{card.cardLastFour}</p>
          ) : (
            <p className={`text-[11px] font-medium ${style.number}`}>번호 없이 인식</p>
          )}
        </div>
      </div>
    </button>
  );
}
