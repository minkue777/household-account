'use client';

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react';

export function formatIntegerDigits(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function caretPositionAfterDigits(
  formattedValue: string,
  digitOffset: number
): number {
  if (digitOffset <= 0) return 0;

  let encounteredDigits = 0;
  for (let index = 0; index < formattedValue.length; index += 1) {
    if (/[0-9]/.test(formattedValue[index])) {
      encounteredDigits += 1;
      if (encounteredDigits === digitOffset) return index + 1;
    }
  }

  return formattedValue.length;
}

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'value' | 'onChange'
>;

interface FormattedIntegerInputProps extends NativeInputProps {
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * 천 단위 구분자를 표시하면서도 편집 중인 논리적 숫자 위치를 유지합니다.
 */
export default function FormattedIntegerInput({
  value,
  onValueChange,
  className,
  ...inputProps
}: FormattedIntegerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingDigitOffsetRef = useRef<number | null>(null);
  const formattedValue = formatIntegerDigits(value);

  useEffect(() => {
    const input = inputRef.current;
    const digitOffset = pendingDigitOffsetRef.current;
    if (
      input === null
      || digitOffset === null
      || document.activeElement !== input
    ) {
      return;
    }

    const nextCaret = caretPositionAfterDigits(formattedValue, digitOffset);
    input.setSelectionRange(nextCaret, nextCaret);
    pendingDigitOffsetRef.current = null;
  }, [formattedValue]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const displayedValue = event.currentTarget.value;
    const selectionStart = event.currentTarget.selectionStart ?? displayedValue.length;
    const digitOffset = displayedValue
      .slice(0, selectionStart)
      .replace(/[^0-9]/g, '').length;
    const nextValue = displayedValue.replace(/[^0-9]/g, '');
    const nextFormattedValue = formatIntegerDigits(nextValue);
    pendingDigitOffsetRef.current = digitOffset;
    onValueChange(nextValue);

    // React의 controlled value 반영 직후, 다음 화면을 그리기 전에 우선 복원합니다.
    queueMicrotask(() => {
      const input = inputRef.current;
      if (
        input === null
        || document.activeElement !== input
        || input.value !== nextFormattedValue
      ) {
        return;
      }
      const nextCaret = caretPositionAfterDigits(nextFormattedValue, digitOffset);
      input.setSelectionRange(nextCaret, nextCaret);
      pendingDigitOffsetRef.current = null;
    });
  };

  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={formattedValue}
      onChange={handleChange}
      className={className}
    />
  );
}
