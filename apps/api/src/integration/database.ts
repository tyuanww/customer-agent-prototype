import type { QueryResultRow } from 'pg';

export type IntegrationPool = Readonly<{
  connect: () => Promise<Readonly<{
    query: <R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) => Promise<Readonly<{ rows: R[] }>>;
    release: (broken?: boolean) => void;
  }>>;
}>;
