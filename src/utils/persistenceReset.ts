let storedDataFlushInProgress = false;

export const markStoredDataFlushInProgress = (): void => {
  storedDataFlushInProgress = true;
};

export const isStoredDataFlushInProgress = (): boolean => storedDataFlushInProgress;

export const resetStoredDataFlushStateForTests = (): void => {
  storedDataFlushInProgress = false;
};
