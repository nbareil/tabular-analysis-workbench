// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { detectFormat } from './detectFormat';

const encoder = new TextEncoder();

async function* chunksOf(parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield encoder.encode(part);
  }
}

const detect = async (parts: string[]) => {
  const { format, source } = await detectFormat(chunksOf(parts));
  const replayed: string[] = [];
  for await (const chunk of source) {
    replayed.push(new TextDecoder().decode(chunk));
  }
  return { format, text: replayed.join('') };
};

describe('detectFormat', () => {
  it.each([
    ['delimited text', ['timestamp,host\n'], 'delimited'],
    ['JSON Lines', ['{"a":1}\n'], 'jsonl'],
    ['JSON Lines after blank lines and a byte order mark', ['\uFEFF\r\n  \n{"a":1}\n'], 'jsonl'],
    ['a lone opening brace at the end of the file', ['{'], 'jsonl'],
    ['a JSON array', ['  [{"a":1}]'], 'json'],
    ['pretty-printed JSON', ['{  \r\n  "a": 1\n}'], 'json'],
    ['an empty file', [], 'delimited'],
    ['a file of blank lines', ['\n\n', '  \r\n'], 'delimited']
  ])('recognises %s', async (_name, parts, format) => {
    expect((await detect(parts)).format).toBe(format);
  });

  it('decides across chunk boundaries, including a split byte order mark', async () => {
    const bytes = encoder.encode('\uFEFF{\n"a":1}');
    const split = (at: number) => [bytes.subarray(0, at), bytes.subarray(at)];
    for (let at = 1; at < 5; at += 1) {
      const { format } = await detectFormat(
        (async function* () {
          yield* split(at);
        })()
      );
      expect(format).toBe('json');
    }
    expect((await detect(['', '{', ' ', '"a":1}\n'])).format).toBe('jsonl');
  });

  it('replays every chunk, inspected or not', async () => {
    const parts = ['\n', '{"a":', '1}\n', '{"a":2}\n'];
    expect(await detect(parts)).toEqual({ format: 'jsonl', text: parts.join('') });
  });
});
