import { useDataStore } from '@state/dataStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import type { FilterState } from '@/state/sessionStore';

export const FuzzyBanner = () => {
  const fuzzyUsed = useDataStore((state) => state.fuzzyUsed);
  const { applyFilters } = useFilterSync();
  const filters = useFilterSync().filters;

  if (!fuzzyUsed) return null;

  const handleBackToExact = () => {
    // Find the fuzzy filter and set fuzzy to false
    const updatedFilters = filters.map((filter: FilterState) => {
      if (filter.fuzzy) {
        return { ...filter, fuzzy: false };
      }
      return filter;
    });
    applyFilters(updatedFilters);
  };

  return (
    <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3">
          <p className="text-sm">
          Fuzzy matching enabled for '{fuzzyUsed.query}'. Showing matches (≤ {fuzzyUsed.maxDistance} edits).
          </p>
          {fuzzyUsed.suggestions.length > 0 && (
            <p className="text-sm mt-1">
              Did you mean: {fuzzyUsed.suggestions.map((suggestion, index) => (
                <span key={suggestion}>
                  <code className="bg-yellow-200 px-1 rounded">{suggestion}</code>
                  {index < fuzzyUsed.suggestions.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="ml-auto pl-3">
          <div className="-mx-1.5 -my-1.5">
            <button
              onClick={handleBackToExact}
              className="inline-flex bg-yellow-100 rounded-md p-1.5 text-yellow-500 hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-yellow-100 focus:ring-yellow-600"
            >
              <span className="sr-only">Back to exact</span>
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
