/**
 * End-to-End Live Endpoint Test Suite
 * Tests all Auth and Tools endpoints against the deployed Dev environment.
 */

const BASE_URL =
  process.env.BASE_URL ||
  'https://agent-playground-backend-dev.bubbleindexone-dev.workers.dev';

const ADMIN_KEY = process.env.ADMIN_KEY || '';

const DEV_CREDENTIALS = {
  email: process.env.TEST_USER_EMAIL || '',
  password: process.env.TEST_USER_PASSWORD || '',
};

let accessToken = '';
let refreshToken = '';
let clientToolId = '';
let mcpToolId = '';

const results = [];

function logPass(name, detail = '') {
  console.log(`✅ [PASS] ${name}${detail ? ` - ${detail}` : ''}`);
  results.push({ name, status: 'PASS', detail });
}

function logFail(name, error) {
  console.error(`❌ [FAIL] ${name}:`, error);
  results.push({ name, status: 'FAIL', error: String(error) });
}

async function request(path, options = {}, retries = 2) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });
    let body;
    try {
      body = await res.json();
    } catch (e) {
      body = await res.text();
    }
    return { status: res.status, body };
  } catch (err) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return request(path, options, retries - 1);
    }
    throw err;
  }
}

async function run() {
  console.log(`\n======================================================`);
  console.log(`Starting Live Endpoint Verification on:`);
  console.log(`${BASE_URL}`);
  console.log(`======================================================\n`);

  if (!DEV_CREDENTIALS.email || !DEV_CREDENTIALS.password || !ADMIN_KEY) {
    console.error(`❌ [ERROR] Missing required test credentials environment variables.`);
    console.error(`Please provide:`);
    console.error(`  - TEST_USER_EMAIL`);
    console.error(`  - TEST_USER_PASSWORD`);
    console.error(`  - ADMIN_KEY\n`);
    process.exit(1);
  }

  // 1. Health Endpoints
  try {
    const res = await request('/health');
    if (res.status === 200 && res.body.status === 'ok') {
      logPass('GET /health', `DB latency: ${res.body.databases?.[0]?.latencyMs}ms`);
    } else {
      logFail('GET /health', JSON.stringify(res.body));
    }
  } catch (err) {
    logFail('GET /health', err.message);
  }

  try {
    const res = await request('/health/db');
    if (res.status === 200 && res.body.status === 'connected') {
      logPass('GET /health/db', `Status: ${res.body.status}`);
    } else {
      logFail('GET /health/db', JSON.stringify(res.body));
    }
  } catch (err) {
    logFail('GET /health/db', err.message);
  }

  // 2. Auth: Ensure Dev User Exists (Signup if not exists)
  try {
    const signupRes = await request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: DEV_CREDENTIALS.email,
        password: DEV_CREDENTIALS.password,
        first_name: 'Agent',
        last_name: 'Tester',
      }),
    });
    if (signupRes.status === 201) {
      logPass('POST /auth/signup', 'User registered successfully');
    } else if (signupRes.status === 409) {
      logPass('POST /auth/signup', 'User already registered (expected 409)');
    } else {
      logFail('POST /auth/signup', JSON.stringify(signupRes.body));
    }
  } catch (err) {
    logFail('POST /auth/signup', err.message);
  }

  // 3. Auth: Login
  try {
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: DEV_CREDENTIALS.email,
        password: DEV_CREDENTIALS.password,
      }),
    });
    if (loginRes.status === 200 && loginRes.body.accessToken) {
      accessToken = loginRes.body.accessToken;
      refreshToken = loginRes.body.refreshToken;
      logPass('POST /auth/login', 'Received accessToken & refreshToken');
    } else {
      logFail('POST /auth/login', JSON.stringify(loginRes.body));
    }
  } catch (err) {
    logFail('POST /auth/login', err.message);
  }

  if (!accessToken) {
    console.error('\nCannot continue tests without valid accessToken. Aborting.');
    process.exit(1);
  }

  // 4. Auth: GET /auth/me
  try {
    const meRes = await request('/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (meRes.status === 200 && meRes.body.email === DEV_CREDENTIALS.email) {
      logPass('GET /auth/me', `User: ${meRes.body.email} (${meRes.body.first_name})`);
    } else {
      logFail('GET /auth/me', JSON.stringify(meRes.body));
    }
  } catch (err) {
    logFail('GET /auth/me', err.message);
  }

  // 5. Auth: PATCH /auth/me
  try {
    const patchMeRes = await request('/auth/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        display_name: 'Agent Supreme',
      }),
    });
    if (patchMeRes.status === 200 && patchMeRes.body.display_name === 'Agent Supreme') {
      logPass('PATCH /auth/me', `Updated display_name: ${patchMeRes.body.display_name}`);
    } else {
      logFail('PATCH /auth/me', JSON.stringify(patchMeRes.body));
    }
  } catch (err) {
    logFail('PATCH /auth/me', err.message);
  }

  // 6. Auth: POST /auth/refresh
  try {
    const refreshRes = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshRes.status === 200 && refreshRes.body.accessToken) {
      accessToken = refreshRes.body.accessToken;
      refreshToken = refreshRes.body.refreshToken;
      logPass('POST /auth/refresh', 'Successfully rotated refresh token and issued new access token');
    } else {
      logFail('POST /auth/refresh', JSON.stringify(refreshRes.body));
    }
  } catch (err) {
    logFail('POST /auth/refresh', err.message);
  }

  // 7. Tools: POST /tools (Client Tool)
  try {
    const toolRes = await request('/tools', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: 'Live Web Scraper',
        description: 'Tool for live test execution',
        type: 'client',
        is_public: false,
      }),
    });
    if (toolRes.status === 201 && toolRes.body.id) {
      clientToolId = toolRes.body.id;
      logPass('POST /tools (Client)', `Created tool ID: ${clientToolId}`);
    } else {
      logFail('POST /tools (Client)', JSON.stringify(toolRes.body));
    }
  } catch (err) {
    logFail('POST /tools (Client)', err.message);
  }

  // 8. Tools: POST /tools (MCP Tool)
  try {
    const mcpRes = await request('/tools', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: 'Live GitHub MCP',
        type: 'mcp',
        connector_type: 'github',
        is_public: false,
      }),
    });
    if (mcpRes.status === 201 && mcpRes.body.id) {
      mcpToolId = mcpRes.body.id;
      logPass('POST /tools (MCP)', `Created MCP tool ID: ${mcpToolId} (connector: ${mcpRes.body.connector_type})`);
    } else {
      logFail('POST /tools (MCP)', JSON.stringify(mcpRes.body));
    }
  } catch (err) {
    logFail('POST /tools (MCP)', err.message);
  }

  // 9. Tools: GET /tools
  try {
    const listRes = await request('/tools', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.status === 200 && Array.isArray(listRes.body)) {
      const found = listRes.body.find((t) => t.id === clientToolId);
      if (found) {
        logPass('GET /tools', `Found ${listRes.body.length} tools for user`);
      } else {
        logFail('GET /tools', 'Created tool not found in list');
      }
    } else {
      logFail('GET /tools', JSON.stringify(listRes.body));
    }
  } catch (err) {
    logFail('GET /tools', err.message);
  }

  // 10. Tools: POST /tools/:id/versions (Client Tool v1)
  try {
    const v1Res = await request(`/tools/${clientToolId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        code: 'export default async function run(params) { return { url: params.url, title: "Mock" }; }',
        schema_json: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
        capabilities_json: ['network:http_get'],
      }),
    });
    if (v1Res.status === 201 && v1Res.body.version_number === 1 && v1Res.body.code_hash) {
      logPass('POST /tools/:id/versions (v1)', `Created version 1 (code_hash: ${v1Res.body.code_hash.substring(0, 16)}...)`);
    } else {
      logFail('POST /tools/:id/versions (v1)', JSON.stringify(v1Res.body));
    }
  } catch (err) {
    logFail('POST /tools/:id/versions (v1)', err.message);
  }

  // 11. Tools: POST /tools/:id/versions (MCP Tool v1 - Holding verification check)
  try {
    const mcpV1Res = await request(`/tools/${mcpToolId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        schema_json: { type: 'object', properties: { repo: { type: 'string' } } },
        capabilities_json: [],
      }),
    });
    if (mcpV1Res.status === 201 && mcpV1Res.body.version_number === 1) {
      logPass('POST /tools/:id/versions (MCP)', 'Created version 1 for MCP tool');
    } else {
      logFail('POST /tools/:id/versions (MCP)', JSON.stringify(mcpV1Res.body));
    }
  } catch (err) {
    logFail('POST /tools/:id/versions (MCP)', err.message);
  }

  // 12. Tools: GET /tools/:id (Verify MCP Tool is held in 'testing' status)
  try {
    const getMcpRes = await request(`/tools/${mcpToolId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (getMcpRes.status === 200 && getMcpRes.body.status === 'testing') {
      logPass('GET /tools/:id (MCP Holding)', `Verified MCP tool automatically placed in status: '${getMcpRes.body.status}'`);
    } else {
      logFail('GET /tools/:id (MCP Holding)', `Expected status 'testing', got: ${getMcpRes.body?.status}`);
    }
  } catch (err) {
    logFail('GET /tools/:id (MCP Holding)', err.message);
  }

  // 13. Tools: POST /tools/:id/versions (Client Tool v2)
  try {
    const v2Res = await request(`/tools/${clientToolId}/versions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        code: 'export default async function run(params) { return { url: params.url, title: "Enhanced", status: 200 }; }',
        schema_json: {
          type: 'object',
          properties: { url: { type: 'string' }, timeout: { type: 'number' } },
          required: ['url'],
        },
        capabilities_json: ['network:http_get'],
      }),
    });
    if (v2Res.status === 201 && v2Res.body.version_number === 2) {
      logPass('POST /tools/:id/versions (v2)', `Created version 2`);
    } else {
      logFail('POST /tools/:id/versions (v2)', JSON.stringify(v2Res.body));
    }
  } catch (err) {
    logFail('POST /tools/:id/versions (v2)', err.message);
  }

  // 14. Tools: GET /tools/:id/versions (History)
  try {
    const historyRes = await request(`/tools/${clientToolId}/versions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (historyRes.status === 200 && Array.isArray(historyRes.body) && historyRes.body.length === 2) {
      logPass('GET /tools/:id/versions', `Found 2 versions in history (${historyRes.body[0].version_number}, ${historyRes.body[1].version_number})`);
    } else {
      logFail('GET /tools/:id/versions', JSON.stringify(historyRes.body));
    }
  } catch (err) {
    logFail('GET /tools/:id/versions', err.message);
  }

  // 15. Tools: GET /tools/:id/diff?from=1&to=2
  try {
    const diffRes = await request(`/tools/${clientToolId}/diff?from=1&to=2`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (diffRes.status === 200 && diffRes.body.diff?.code_changed === true) {
      logPass('GET /tools/:id/diff', `Verified code_changed: true, schema_changed: ${diffRes.body.diff.schema_changed}`);
    } else {
      logFail('GET /tools/:id/diff', JSON.stringify(diffRes.body));
    }
  } catch (err) {
    logFail('GET /tools/:id/diff', err.message);
  }

  // 16. Security Test: User CANNOT set MCP tool to 'verified'
  try {
    const unauthVerifyRes = await request(`/tools/${mcpToolId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ status: 'verified' }),
    });
    if (unauthVerifyRes.status === 403) {
      logPass('Security: User promotion guard', 'Regular user rejected with 403 when attempting to verify MCP tool');
    } else {
      logFail('Security: User promotion guard', `Expected 403, got ${unauthVerifyRes.status}`);
    }
  } catch (err) {
    logFail('Security: User promotion guard', err.message);
  }

  // 17. Admin Test: Admin CAN set MCP tool to 'verified' using x-admin-key
  try {
    const adminVerifyRes = await request(`/tools/${mcpToolId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-admin-key': ADMIN_KEY,
      },
      body: JSON.stringify({ status: 'verified' }),
    });
    if (adminVerifyRes.status === 200 && adminVerifyRes.body.status === 'verified') {
      logPass('Admin: x-admin-key promotion', 'Admin successfully verified MCP tool (status: verified)');
    } else {
      logFail('Admin: x-admin-key promotion', JSON.stringify(adminVerifyRes.body));
    }
  } catch (err) {
    logFail('Admin: x-admin-key promotion', err.message);
  }

  // 18. Tools: DELETE /tools/:id (Soft-delete)
  try {
    const deleteRes = await request(`/tools/${mcpToolId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (deleteRes.status === 200 && deleteRes.body.message === 'Tool archived successfully') {
      logPass('DELETE /tools/:id', 'Soft-deleted (archived) tool successfully');
    } else {
      logFail('DELETE /tools/:id', JSON.stringify(deleteRes.body));
    }
  } catch (err) {
    logFail('DELETE /tools/:id', err.message);
  }

  // Small delay for write replication
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 19. Visibility Test: Regular user gets 404 for archived tool
  try {
    const getArchivedUserRes = await request(`/tools/${mcpToolId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (getArchivedUserRes.status === 404) {
      logPass('RBAC Visibility (User)', 'Archived tool returns 404 to regular user');
    } else {
      logFail('RBAC Visibility (User)', `Expected 404, got ${getArchivedUserRes.status}`);
    }
  } catch (err) {
    logFail('RBAC Visibility (User)', err.message);
  }

  // 20. Visibility Test: Admin can inspect archived tool via x-admin-key
  try {
    const getArchivedAdminRes = await request(`/tools/${mcpToolId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-admin-key': ADMIN_KEY,
      },
    });
    if (getArchivedAdminRes.status === 200 && getArchivedAdminRes.body.is_archived === true) {
      logPass('RBAC Visibility (Admin)', `Admin successfully inspected archived tool (is_archived: ${getArchivedAdminRes.body.is_archived})`);
    } else {
      logFail('RBAC Visibility (Admin)', JSON.stringify(getArchivedAdminRes.body));
    }
  } catch (err) {
    logFail('RBAC Visibility (Admin)', err.message);
  }

  // 21. Post-Test Cleanup Phase (Hard purge created test tools & restore profile)
  try {
    // Revert display_name to 'Agent'
    await request('/auth/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ display_name: 'Agent' }),
    });

    // Hard purge created test tools
    if (clientToolId) {
      await request(`/tools/${clientToolId}?purge=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'x-admin-key': ADMIN_KEY },
      });
    }
    if (mcpToolId) {
      await request(`/tools/${mcpToolId}?purge=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'x-admin-key': ADMIN_KEY },
      });
    }
    logPass('Post-Test Cleanup', 'Purged test tools and restored profile display_name');
  } catch (err) {
    console.warn('⚠️ [CLEANUP WARNING]', err.message);
  }

  const passedCount = results.filter((r) => r.status === 'PASS').length;
  const failedCount = results.filter((r) => r.status === 'FAIL').length;

  console.log(`\n======================================================`);
  console.log(`Summary: ${passedCount} Passed, ${failedCount} Failed`);
  console.log(`======================================================\n`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = require('fs');
    const summaryLines = [
      `### 🧪 Live End-to-End Endpoint Test Results`,
      `**Target Environment:** \`${BASE_URL}\``,
      ``,
      `| Status | Test Endpoint / Feature | Details / Notes |`,
      `| :---: | :--- | :--- |`,
      ...results.map(
        (r) =>
          `| ${r.status === 'PASS' ? '✅ **PASS**' : '❌ **FAIL**'} | \`${r.name}\` | ${
            r.detail || r.error || '-'
          } |`,
      ),
      ``,
      `---`,
      `**Total Tests:** ${results.length} | **Passed:** ${passedCount} | **Failed:** ${failedCount}`,
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join('\n') + '\n');
  }

  if (failedCount > 0) {
    process.exit(1);
  }
}

run();
