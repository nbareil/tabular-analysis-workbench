export type TextFormat = 'delimited' | 'jsonl' | 'json';

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const LF = 0x0a;
const OPEN_BRACE = 0x7b;
const OPEN_BRACKET = 0x5b;

const isWhitespace = (byte: number): boolean => byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === LF;

/**
 * Tells the format from the first byte that is not whitespace or a UTF-8 byte order mark: `{`
 * starts JSON Lines, unless nothing else follows on its line (pretty-printed JSON); `[` starts a
 * JSON document; anything else is delimited text. Returns the stream with the inspected chunks put back.
 */
export const detectFormat = async (
  source: AsyncIterable<Uint8Array>
): Promise<{ format: TextFormat; source: AsyncIterable<Uint8Array> }> => {
  const iterator = source[Symbol.asyncIterator]();
  const inspected: Uint8Array[] = [];
  let format: TextFormat | null = null;
  let offset = 0;
  let afterBrace = false;

  while (format === null) {
    const { value, done } = await iterator.next();
    if (done) {
      format = afterBrace ? 'jsonl' : 'delimited';
      break;
    }
    inspected.push(value);
    for (let index = 0; index < value.length && format === null; index += 1, offset += 1) {
      const byte = value[index]!;
      if (afterBrace) {
        if (byte === LF) {
          format = 'json';
        } else if (!isWhitespace(byte)) {
          format = 'jsonl';
        }
      } else if (byte === OPEN_BRACE) {
        afterBrace = true;
      } else if (!isWhitespace(byte) && !(offset < UTF8_BOM.length && byte === UTF8_BOM[offset])) {
        format = byte === OPEN_BRACKET ? 'json' : 'delimited';
      }
    }
  }

  return {
    format,
    source: {
      async *[Symbol.asyncIterator]() {
        yield* inspected.splice(0);
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
          yield next.value;
        }
      }
    }
  };
};
