import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import FormattedIntegerInput, {
  caretPositionAfterDigits,
  formatIntegerDigits,
} from '@/components/common/FormattedIntegerInput';

function Subject() {
  const [value, setValue] = useState('700000000');
  return (
    <FormattedIntegerInput
      aria-label="현재 잔액"
      value={value}
      onValueChange={setValue}
    />
  );
}

describe('FormattedIntegerInput', () => {
  test('선행 0을 축약하지 않고 천 단위 구분자를 적용한다', () => {
    expect(formatIntegerDigits('00000000')).toBe('00,000,000');
    expect(formatIntegerDigits('800000000')).toBe('800,000,000');
  });

  test('논리적 숫자 개수를 화면 커서 위치로 변환한다', () => {
    expect(caretPositionAfterDigits('800,000,000', 0)).toBe(0);
    expect(caretPositionAfterDigits('800,000,000', 1)).toBe(1);
    expect(caretPositionAfterDigits('800,000,000', 4)).toBe(5);
  });

  test('맨 앞 숫자를 지우고 입력해도 커서가 끝으로 이동하지 않는다', async () => {
    const user = userEvent.setup();
    render(<Subject />);
    const input = screen.getByRole('textbox', { name: '현재 잔액' });

    input.focus();
    input.setSelectionRange(1, 1);
    await act(async () => {
      await user.keyboard('{Backspace}8');
    });

    expect(input).toHaveValue('800,000,000');
    expect(input.selectionStart).toBe(1);
  });
});
