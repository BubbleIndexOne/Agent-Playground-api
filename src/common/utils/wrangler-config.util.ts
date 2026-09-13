import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility to dynamically extract environment configurations from wrangler.toml
 * when environment variables are not explicitly provided.
 */
export function getWranglerConnectionString(
  env: 'dev' | 'prod' | 'production',
): string | null {
  try {
    const wranglerPath = path.resolve(process.cwd(), 'wrangler.toml');
    if (!fs.existsSync(wranglerPath)) {
      return null;
    }

    const content = fs.readFileSync(wranglerPath, 'utf8');
    const isProd = env === 'prod' || env === 'production';
    const sectionPattern = isProd ? '\\[env\\.production\\]' : '\\[env\\.dev\\]';

    // Find the section and match localConnectionString
    const sectionRegex = new RegExp(
      `${sectionPattern}[\\s\\S]*?localConnectionString\\s*=\\s*"([^"]+)"`,
    );
    const match = content.match(sectionRegex);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
