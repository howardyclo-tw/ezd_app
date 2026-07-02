import { tool } from 'ai';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Strip comments and string/identifier literals so keyword scanning doesn't trip
 * on legitimate content like WHERE name = 'update my profile'.
 */
function sanitizeForScan(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/--[^\n]*/g, ' ')               // line comments
    .replace(/'(?:''|[^'])*'/g, "''")        // single-quoted literals
    .replace(/"(?:""|[^"])*"/g, '""');       // double-quoted identifiers
}

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|vacuum|reindex|refresh|merge|call|do|set|reset|begin|commit|rollback|savepoint|listen|notify|lock|prepare|execute|analyze|cluster|discard|declare|into|setval|nextval)\b/i;

export type SqlCheck = { ok: true; sql: string } | { ok: false; error: string };

/**
 * App-layer guard (defense in depth). The DB function exec_readonly_sql is the
 * real enforcement (read-only transaction + timeout + row cap); this just gives
 * fast, clear rejections and blocks obvious abuse before hitting the DB.
 */
export function validateReadOnlySql(raw: string): SqlCheck {
  const sql = raw.trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, error: '空查詢。' };

  const scan = sanitizeForScan(sql);
  if (scan.includes(';')) return { ok: false, error: '只允許單一查詢語句（不可有分號分隔多個語句）。' };
  if (!/^\s*(with|select)\b/i.test(scan)) return { ok: false, error: '只允許 SELECT / WITH 唯讀查詢。' };

  const hit = scan.match(FORBIDDEN);
  if (hit) return { ok: false, error: `偵測到不允許的關鍵字「${hit[1].toLowerCase()}」（唯讀查詢禁止寫入/DDL）。` };

  return { ok: true, sql };
}

export const runQueryTool = tool({
  description:
    'Run a read-only PostgreSQL SELECT/WITH query against the club database and return rows as JSON. Use this for EVERY factual or numeric answer — never guess. Read-only: any write/DDL is rejected. Returns up to 1000 rows (model sees up to 200).',
  inputSchema: z.object({
    purpose: z
      .string()
      .describe('One short sentence describing what this query answers (kept in the audit log).'),
    sql: z
      .string()
      .describe('A single PostgreSQL SELECT or WITH...SELECT statement. No writes, no DDL, no multiple statements.'),
  }),
  execute: async ({ sql, purpose }) => {
    const check = validateReadOnlySql(sql);
    if (!check.ok) {
      return { ok: false as const, error: check.error, sql };
    }

    // Audit trail (dev): every query the assistant runs.
    console.info('[ai-assistant] runQuery:', JSON.stringify({ purpose, sql: check.sql }));

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('exec_readonly_sql', { query: check.sql });
    if (error) {
      return { ok: false as const, error: error.message, sql: check.sql };
    }

    const rows = Array.isArray(data) ? data : [];
    return {
      ok: true as const,
      sql: check.sql,
      purpose,
      rowCount: rows.length,
      rows: rows.slice(0, 200),
      truncated: rows.length > 200,
    };
  },
});
