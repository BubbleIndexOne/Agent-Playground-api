const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function runMigrations() {
  const env = process.env.TARGET_ENV || process.argv[2] || 'dev';
  console.log(`\n--- Running Migrations for Target Environment: ${env.toUpperCase()} ---`);

  const isProd = env === 'prod' || env === 'production';
  const connectionString =
    process.env.DATABASE_URL ||
    (isProd
      ? process.env.PROD_DATABASE_URL ||
        'postgresql://postgres.egnpcdukuzckjxuwlypn:t5usnRNZBhV83Mha@aws-0-ap-south-1.pooler.supabase.com:5432/postgres'
      : process.env.DEV_DATABASE_URL ||
        'postgresql://postgres.kvxhozhsstdtlrqeaxgs:CTnU6iLEuETfKUIS@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
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

    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`✓ Migration ${file} already applied.`);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      if (!sql.trim() || sql.trim().startsWith('-- schema pasted here manually')) {
        console.log(`⚠ Skipped placeholder/empty migration: ${file}`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1);', [file]);
        await client.query('COMMIT');
        console.log(`✓ Successfully applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ Error applying ${file}:`, err.message);
        throw err;
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
