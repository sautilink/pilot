import { ensureSchemaFamily } from './schema-ready.js';
import { createBroadcastStore } from './broadcast-store.js';

export const DISCOVERY_CATEGORIES = Object.freeze(['technology', 'education', 'business', 'entertainment', 'local', 'other']);
export const DISCOVERY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_community_discovery (
  chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('technology','education','business','entertainment','local','other')),
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_community_discovery_enabled ON pilot_community_discovery(enabled,category,chat_id);
`;
export function createDiscoveryStore(db) {
  const ensure = () => ensureSchemaFamily(db, 'discovery', DISCOVERY_SCHEMA_SQL, '1');
  return { ensure,
    async settings(chat) { await ensure(); const row = await db.prepare('SELECT enabled,category,updated_at FROM pilot_community_discovery WHERE chat_id=?').bind(String(chat)).first(); return { enabled: !!row?.enabled, category: row?.category || 'other', updated_at: row?.updated_at || null }; },
  };
}
export async function discoverCommunities(db, { query = '', category = '', language = '', page = 1 } = {}) {
  const search = typeof query === 'string' ? query.trim().slice(0, 80) : '';
  const selectedCategory = DISCOVERY_CATEGORIES.includes(category) ? category : '';
  const selectedLanguage = ['en', 'sw'].includes(language) ? language : '';
  const currentPage = Math.max(1, Math.min(100, Number.isSafeInteger(Number(page)) ? Number(page) : 1));
  await Promise.all([createDiscoveryStore(db).ensure(), createBroadcastStore(db).ensure()]);
  const where = ["h.visibility='public'", 'd.enabled=1', "b.status='active'", "h.slug IS NOT NULL", "h.join_url<>''"], values = [];
  if (selectedCategory) { where.push('d.category=?'); values.push(selectedCategory); }
  if (selectedLanguage) { where.push('h.language=?'); values.push(selectedLanguage); }
  if (search) { const pattern = `%${search.replace(/[\\%_]/g, value => '\\' + value)}%`; where.push("(h.title LIKE ? ESCAPE '\\' OR h.description LIKE ? ESCAPE '\\')"); values.push(pattern, pattern); }
  const relation = `FROM pilot_community_hubs h JOIN pilot_community_discovery d ON d.chat_id=h.chat_id JOIN pilot_broadcast_groups b ON b.chat_id=h.chat_id WHERE ${where.join(' AND ')}`;
  const rows = (await db.prepare(`SELECT h.slug,h.title,h.description,h.language,d.category ${relation} ORDER BY h.title COLLATE NOCASE,h.slug LIMIT 13 OFFSET ?`).bind(...values, (currentPage - 1) * 12).all()).results || [];
  return { communities: rows.slice(0, 12).map(row => ({ slug: row.slug, title: row.title, description: row.description, language: row.language, category: row.category, url: `https://pilot.sautilink.com/community/${row.slug}` })),
    page: currentPage, hasNext: rows.length > 12, query: search, category: selectedCategory, language: selectedLanguage };
}
