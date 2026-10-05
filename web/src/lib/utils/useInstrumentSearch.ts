import { useCallback, useEffect, useRef, useState } from 'react';

interface Selection<T, Q> { instrument: T; quote: Q | null; loading: boolean }

/** 검색 입력과 선택한 종목의 시세는 같은 편집 수명에 속합니다. */
export function useInstrumentSearch<T extends { name: string }, Q>({ enabled, scopeKey, search, fetchQuote }: {
  enabled: boolean;
  scopeKey: string;
  search: (query: string) => Promise<T[]>;
  fetchQuote: (instrument: T) => Promise<Q>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<Selection<T, Q> | null>(null);
  const current = useRef<Selection<T, Q> | null>(null);
  const assign = useCallback((value: Selection<T, Q> | null) => {
    current.current = value;
    setSelection(value);
  }, []);
  const reset = useCallback(() => {
    assign(null);
    setQuery('');
    setResults([]);
    setSearching(false);
  }, [assign]);

  useEffect(() => {
    reset();
    return () => { current.current = null; };
  }, [enabled, scopeKey, reset]);

  useEffect(() => {
    if (!enabled || !query || selection) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void search(query).then(value => {
      if (!cancelled) setResults(value);
    }).catch(error => {
      if (!cancelled) setResults([]);
      console.error('종목 검색 오류:', error);
    }).finally(() => {
      if (!cancelled) setSearching(false);
    });
    return () => { cancelled = true; };
  }, [enabled, query, selection, search]);

  const select = useCallback(async (instrument: T) => {
    const request: Selection<T, Q> = { instrument, quote: null, loading: true };
    assign(request);
    setQuery(instrument.name);
    setResults([]);
    try {
      const quote = await fetchQuote(instrument);
      if (current.current === request) assign({ instrument, quote, loading: false });
    } catch (error) {
      if (current.current === request) assign({ instrument, quote: null, loading: false });
      console.error('시세 조회 오류:', error);
    }
  }, [assign, fetchQuote]);

  const changeQuery = useCallback((value: string) => {
    assign(null);
    setQuery(value);
  }, [assign]);
  const restore = useCallback((instrument: T, quote: Q | null) => {
    assign({ instrument, quote, loading: false });
    setQuery(instrument.name);
  }, [assign]);

  return { query, setQuery: changeQuery, results, searching, select, reset, restore,
    selected: enabled ? selection?.instrument ?? null : null,
    quote: enabled ? selection?.quote ?? null : null,
    loadingQuote: enabled && (selection?.loading ?? false) };
}
