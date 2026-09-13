import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../migrations/001_init_schema.sql', import.meta.url)),
  'utf8',
)
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

const expectedTables = [
  'profiles',
  'tools',
  'tool_versions',
  'tool_reports',
  'user_connector_credentials',
  'agents',
  'agent_tools',
  'runs',
];

describe('initial database schema', () => {
  it('defines every application table exactly once', () => {
    const tables = [...schema.matchAll(/create table (\w+)/gi)].map((match) => match[1]);

    expect(tables).toEqual(expectedTables);
  });

  it('constrains tool types, lifecycle states, and immutable version numbers', () => {
    expect(schema).toMatch(/type text not null check \(type in \('client', 'mcp'\)\)/i);
    expect(schema).toMatch(
      /status text not null default 'draft' check \(status in \('draft', 'testing', 'registered', 'rejected', 'deprecated'\)\)/i,
    );
    expect(schema).toMatch(/unique \(tool_id, version_number\)/i);
    expect(schema).toMatch(/unique \(user_id, connector_type\)/i);
    expect(schema).toMatch(/primary key \(agent_id, tool_id\)/i);
  });

  it('uses intentional cascading or nulling behavior for core relationships', () => {
    expect(schema).toMatch(/tool_id uuid not null references tools\(id\) on delete cascade/i);
    expect(schema).toMatch(/agent_id uuid references agents\(id\) on delete set null/i);
    expect(schema).toMatch(/foreign key \(current_version_id\) references tool_versions\(id\) on delete set null/i);
    expect(schema.match(/references auth\.users\(id\) on delete cascade/gi)).toHaveLength(5);
  });

  it('enables row-level security for every application table', () => {
    const securedTables = [
      ...schema.matchAll(/alter table (\w+) enable row level security/gi),
    ].map((match) => match[1]);

    expect(securedTables).toEqual(expectedTables);
  });

  it('limits public tool reads to registered, public, non-archived records', () => {
    expect(schema).toMatch(
      /create policy "public tools readable" on tools for select using \(is_public = true and status = 'registered' and is_archived = false\)/i,
    );
  });

  it('requires ownership for version writes and report access', () => {
    expect(schema).toMatch(
      /create policy "owner writes versions" on tool_versions for insert with check \( exists \(select 1 from tools where tools\.id = tool_id and tools\.owner_id = auth\.uid\(\)\) \)/i,
    );
    expect(schema).toMatch(
      /create policy "file own reports" on tool_reports for insert with check \(auth\.uid\(\) = reporter_id\)/i,
    );
    expect(schema).toMatch(
      /create policy "read own reports" on tool_reports for select using \(auth\.uid\(\) = reporter_id\)/i,
    );
  });

  it('protects credentials, agents, agent-tool links, and runs with owner policies', () => {
    expect(schema).toMatch(
      /create policy "own credentials only" on user_connector_credentials for all using \(auth\.uid\(\) = user_id\)/i,
    );
    expect(schema).toMatch(
      /create policy "own agents" on agents for all using \(auth\.uid\(\) = owner_id\)/i,
    );
    expect(schema).toMatch(
      /create policy "own agent_tools" on agent_tools for all using \( exists \(select 1 from agents where agents\.id = agent_id and agents\.owner_id = auth\.uid\(\)\) \)/i,
    );
    expect(schema).toMatch(
      /create policy "own runs" on runs for all using \(auth\.uid\(\) = user_id\)/i,
    );
  });

  it('updates tool and agent timestamps through moddatetime triggers', () => {
    expect(schema).toMatch(/create extension if not exists moddatetime schema extensions/i);
    for (const table of ['tools', 'agents']) {
      expect(schema).toMatch(
        new RegExp(
          `create trigger handle_updated_at before update on ${table} for each row execute procedure moddatetime \\(updated_at\\)`,
          'i',
        ),
      );
    }
  });

  it('creates a profile from new user metadata after signup', () => {
    expect(schema).toMatch(/create or replace function public\.handle_new_user\(\) returns trigger/i);
    expect(schema).toMatch(
      /insert into public\.profiles \(id, display_name\) values \(new\.id, new\.raw_user_meta_data->>'full_name'\)/i,
    );
    expect(schema).toMatch(
      /create trigger on_auth_user_created after insert on auth\.users for each row execute procedure public\.handle_new_user\(\)/i,
    );
  });
});
