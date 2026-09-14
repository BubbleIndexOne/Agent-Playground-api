const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

/**
 * Apply pending SQL files in filename order and record successful migrations.
 *
 * The target environment comes from `TARGET_ENV`, the first command-line
 * argument, or `dev`, in that order. `DATABASE_URL` overrides the corresponding
 * environment-specific URL. The process exits with status 1 if configuration,
 * connection, or migration execution fails.
 */
async function runMigrations() {
  const env = process.env.TARGET_ENV || process.argv[2] || 'dev';
  const isProd = env === 'prod' || env === 'production';

  console.log(`\n--- Running Migrations for Target Environment: ${env.toUpperCase()} ---`);

  const connectionString =
    process.env.DATABASE_URL ||
    (isProd
      ? process.env.PROD_DATABASE_URL
      : process.env.DEV_DATABASE_URL);

  if (!connectionString) {
    console.error(
      `Error: No database connection URL found for environment "${env}". Set DATABASE_URL or ${
        isProd ? 'PROD_DATABASE_URL' : 'DEV_DATABASE_URL'
      }.`,
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });

  try {
    await client.connect();
    console.log(`Connected to Supabase PostgreSQL (${env}).`);

    // Create migrations tracker table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found.');
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const { rows } = await client.query('SELECT name FROM _migrations;');
    const appliedNames = new Set(rows.map((r) => r.name));

    const newlyApplied = [];
    const alreadyApplied = [];
    const skippedFiles = [];

    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`✓ Migration ${file} already applied.`);
        alreadyApplied.push(file);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      if (!sql.trim() || sql.trim().startsWith('-- schema pasted here manually')) {
        console.log(`⚠ Skipped placeholder/empty migration: ${file}`);
        skippedFiles.push(file);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1);', [file]);
        await client.query('COMMIT');
        console.log(`✓ Successfully applied ${file}`);
        newlyApplied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ Error applying ${file}:`, err.message);
        throw err;
      }
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      const summary = [
        `### 🗄️ Database Migrations (${env.toUpperCase()})`,
        `- **Newly Applied:** ${newlyApplied.length}`,
        `- **Already Applied:** ${alreadyApplied.length}`,
        `- **Skipped/Empty:** ${skippedFiles.length}`,
      ];
      if (newlyApplied.length > 0) {
        summary.push('', '#### Applied Files');
        newlyApplied.forEach((f) => summary.push(`- \`${f}\``));
      }
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
    }

    if (newlyApplied.length > 0) {
      try {
        await client.query("NOTIFY pgrst, 'reload schema';");
        console.log('✓ Notified PostgREST to reload schema cache.');
      } catch (notifyErr) {
        // Safe to ignore if not running against Supabase/PostgREST
      }
    }

    console.log('--- Migration run finished successfully ---\n');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
