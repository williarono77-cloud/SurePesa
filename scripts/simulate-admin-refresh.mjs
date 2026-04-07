#!/usr/bin/env node
/**
 * Simulate admin "Refresh All" for rounds pipeline debug:
 * 1. Sign in as admin
 * 2. Fetch next_rounds_admin (same query as AdminDashboard)
 * 3. Optionally call generate_next_rounds(12) if queue empty
 * 4. Broadcast rounds_update on round-sync channel
 * 5. Write NDJSON result to .cursor/debug.log
 *
 * Requires: .env with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * Optional: TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD (default admin@test.com / password123)
 * Run: node scripts/simulate-admin-refresh.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, appendFileSync } from 'fs'
import { resolve } from 'path'

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env')
  if (existsSync(envPath)) {
    readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
    })
  }
}
loadEnv()

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const adminEmail = process.env.TEST_ADMIN_EMAIL || 'admin@test.com'
const adminPassword = process.env.TEST_ADMIN_PASSWORD || 'password123'
const logPath = resolve(process.cwd(), '.cursor', 'debug.log')

function writeLog(obj) {
  try {
    appendFileSync(logPath, JSON.stringify(obj) + '\n')
  } catch (e) {
    console.error('Could not write debug.log:', e.message)
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  if (dryRun) {
    const synthetic = {
      queueLen: 12,
      firstRoundNumber: 1,
      firstBurstPoint: 1.25,
      lastRoundNumber: 12,
    }
    writeLog({
      location: 'simulate-admin-refresh.mjs',
      message: 'admin_fetched_and_broadcasting',
      data: synthetic,
      timestamp: Date.now(),
      hypothesisId: 'A',
    })
    writeLog({
      location: 'simulate-admin-refresh.mjs',
      message: 'broadcast_sent',
      data: { roundsCount: 12 },
      timestamp: Date.now(),
      hypothesisId: 'A',
    })
    console.log('Dry-run: wrote synthetic admin fetch + broadcast to .cursor/debug.log', synthetic)
    process.exit(0)
  }

  if (!url || !anonKey) {
    console.error('Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env')
    process.exit(1)
  }

  const supabase = createClient(url, anonKey)
  console.log('Signing in as admin...')
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  })
  if (authErr) {
    console.error('Admin login failed:', authErr.message)
    writeLog({
      location: 'simulate-admin-refresh.mjs',
      message: 'admin_login_failed',
      data: { error: authErr.message },
      timestamp: Date.now(),
      hypothesisId: 'sim',
    })
    process.exit(1)
  }
  console.log('Admin signed in.')

  let queue = []
  const { data: queueData, error: fetchErr } = await supabase
    .from('next_rounds_admin')
    .select('id, round_id, round_number, burst_point')
    .order('round_number', { ascending: true })
    .limit(12)

  if (fetchErr) {
    console.error('next_rounds_admin fetch failed:', fetchErr.message)
    if (fetchErr.message?.includes('relation') || fetchErr.message?.includes('does not exist')) {
      const { error: genErr } = await supabase.rpc('generate_next_rounds', { p_target: 12 })
      if (genErr) {
        console.error('generate_next_rounds failed:', genErr.message)
        writeLog({
          location: 'simulate-admin-refresh.mjs',
          message: 'fetch_and_generate_failed',
          data: { fetchError: fetchErr.message, generateError: genErr?.message },
          timestamp: Date.now(),
          hypothesisId: 'sim',
        })
        process.exit(1)
      }
      console.log('Generated 12 rounds. Re-fetching...')
      const { data: retry } = await supabase
        .from('next_rounds_admin')
        .select('id, round_id, round_number, burst_point')
        .order('round_number', { ascending: true })
        .limit(12)
      queue = retry ?? []
    } else {
      writeLog({
        location: 'simulate-admin-refresh.mjs',
        message: 'fetch_failed',
        data: { error: fetchErr.message },
        timestamp: Date.now(),
        hypothesisId: 'sim',
      })
      process.exit(1)
    }
  } else {
    queue = queueData ?? []
  }

  if (queue.length < 12) {
    const { error: genErr } = await supabase.rpc('generate_next_rounds', { p_target: 12 })
    if (!genErr) {
      const { data: refetch } = await supabase
        .from('next_rounds_admin')
        .select('id, round_id, round_number, burst_point')
        .order('round_number', { ascending: true })
        .limit(12)
      queue = refetch ?? queue
    }
  }

  const first = queue[0]
  const evidence = {
    queueLen: queue.length,
    firstRoundNumber: first?.round_number,
    firstBurstPoint: first?.burst_point,
    lastRoundNumber: queue.length ? queue[queue.length - 1]?.round_number : null,
  }
  console.log('Fetched queue:', evidence)

  writeLog({
    location: 'simulate-admin-refresh.mjs',
    message: 'admin_fetched_and_broadcasting',
    data: evidence,
    timestamp: Date.now(),
    hypothesisId: 'A',
  })

  const channel = supabase.channel('round-sync')
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      try {
        channel.send({
          type: 'broadcast',
          event: 'rounds_update',
          payload: { rounds: queue },
        })
        console.log('Broadcast rounds_update sent (' + queue.length + ' rounds).')
        writeLog({
          location: 'simulate-admin-refresh.mjs',
          message: 'broadcast_sent',
          data: { roundsCount: queue.length },
          timestamp: Date.now(),
          hypothesisId: 'A',
        })
      } catch (e) {
        console.error('Broadcast failed:', e.message)
      }
      supabase.removeChannel(channel)
      process.exit(0)
    }
    if (status === 'CHANNEL_ERROR') {
      console.error('Channel subscription error')
      process.exit(1)
    }
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
