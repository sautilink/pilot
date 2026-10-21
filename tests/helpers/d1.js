import { DatabaseSync } from 'node:sqlite';

/** In-memory SQLite adapter for the D1 methods used by the Worker.
 * Real SQL constraints and transactions run here; Telegram alone is mocked.
 */
export class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new TestStatement(this, sql);
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        if (statement.owner !== this) throw new Error('Statement belongs to another database');
        return statement.execute();
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  withSession() {
    return this;
  }

  close() {
    this.sqlite.close();
  }
}

class TestStatement {
  constructor(owner, sql, values = []) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestStatement(this.owner, this.sql, values);
  }

  execute() {
    const statement = this.owner.sqlite.prepare(this.sql);
    const rows = statement.all(...this.values).map((row) => ({ ...row }));
    const stats = this.owner.sqlite.prepare(
      'SELECT changes() AS changes, last_insert_rowid() AS last_row_id',
    ).get();
    return {
      success: true,
      results: rows,
      meta: {
        changes: Number(stats.changes),
        last_row_id: Number(stats.last_row_id),
        duration: 0,
        rows_read: rows.length,
        rows_written: Number(stats.changes),
      },
    };
  }

  async first(column) {
    const result = this.execute().results[0];
    return result === undefined ? null : column === undefined ? result : result[column];
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }

  async raw(options = {}) {
    const rows = this.execute().results;
    const values = rows.map((row) => Object.values(row));
    return options.columnNames && rows.length ? [Object.keys(rows[0]), ...values] : values;
  }
}
