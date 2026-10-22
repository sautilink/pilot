// A deployment's schema is durable; a chat coordinator's memory is not. Keep
// family readiness in D1 so a new coordinator need not replay every CREATE.
// Only initialization results are cached here, never users, roles or settings.
export const SCHEMA_FAMILY_VERSIONS = Object.freeze({
  experience: '1', control: '1', guards: '1', owner: '1', broadcast: '1',
});
const PREFIX = 'pilot_schema:';
const bindings = new WeakMap();
const normalize = sql => String(sql || '').replace(/\bIF\s+NOT\s+EXISTS\b/gi, '').replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
const split = sql => sql.split(';').map(part => part.trim()).filter(Boolean);
const objectName = sql => /^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql)?.[1];

function stateFor(db) {
  let state = bindings.get(db);
  if (!state) { state = { catalog: null, ready: new Map() }; bindings.set(db, state); }
  return state;
}

async function catalog(db, state) {
  if (!state.catalog) {
    const pending = (async () => {
      try {
        const result = await db.prepare(`SELECT 'version' AS kind,key AS name,value,NULL AS definition
          FROM settings WHERE key LIKE 'pilot_schema:%'
          UNION ALL SELECT 'object' AS kind,name,type AS value,sql AS definition
          FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'`).all();
        const rows = result.results || [];
        return {
          settingsExists: true,
          versions: new Map(rows.filter(row => row.kind === 'version').map(row => [row.name.slice(PREFIX.length), row.value])),
          objects: new Map(rows.filter(row => row.kind === 'object').map(row => [row.name, normalize(row.definition)])),
        };
      } catch (error) {
        // Standalone first-time setup may not have the base settings table yet.
        // Transport, permission and other SQL errors must never imply readiness.
        if (!/no such table:\s*(?:main\.)?settings\b/i.test(String(error?.message))) throw error;
        const result = await db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'").all();
        return {
          settingsExists: false,
          versions: new Map(),
          objects: new Map((result.results || []).map(row => [row.name, normalize(row.sql)])),
        };
      }
    })();
    state.catalog = pending;
    pending.catch(() => { if (state.catalog === pending) state.catalog = null; });
  }
  return state.catalog;
}

function schemaVersionStatement(db, versions = SCHEMA_FAMILY_VERSIONS) {
  const entries = Object.entries(versions);
  return db.prepare(`INSERT INTO settings(key,value) VALUES ${entries.map(() => '(?,?)').join(',')}
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
    WHERE CAST(settings.value AS INTEGER)<=CAST(excluded.value AS INTEGER)`).bind(...entries.flatMap(([family, version]) => [PREFIX + family, version]));
}

function assertVersionsWritten(result, count) {
  // A newer deployment may have raised a marker after our catalog read. The
  // conditional UPSERT preserves it; a skipped write must not become ready.
  if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== count) throw new Error('pilot_schema_version_newer');
}

// Called only after setup definitions, seed rows and durable markers succeeded.
function markSchemaFamiliesReady(db, versions = SCHEMA_FAMILY_VERSIONS) {
  const state = stateFor(db);
  for (const [family, version] of Object.entries(versions)) state.ready.set(`${family}:${version}`, Promise.resolve());
  // A later, different family/version must read the actual durable catalog.
  state.catalog = null;
}

const schemaObjects = statements => statements.filter(statement => objectName(statement)).map(statement => [objectName(statement), normalize(statement)]);

function assertCompatibleObjects(known, objects) {
  // CREATE IF NOT EXISTS cannot repair an existing table or index definition.
  if (objects.some(([name, definition]) => known.objects.has(name) && known.objects.get(name) !== definition)) {
    throw new Error('pilot_schema_migration_required');
  }
}

async function verifyObjects(db, objects) {
  const actual = await db.prepare(`SELECT name,sql FROM sqlite_master WHERE name IN (${objects.map(() => '?').join(',')})`).bind(...objects.map(([name]) => name)).all();
  const definitions = new Map((actual.results || []).map(row => [row.name, normalize(row.sql)]));
  if (!objects.every(([name, definition]) => definitions.get(name) === definition)) throw new Error('pilot_schema_migration_required');
}

export async function applyCompleteSchema(db, sql, versions = SCHEMA_FAMILY_VERSIONS) {
  const state = stateFor(db);
  // Explicit operator setup must inspect the current database, even when this
  // binding already served requests or a previous setup attempt was repaired.
  state.catalog = null;
  state.ready.clear();
  try {
    const known = await catalog(db, state);
    for (const [family, version] of Object.entries(versions)) {
      if (Number(known.versions.get(family)) > Number(version)) throw new Error('pilot_schema_version_newer');
    }
    const statements = split(sql), objects = schemaObjects(statements);
    assertCompatibleObjects(known, objects);
    // Existing, verified definitions need no DDL. Seed statements still run so
    // a missing singleton is restored without replacing its established data.
    const needed = statements.filter(statement => !objectName(statement) || !known.objects.has(objectName(statement)));
    if (needed.length) await db.batch(needed.map(statement => db.prepare(statement)));
    // Certify the actual result, never just successful IF NOT EXISTS statements.
    await verifyObjects(db, objects);
    assertVersionsWritten(await schemaVersionStatement(db, versions).run(), Object.keys(versions).length);
    markSchemaFamiliesReady(db, versions);
  } catch (error) {
    state.catalog = null;
    state.ready.clear();
    throw error;
  }
}

export function ensureSchemaFamily(db, family, sql, version = SCHEMA_FAMILY_VERSIONS[family]) {
  if (!/^[1-9]\d*$/.test(version || '') || !/^[a-z]+$/.test(family)) throw new TypeError('invalid_schema_family');
  const state = stateFor(db), key = `${family}:${version}`;
  if (state.ready.has(key)) return state.ready.get(key);
  const pending = (async () => {
    const known = await catalog(db, state);
    if (known.versions.get(family) === version) return;
    if (Number(known.versions.get(family)) > Number(version)) throw new Error('pilot_schema_version_newer');
    const statements = split(sql);
    const objects = schemaObjects(statements);
    // The initial version may adopt a fully matching legacy installation. A
    // table name alone is insufficient: columns, defaults and constraints must
    // match the current declared definition. Future versions run migrations.
    const legacyReady = version === '1' && !known.versions.has(family) &&
      objects.length > 0 && objects.every(([name, definition]) => known.objects.get(name) === definition);
    const seeds = statements.filter(statement => !objectName(statement));
    if (legacyReady) {
      // Required singleton rows are part of readiness even if tables existed.
      const results = await db.batch([...seeds.map(statement => db.prepare(statement)), schemaVersionStatement(db, { [family]: version })]);
      assertVersionsWritten(results.at(-1), 1);
    } else {
      // IF NOT EXISTS cannot repair a partially upgraded table. Do not certify
      // it as current and allow destructive actions against an unknown schema.
      assertCompatibleObjects(known, objects);
      const creates = known.settingsExists ? statements : ['CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)', ...statements];
      await db.batch(creates.map(statement => db.prepare(statement)));
      await verifyObjects(db, objects);
      assertVersionsWritten(await schemaVersionStatement(db, { [family]: version }).run(), 1);
      known.settingsExists = true;
    }
    known.versions.set(family, version);
    for (const [name, definition] of objects) known.objects.set(name, definition);
  })();
  state.ready.set(key, pending);
  pending.catch(() => {
    if (state.ready.get(key) === pending) state.ready.delete(key);
    state.catalog = null;
  });
  return pending;
}
