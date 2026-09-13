# {{REPO_NAME}} (API Service)

Pure API Cloudflare Worker backend utilizing D1 database bindings.

## Development
Run `npm run dev` or `wrangler dev` to start the local development server.

## Environments
This template is configured for a single `production` environment deployed via GitHub Actions.
To add a `staging` environment later:
1. Update `.github/workflows/deploy.yml` to deploy to staging on a specific branch or trigger.
2. In `wrangler.toml`, mirror the `[env.production]` block to create an `[env.staging]` block. Ensure you update the Worker name, and any database names/IDs for the staging environment.

**Note**: D1 Migrations must be applied to the target database before deploying schema-dependent code. The CI pipeline will automatically apply pending migrations.
