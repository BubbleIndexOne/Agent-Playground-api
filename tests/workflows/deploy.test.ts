import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/deploy.yml', import.meta.url)),
  'utf8',
);

function job(name: string, nextJob?: string) {
  const end = nextJob ? `(?=  ${nextJob}:)` : '(?![\\s\\S])';
  const match = workflow.match(new RegExp(`^  ${name}:([\\s\\S]*?)${end}`, 'm'));
  expect(match, `expected ${name} job in deployment workflow`).not.toBeNull();
  return match![1];
}

describe('deployment workflow', () => {
  it('runs for both production and development branch pushes', () => {
    expect(workflow).toMatch(/push:\s+branches:\s+- main\s+- dev/m);
  });

  it('runs unit tests before migrations', () => {
    expect(job('test', 'migrate')).toMatch(/run: npm test/);
    expect(job('migrate', 'deploy')).toMatch(/needs: test/);
  });

  it('installs locked dependencies before invoking migration scripts', () => {
    const migrate = job('migrate', 'deploy');
    expect(migrate.indexOf('run: npm ci')).toBeGreaterThan(-1);
    expect(migrate.indexOf('run: npm ci')).toBeLessThan(migrate.indexOf('npm run migrate:prod'));
  });

  it('routes main to production migrations and every other configured branch to development', () => {
    const migrate = job('migrate', 'deploy');
    expect(migrate).toContain('if [ "${{ github.ref }}" == "refs/heads/main" ]; then');
    expect(migrate).toMatch(/then\s+npm run migrate:prod\s+else\s+npm run migrate:dev\s+fi/m);
  });

  it('makes both environment-specific database URLs available only to the migration job', () => {
    const migrate = job('migrate', 'deploy');
    expect(migrate).toContain('DEV_DATABASE_URL: ${{ secrets.DEV_DATABASE_URL }}');
    expect(migrate).toContain('PROD_DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}');
    expect(job('test', 'migrate')).not.toContain('DATABASE_URL');
    expect(job('deploy')).not.toContain('DATABASE_URL');
  });

  it('blocks deployment on migration success and selects the matching deploy environment', () => {
    const deploy = job('deploy');
    expect(deploy).toMatch(/needs: migrate/);
    expect(deploy).toContain(
      "environment: ${{ github.ref == 'refs/heads/main' && 'production' || 'dev' }}",
    );
  });
});
