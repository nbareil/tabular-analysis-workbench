declare module '@duckdb/duckdb-wasm' {
  export interface DuckDbBundle {
    mainModule: string;
    mainWorker?: string;
    pthreadWorker?: string;
  }

  export class ConsoleLogger {
    constructor();
  }

  export class AsyncDuckDB {
    constructor(logger: ConsoleLogger, worker: Worker);
    instantiate(mainModule: string, pthreadWorker?: string): Promise<void>;
    connect(): Promise<DuckDbConnection>;
    terminate(): Promise<void>;
  }

  export interface DuckDbResult {
    toArray(options?: { format?: 'object' | 'array' }): unknown[];
  }

  export interface DuckDbConnection {
    query(sql: string, params?: unknown[]): Promise<DuckDbResult>;
    close(): Promise<void>;
  }

  export function getJsDelivrBundles(): DuckDbBundle[];
  export function selectBundle<TBundle extends DuckDbBundle>(bundles: TBundle[]): Promise<TBundle>;
}
