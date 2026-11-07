# {{REPO_NAME}} (API Service)

Pure API Cloudflare Worker backend utilizing D1 database bindings.

## Development
Run `npm run dev` or `wrangler dev` to start the local development server.

## Environments
This template is configured for a single `production` environment deployed via GitHub Actions.
To add a `staging` environment later:
1. Update `.github/workflows/deploy.yml` to deploy to staging on a specific branch or trigger.
2. In `wrangler.toml`, mirror the `[env.production]` block to create an `[env.staging]` block. Ensure you update the Worker name, and any database names/IDs for the staging environment.

## Secrets & Credential Vault Setup
The model provider and connector credentials vault uses AES-256-GCM encryption with a master secret that lives strictly in deployment secrets, never in code or config files.

1. **Generate a 256-bit (32-byte) Base64 master key**:
   ```bash
   openssl rand -base64 32
   ```
2. **Local Development (`.dev.vars`)**:
   Add the generated key to your untracked `.dev.vars` file:
   ```env
   VAULT_ENCRYPTION_KEY=<your-32-byte-base64-key>
   ```
3. **Cloudflare Deployment**:
   Set the key as a Cloudflare Worker secret:
   ```bash
   npx wrangler secret put VAULT_ENCRYPTION_KEY
   ```

**Note**: D1 Migrations must be applied to the target database before deploying schema-dependent code. The CI pipeline will automatically apply pending migrations.
