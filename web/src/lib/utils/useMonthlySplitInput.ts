import { useCallback, useState } from 'react';
import {
  hasSplitMonthsError,
  parseValidSplitMonths,
  sanitizeSplitMonthsInput,
  splitMonthsMinMessage,
} from '@/lib/utils/splitMonths';

interface GetValidSplitMonthsOptions {
  alertOnError?: boolean;
  alertFn?: (message: string) => void;
}

const DEFAULT_SPLIT_MONTHS_INPUT = '2';

export function useMonthlySplitInput() {
  const [splitMonthsInput, setSplitMonthsInput] = useState(DEFAULT_SPLIT_MONTHS_INPUT);
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [splitMonthsError, setSplitMonthsError] = useState(false);

  const resetMonthlySplitInput = useCallback(() => {
    setSplitMonthsInput(DEFAULT_SPLIT_MONTHS_INPUT);
    setShowSplitInput(false);
    setSplitMonthsError(false);
  }, []);

  const toggleSplitInput = useCallback(() => {
    setShowSplitInput((prev) => {
      if (!prev) {
        setSplitMonthsInput(DEFAULT_SPLIT_MONTHS_INPUT);
      }
      setSplitMonthsError(false);
      return !prev;
    });
  }, []);

  const handleSplitMonthsInputChange = useCallback((rawValue: string) => {
    const value = sanitizeSplitMonthsInput(rawValue);
    setSplitMonthsInput(value);
    setSplitMonthsError(hasSplitMonthsError(value));
  }, []);

  const getValidSplitMonths = useCallback((options?: GetValidSplitMonthsOptions) => {
    const parsedMonths = parseValidSplitMonths(splitMonthsInput);
    if (parsedMonths !== null) {
      return parsedMonths;
    }

    setSplitMonthsError(true);

    if (options?.alertOnError) {
      const showAlert = options.alertFn ?? ((message: string) => alert(message));
      showAlert(splitMonthsMinMessage);
    }

    return null;
  }, [splitMonthsInput]);

  return {
    splitMonthsInput,
    showSplitInput,
    splitMonthsError,
    resetMonthlySplitInput,
    toggleSplitInput,
    handleSplitMonthsInputChange,
    getValidSplitMonths,
  };
}
