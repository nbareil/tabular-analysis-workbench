type SavePickerWritableStream = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

type SavePickerHandle = {
  createWritable: () => Promise<SavePickerWritableStream>;
};

type SavePickerOptions = {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept?: Record<string, string[]>;
  }>;
};

type ShowSaveFilePicker = (options?: SavePickerOptions) => Promise<SavePickerHandle>;

const getSaveFilePicker = (): ShowSaveFilePicker | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const candidate = (window as Window & {
    showSaveFilePicker?: ShowSaveFilePicker;
  }).showSaveFilePicker;

  return typeof candidate === 'function' ? candidate : null;
};

const supportsAnchors = (): boolean => {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
};

interface SaveBlobOptions {
  suggestedName: string;
  blob: Blob;
  description?: string;
  mimeType?: string;
  extensions?: string[];
}

export const saveBlobFile = async ({
  suggestedName,
  blob,
  description = 'File',
  mimeType = blob.type || 'application/octet-stream',
  extensions
}: SaveBlobOptions): Promise<void> => {
  const picker = getSaveFilePicker();
  if (picker) {
    const handle = await picker({
      suggestedName,
      types: [
        {
          description,
          accept: {
            [mimeType]: extensions && extensions.length ? extensions : ['.bin']
          }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
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
  await saveBlobFile({
    suggestedName,
    blob,
    description,
    mimeType,
    extensions: ['.json']
  });
};
