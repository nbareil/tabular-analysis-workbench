const UNITS = ['B', 'KB', 'MB', 'GB'];

export const formatBytes = (bytes: number): string => {
  if (bytes <= 0 || !Number.isFinite(bytes)) {
    return '0 B';
  }

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${UNITS[exponent]}`;
};

export default formatBytes;
