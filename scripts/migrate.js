#!/usr/bin/env node
/**
 * Sandy Soil Automations — Supabase Migration Runner
 *
 * Usage (from project root):
 *   SUPABASE_DB_PASSWORD=your_db_password node scripts/migrate.js
 *
 * Get your DB password from:
 *   Supabase Dashboard → Settings → Database → Database Password
 *
 * OR run with a Personal Access Token (from supabase.com/account):
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate.js
 */

import { readFileSync, readdirSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import https from 'https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL      = 'https://lecssjvuskqemjzvjimo.supabase.co'
const SERVICE_ROLE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlY3NzanZ1c2txZW1qenZqaW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjUxODg2OCwiZXhwIjoyMDg4MDk0ODY4fQ.UTFhDxtwgaSbJen8CS8LjASSR7kCHQ1LGIqcsNiEDRI'
const PROJECT_REF       = 'lecssjvuskqemjzvjimo'
const ACCESS_TOKEN      = process.env.SUPABASE_ACCESS_TOKEN
const DB_PASSWORD       = process.env.SUPABASE_DB_PASSWORD

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations')
const SQL_FILES = readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort()
  .map(f => path.join(MIGRATIONS_DIR, f))

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function runViaManagementApi(sql) {
  if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN not set')
  const url = new URL(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`)
  const body = JSON.stringify({ query: sql })
  const res = await request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Length': Buffer.byteLength(body),
    },
  }, body)
  if (res.status >= 400) throw new Error(`Management API error (${res.status}): ${res.body}`)
  return JSON.parse(res.body)
}

async function runViaPg(sql) {
  if (!DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD not set')
  // Dynamic import of pg (must be installed: npm install pg)
  let Client
  try {
    const pg = await import('pg')
    Client = pg.default.Client
  } catch {
    throw new Error('pg package not found. Run: npm install pg')
  }
  const client = new Client({
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

async function runViaSeedApi() {
  // What we CAN do via REST API with service role key:
  // Seed the default farm and device, and backfill zone_groups.device_id
  // This only works if the tables already exist with correct structure.

  const headers = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }

  async function restCall(method, path, body) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
    const bodyStr = body ? JSON.stringify(body) : undefined
    const res = await request(url, {
      method,
      headers: { ...headers, ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) },
    }, bodyStr)
    try { return { status: res.status, data: JSON.parse(res.body) } }
    catch { return { status: res.status, data: res.body } }
  }

  console.log('\n▸ Seeding default farm...')
  const farmRes = await restCall('GET', 'farms?select=id&limit=1')
  let farmId
  if (farmRes.status === 200 && Array.isArray(farmRes.data) && farmRes.data.length > 0) {
    farmId = farmRes.data[0].id
    console.log(`  ✓ Farm already exists: ${farmId}`)
  } else if (farmRes.status === 200) {
    const insert = await restCall('POST', 'farms', {
      name: 'Sandy Soil Farm', location: 'Mildura, VIC', status: 'online'
    })
    if (insert.status >= 400) {
      console.log(`  ✗ Could not insert farm: ${JSON.stringify(insert.data)}`)
    } else {
      farmId = Array.isArray(insert.data) ? insert.data[0]?.id : insert.data?.id
      console.log(`  ✓ Farm created: ${farmId}`)
    }
  } else {
    console.log(`  ✗ farms table not accessible (${farmRes.status}) — run the SQL migration first`)
    return
  }

  console.log('\n▸ Seeding default device (KC868-001)...')
  const devRes = await restCall('GET', 'farm_devices?select=id&limit=1')
  let deviceId
  if (devRes.status === 200 && Array.isArray(devRes.data) && devRes.data.length > 0) {
    deviceId = devRes.data[0].id
    console.log(`  ✓ Device already exists: ${deviceId}`)
  } else if (devRes.status === 200 && farmId) {
    const insert = await restCall('POST', 'farm_devices', {
      farm_id: farmId, device_id: 'KC868-001', model: 'KC868-A8v3',
      type: 'Irrigation Controller', firmware: 'v2.3.1', status: 'online',
    })
    if (insert.status >= 400) {
      console.log(`  ✗ Could not insert device: ${JSON.stringify(insert.data)}`)
    } else {
      deviceId = Array.isArray(insert.data) ? insert.data[0]?.id : insert.data?.id
      console.log(`  ✓ Device created: ${deviceId}`)
    }
  } else {
    console.log(`  ✗ farm_devices table not accessible (${devRes.status}) — run the SQL migration first`)
    return
  }

  if (deviceId) {
    console.log('\n▸ Backfilling zone_groups.device_id...')
    const patch = await restCall('PATCH', 'zone_groups?device_id=is.null', { device_id: deviceId })
    if (patch.status < 400) {
      console.log('  ✓ All NULL device_ids updated')
    } else {
      console.log(`  ✗ Backfill error: ${JSON.stringify(patch.data)}`)
    }
  }

  console.log('\n▸ Checking RLS on zone_groups INSERT...')
  const testInsert = await restCall('POST', 'zone_groups', {
    name: '__migration_test__', run_mode: 'sequential',
  })
  if (testInsert.status < 300) {
    const id = Array.isArray(testInsert.data) ? testInsert.data[0]?.id : testInsert.data?.id
    // Clean up test row
    if (id) await restCall('DELETE', `zone_groups?id=eq.${id}`)
    console.log('  ✓ INSERT policy working')
  } else {
    console.log(`  ✗ INSERT still blocked (${testInsert.status}): ${JSON.stringify(testInsert.data)}`)
    console.log('    → Run the SQL migration to add RLS policies')
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const sql = SQL_FILES.map(f => readFileSync(f, 'utf8')).join('\n')

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Sandy Soil — Supabase Migration Runner')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

if (ACCESS_TOKEN) {
  console.log('\n▸ Using Supabase Management API (Personal Access Token)...')
  try {
    await runViaManagementApi(sql)
    console.log('✓ Migration complete!\n')
    await runViaSeedApi()
  } catch (err) {
    console.error('✗ Management API failed:', err.message)
    process.exit(1)
  }
} else if (DB_PASSWORD) {
  console.log('\n▸ Using direct PostgreSQL connection...')
  try {
    await runViaPg(sql)
    console.log('✓ Migration complete!\n')
    await runViaSeedApi()
  } catch (err) {
    console.error('✗ PostgreSQL connection failed:', err.message)
    process.exit(1)
  }
} else {
  // No credentials — just seed what we can via REST API
  console.log('\n▸ No DB_PASSWORD or ACCESS_TOKEN — attempting seed via REST API only...')
  console.log('  (DDL changes like table creation and RLS policies require one of:)')
  console.log('  SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate.js')
  console.log('  SUPABASE_DB_PASSWORD=xxx node scripts/migrate.js')
  try {
    await runViaSeedApi()
  } catch (err) {
    console.error('✗ Seed failed:', err.message)
  }
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  To run the full SQL migration:')
  console.log('  1. Open: https://supabase.com/dashboard/project/lecssjvuskqemjzvjimo/sql')
  console.log('  2. Paste the contents of each file in: supabase/migrations/ (in order)')
  console.log('  3. Click Run')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}
