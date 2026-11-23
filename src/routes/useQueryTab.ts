import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Synchronizes a page tab or view selection with a URL search query parameter
 * so browser Back/Forward, bookmarks, and page reloads preserve the active tab.
 */
export function useQueryTab<T extends string>(
  paramName: string,
  defaultValue: T,
  validValues: readonly T[]
): [T, (nextValue: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(paramName);
  const currentValue: T =
    raw && (validValues as readonly string[]).includes(raw) ? (raw as T) : defaultValue;

  const setTab = useCallback(
    (nextValue: T) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextValue === defaultValue) {
            next.delete(paramName);
          } else {
            next.set(paramName, nextValue);
          }
          return next;
        },
        { replace: false }
      );
    },
    [defaultValue, paramName, setSearchParams]
  );

  return [currentValue, setTab];
}
