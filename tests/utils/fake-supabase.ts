/**
 * A tiny in-memory stand-in for the Supabase JS client.
 *
 * It implements only the query surface the server modules actually use
 * (`select / eq / neq / in / order / limit / maybeSingle / single`, plus
 * `insert / update / delete` and head counts), which keeps unit tests fast and
 * fully deterministic without a database and without any real credentials.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

interface Filter {
  kind: "eq" | "neq" | "in" | "not-in" | "is-null" | "not-null" | "or" | "gt" | "lt" | "gte" | "lte";
  column: string;
  value: unknown;
}

function matches(row: Row, filter: Filter): boolean {
  const actual = row[filter.column];
  switch (filter.kind) {
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "in":
      return Array.isArray(filter.value) && (filter.value as unknown[]).includes(actual);
    case "not-in":
      return Array.isArray(filter.value) && !(filter.value as unknown[]).includes(actual);
    case "is-null":
      return actual === null || actual === undefined;
    case "not-null":
      return actual !== null && actual !== undefined;
    case "or":
      return (filter.value as Filter[]).some((clause) => matches(row, clause));
    case "gt":
      return String(actual) > String(filter.value);
    case "lt":
      return String(actual) < String(filter.value);
    case "gte":
      return String(actual) >= String(filter.value);
    case "lte":
      return String(actual) <= String(filter.value);
    default:
      return true;
  }
}

export interface FakeSupabase {
  from(table: string): QueryBuilder;
  rpc(fn: string, args?: Row): Promise<{ data: unknown; error: null }>;
  /** Raw table access for assertions and seeding. */
  tables: Tables;
  /** Every mutation performed through the client, for assertions. */
  writes: Array<{ table: string; op: "insert" | "update" | "delete"; payload: Row | null }>;
  /** Registered handlers for `rpc()` calls. */
  rpcHandlers: Record<string, (args: Row) => unknown>;
}

class QueryBuilder implements PromiseLike<{ data: Row[] | null; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private limitValue: number | null = null;
  private headOnly = false;
  private wantCount = false;
  private embeds: string[] = [];

  constructor(
    private readonly client: FakeSupabase,
    private readonly table: string,
  ) {}

  private rows(): Row[] {
    const rows = this.client.tables[this.table] ?? [];
    const filtered = rows.filter((row) => this.filters.every((f) => matches(row, f)));
    const limited = this.limitValue === null ? filtered : filtered.slice(0, this.limitValue);
    return this.embeds.length === 0 ? limited : limited.map((row) => this.withEmbeds(row));
  }

  /**
   * Resolves PostgREST-style embedded selects such as `workspaces!inner(tenant_id)`
   * by following the `<singular>_id` foreign key convention used by the schema.
   */
  private withEmbeds(row: Row): Row {
    const embedded: Row = { ...row };
    for (const name of this.embeds) {
      const foreignKey = `${name.replace(/s$/, "")}_id`;
      const related = (this.client.tables[name] ?? []).find((candidate) => candidate["id"] === row[foreignKey]);
      embedded[name] = related ?? null;
    }
    return embedded;
  }

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    this.wantCount = Boolean(options?.count);
    this.headOnly = Boolean(options?.head);
    for (const match of (columns ?? "").matchAll(/([a-z_]+)(?:!inner|!left)?\s*\(/g)) {
      const name = match[1];
      if (name) this.embeds.push(name);
    }
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    if (value === null) this.filters.push({ kind: "is-null", column, value: null });
    return this;
  }

  /** Only the `not(col, "is", null)` form used by the repositories. */
  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) this.filters.push({ kind: "not-null", column, value: null });
    else this.filters.push({ kind: "neq", column, value });
    return this;
  }

  /** Minimal PostgREST `or()` support: `col.is.null,col.eq.value`. */
  or(expression: string) {
    const clauses: Filter[] = [];
    for (const part of expression.split(",")) {
      const [column, operator, ...rest] = part.split(".");
      const raw = rest.join(".");
      if (!column || !operator) continue;
      if (operator === "is" && raw === "null") clauses.push({ kind: "is-null", column, value: null });
      else clauses.push({ kind: "eq", column, value: raw });
    }
    this.filters.push({ kind: "or", column: "", value: clauses });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ kind: "gt", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.limitValue = count;
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.rows()[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: null }> {
    return this.maybeSingle();
  }

  insert(payload: Row | Row[]) {
    const list = Array.isArray(payload) ? payload : [payload];
    const target = (this.client.tables[this.table] ??= []);
    for (const row of list) {
      target.push({ ...row });
      this.client.writes.push({ table: this.table, op: "insert", payload: { ...row } });
    }
    return this;
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    const list = Array.isArray(payload) ? payload : [payload];
    const key = options?.onConflict?.split(",")[0]?.trim() ?? "id";
    const target = (this.client.tables[this.table] ??= []);
    for (const row of list) {
      const index = target.findIndex((existing) => existing[key] === row[key]);
      if (index >= 0) target[index] = { ...target[index], ...row };
      else target.push({ ...row });
      this.client.writes.push({ table: this.table, op: "insert", payload: { ...row } });
    }
    return this;
  }

  update(payload: Row) {
    for (const row of this.rows()) Object.assign(row, payload);
    this.client.writes.push({ table: this.table, op: "update", payload: { ...payload } });
    return this;
  }

  delete() {
    const doomed = new Set(this.rows());
    this.client.tables[this.table] = (this.client.tables[this.table] ?? []).filter((row) => !doomed.has(row));
    this.client.writes.push({ table: this.table, op: "delete", payload: null });
    return this;
  }

  then<TResult1 = { data: Row[] | null; error: null; count: number | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.rows();
    const result = {
      data: this.headOnly ? null : rows,
      error: null as null,
      count: this.wantCount ? rows.length : null,
    };
    return Promise.resolve(result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export function createFakeSupabase(seed: Tables = {}): FakeSupabase {
  const client: FakeSupabase = {
    tables: structuredClone(seed),
    writes: [],
    rpcHandlers: {},
    from(table: string) {
      return new QueryBuilder(client, table);
    },
    async rpc(fn: string, args: Row = {}) {
      const handler = client.rpcHandlers[fn];
      return { data: handler ? handler(args) : null, error: null };
    },
  };
  return client;
}