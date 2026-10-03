// Test setup only. Hosted schema changes are applied by Sites from Drizzle files.
import fs from 'node:fs';
export async function applyTestMigrations(db) {
  for (const name of fs.readdirSync('drizzle').filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
    const statements = fs.readFileSync(`drizzle/${name}`, 'utf8').split('--> statement-breakpoint')
      .map((sql) => sql.trim()).filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
}
