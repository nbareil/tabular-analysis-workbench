import { useEffect, useState } from 'react';

import type { GridColumn, LoaderStatus } from '@state/dataStore';
import { getDataWorker } from '@workers/dataWorkerProxy';
import {
  AUTO_WIDTH_BLOCK_SIZE,
  AUTO_WIDTH_MAX_SAMPLE_ROWS,
  CELL_HORIZONTAL_PADDING_PX,
  HEADER_CONTROLS_PX,
  computeAutoColumnWidth
} from './gridUtils';

/**
 * Measures sampled cell text once per loaded file and returns a width per column, so columns
 * open at a readable size. Samples are spread across the file rather than taken from the top.
 */
export const useAutoColumnWidths = (
  columns: GridColumn[],
  status: LoaderStatus,
  totalRows: number,
  loadId: number
): Record<string, number> => {
  const [widths, setWidths] = useState<{ loadId: number; widths: Record<string, number> }>({
    loadId: -1,
    widths: {}
  });

  useEffect(() => {
    if (status !== 'ready' || !columns.length || totalRows <= 0 || widths.loadId === loadId) {
      return undefined;
    }

    let cancelled = false;
    const measure = async () => {
      const worker = getDataWorker();
      const blockCount = Math.max(1, Math.ceil(Math.min(AUTO_WIDTH_MAX_SAMPLE_ROWS, totalRows) / AUTO_WIDTH_BLOCK_SIZE));
      const maxOffset = Math.max(0, totalRows - AUTO_WIDTH_BLOCK_SIZE);
      const step = blockCount > 1 ? Math.floor(maxOffset / (blockCount - 1)) : 0;
      const rows: Array<Record<string, unknown>> = [];
      for (let block = 0; block < blockCount && !cancelled; block += 1) {
        const response = await worker.fetchRows({ offset: block * step, limit: AUTO_WIDTH_BLOCK_SIZE });
        rows.push(...response.rows);
      }

      const context = document.createElement('canvas').getContext('2d');
      if (cancelled || !context) {
        return;
      }
      const rootStyle = window.getComputedStyle(document.documentElement);
      const fontFamily = rootStyle.getPropertyValue('--data-font-family').trim() || 'Inter, sans-serif';
      const fontSize = parseFloat(rootStyle.getPropertyValue('--data-font-size')) || 13;
      context.font = `${fontSize}px ${fontFamily}`;
      const cache = new Map<string, number>();
      const measureText = (text: string): number => {
        let width = cache.get(text);
        if (width == null) {
          width = context.measureText(text).width + CELL_HORIZONTAL_PADDING_PX;
          cache.set(text, width);
        }
        return width;
      };

      const next: Record<string, number> = {};
      for (const column of columns) {
        next[column.key] = computeAutoColumnWidth({
          valueSamples: rows.map((row) => measureText(String(row[column.key] ?? ''))),
          headerWidth: measureText(column.headerName) + HEADER_CONTROLS_PX
        });
      }
      setWidths({ loadId, widths: next });
    };

    void measure().catch((error) => console.warn('[grid] Failed to compute column widths', error));
    return () => {
      cancelled = true;
    };
  }, [columns, loadId, status, totalRows, widths.loadId]);

  return widths.loadId === loadId ? widths.widths : {};
};
