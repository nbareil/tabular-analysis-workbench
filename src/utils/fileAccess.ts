const supportsFileSystemSave = (): boolean => {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
};

const supportsAnchors = (): boolean => {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
};

interface SaveJsonOptions {
  suggestedName: string;
  contents: string;
  description?: string;
  mimeType?: string;
}

export const saveJsonFile = async ({
  suggestedName,
  contents,
  description = 'JSON file',
  mimeType = 'application/json;charset=utf-8;'
}: SaveJsonOptions): Promise<void> => {
  const blob = new Blob([contents], { type: mimeType });

  if (supportsFileSystemSave()) {
    const picker = (window as typeof window & {
      showSaveFilePicker?: typeof window.showSaveFilePicker;
    }).showSaveFilePicker;

    if (typeof picker === 'function') {
      const handle = await picker({
        suggestedName,
        types: [
          {
            description,
            accept: {
              [mimeType]: ['.json']
            }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }
  }

  if (!supportsAnchors()) {
    throw new Error('Saving files is not supported in this environment.');
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};
