export {}; // Ensure this file is treated as a module.

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  }

  interface FileSystemFileHandle {
    queryPermission?: (descriptor?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
    requestPermission?: (descriptor?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}
