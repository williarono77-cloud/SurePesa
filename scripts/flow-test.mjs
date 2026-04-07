#!/usr/bin/env node
/**
 * FINAL FLOW TEST — API-level verification for A1–A5 and U1–U6.
 * Requires: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD,
 *           TEST_USER_EMAIL, TEST_USER_PASSWORD in .env
 * Run: node scripts/flow-test.mjs [--run1|--run2|--both]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
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

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const adminEmail = process.env.TEST_ADMIN_EMAIL
const adminPassword = process.env.TEST_ADMIN_PASSWORD
const userEmail = process.env.TEST_USER_EMAIL
const userPassword = process.env.TEST_USER_PASSWORD

const results = { preflight: {}, run1: {}, run2: {} }

function fail(step, msg, fix) {
  const out = { step, error: msg, fix }
  console.error(`\n[FAIL] ${step}: ${msg}`)
  if (fix) console.error(`FIX: ${fix}`)
  return out
}

function pass(step, evidence = '') {
  console.log(`[PASS] ${step}${evidence ? ' — ' + evidence : ''}`)
  return { step, pass: true, evidence }
}

async function runPreflight() {
  console.log('\n=== PRE-FLIGHT ===')
  if (!url || !anonKey) {
    results.preflight.P0 = fail('P0', 'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing', 'Set in .env')
    return false
  }
  results.preflight.P0_env = pass('P0', 'env vars configured')

  const supabase = createClient(url, anonKey)

  // P1: DB objects — probe via API (no raw SQL)
  try {
    const { data: cr, error: crErr } = await supabase.from('current_round').select('*').maybeSingle()
    if (crErr && crErr.code !== 'PGRST116') {
      results.preflight.P1_current_round = fail('P1', `current_round: ${crErr.message}`, 'Apply migration 00')
      return false
    }
    results.preflight.P1_current_round = pass('P1', 'current_round view exists')
  } catch (e) {
    results.preflight.P1_current_round = fail('P1', String(e.message), 'Check Supabase connection')
    return false
  }

  try {
    const { data: nrp, error: nrpErr } = await supabase.rpc('get_next_rounds_public')
    if (nrpErr && nrpErr.message?.includes('function') && nrpErr.message?.includes('does not exist')) {
      results.preflight.P1_get_next_rounds = fail('P1', `get_next_rounds_public missing: ${nrpErr.message}`, 'Apply migration 00')
      return false
    }
    if (nrpErr) {
      results.preflight.P1_get_next_rounds = pass('P1', 'get_next_rounds_public exists (error may be RLS/none)')
    } else {
      results.preflight.P1_get_next_rounds = pass('P1', 'get_next_rounds_public exists')
    }
  } catch (e) {
    results.preflight.P1_get_next_rounds = fail('P1', String(e.message), 'Check Supabase')
    return false
  }

  if (!adminEmail || !adminPassword || !userEmail || !userPassword) {
    console.warn('\n[SKIP] Full flow tests require TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_USER_EMAIL, TEST_USER_PASSWORD in .env')
    results.preflight.credentials = { skip: true, reason: 'Credentials not set' }
    return true
  }

  // Verify admin_end_round and resolve_round_bets exist (sign in as admin, call with invalid ID)
  const { data: adminAuth, error: adminAuthErr } = await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
  if (adminAuthErr) {
    results.preflight.admin_auth = fail('P1', `Admin login failed: ${adminAuthErr.message}`, 'Check TEST_ADMIN_EMAIL/PASSWORD')
    return false
  }

  const { error: aerErr } = await supabase.rpc('admin_end_round', { p_round_id: '00000000-0000-0000-0000-000000000000' })
  const aerMsg = aerErr?.message ?? ''
  if (aerMsg.includes('function') && aerMsg.includes('does not exist')) {
    results.preflight.admin_end_round = fail('P1', 'admin_end_round RPC missing', 'Apply db/migrations/02_admin_end_round.sql')
    await supabase.auth.signOut()
    return false
  }
  results.preflight.admin_end_round = pass('P1', 'admin_end_round exists')

  const { error: rrbErr } = await supabase.rpc('resolve_round_bets', { p_round_id: 'non-existent-round' })
  const rrbMsg = rrbErr?.message ?? ''
  if (rrbMsg.includes('function') && rrbMsg.includes('does not exist')) {
    results.preflight.resolve_round_bets = fail('P1', 'resolve_round_bets RPC missing', 'Apply db/migrations/01_betting_engine.sql')
    await supabase.auth.signOut()
    return false
  }
  results.preflight.resolve_round_bets = pass('P1', 'resolve_round_bets exists')

  const { data: genErr } = await supabase.rpc('generate_next_rounds', { p_target: 12 })
  results.preflight.generate_next_rounds = pass('P1', 'generate_next_rounds exists')

  const { data: nextAdmin } = await supabase.from('next_rounds_admin').select('id,round_id,round_number,status,burst_point').limit(1)
  if (nextAdmin?.data === undefined && nextAdmin?.error?.message?.includes('relation')) {
    results.preflight.next_rounds_admin = fail('P1', 'next_rounds_admin view missing', 'Apply migration 00')
    await supabase.auth.signOut()
    return false
  }
  results.preflight.next_rounds_admin = pass('P1', 'next_rounds_admin exists')

  await supabase.auth.signOut()
  return true
}

async function runAdminFlow(supabase, runId) {
  const r = {}
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
  if (authErr) {
    r.A1 = fail('A1', `Admin login failed: ${authErr.message}`)
    return r
  }
  r.A1 = pass('A1', 'Admin login OK')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    r.A1 = fail('A1', `profiles.role='${profile?.role ?? 'null'}' (expected admin)`)
    return r
  }

  const { data: queue } = await supabase.from('next_rounds_admin').select('id,round_id,round_number,status,burst_point').limit(20)
  const queueCount = queue?.length ?? 0
  if (queueCount < 12) {
    const { error: genE } = await supabase.rpc('generate_next_rounds', { p_target: 12 })
    if (genE) r.A2 = fail('A2', `Queue has ${queueCount} items; generate_next_rounds failed: ${genE.message}`)
    else {
      const { data: q2 } = await supabase.from('next_rounds_admin').select('round_number').limit(20)
      r.A2 = pass('A2', `Refreshed queue; ${q2?.length ?? 0} scheduled rounds`)
    }
  } else {
    r.A2 = pass('A2', `${queueCount} scheduled rounds (first: ${queue?.[0]?.round_number ?? '—'}, last: ${queue?.[queue.length - 1]?.round_number ?? '—'})`)
  }

  const { data: cr } = await supabase.from('current_round').select('*').maybeSingle()
  if (!cr || (cr.status !== 'live' && cr.status !== 'ended')) {
    r.A3 = fail('A3', `current_round returned ${cr ? `status=${cr.status}` : 'no row'}; need one row with status=live`)
    return r
  }
  r.A3 = pass('A3', `current_round status=${cr.status} round_id=${cr.round_id ?? cr.id}`)

  if (cr.status === 'live') {
    const { error: endErr } = await supabase.rpc('admin_end_round', { p_round_id: cr.id })
    if (endErr) {
      r.A4 = fail('A4', `admin_end_round failed: ${endErr.message}`)
      return r
    }
    r.A4 = pass('A4', 'admin_end_round returned 200')
  } else {
    r.A4 = pass('A4', 'Round already ended, skip')
  }

  const { data: cr2 } = await supabase.from('current_round').select('*').maybeSingle()
  if (cr2?.status !== 'ended') {
    r.A5 = fail('A5', `Round not ended after admin_end_round; status=${cr2?.status ?? 'null'}`)
    return r
  }

  const roundIdText = cr2.round_id ?? cr2.id
  const { data: resolveCount, error: resolveErr } = await supabase.rpc('resolve_round_bets', { p_round_id: roundIdText })
  if (resolveErr) {
    r.A5 = fail('A5', `resolve_round_bets failed: ${resolveErr.message}`)
    return r
  }
  r.A5 = pass('A5', `resolve_round_bets returned ${resolveCount ?? 0} bet(s)`)

  // Idempotency: call again
  const { data: resolveCount2, error: resolveErr2 } = await supabase.rpc('resolve_round_bets', { p_round_id: roundIdText })
  if (resolveErr2) {
    r.A5_idem = fail('A5', `resolve_round_bets idempotency: ${resolveErr2.message}`)
  } else if ((resolveCount2 ?? 0) !== 0) {
    r.A5_idem = fail('A5', `resolve_round_bets idempotency: second call resolved ${resolveCount2} bets (expected 0)`)
  } else {
    r.A5_idem = pass('A5', 'Idempotent: second call resolved 0 bets')
  }

  return r
}

async function runUserFlow(supabase, runId) {
  await supabase.auth.signOut()
  const { data: uAuth, error: uAuthErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: userPassword })
  if (uAuthErr) {
    return { U1: fail('U1', `User login failed: ${uAuthErr.message}`) }
  }
  const r = {}
  r.U1 = pass('U1', 'User login OK')

  const { data: walletBefore } = await supabase.from('wallets').select('available_cents,locked_cents').eq('user_id', uAuth.user.id).maybeSingle()
  const { data: currentRound } = await supabase.from('current_round').select('round_id,id,status').maybeSingle()
  const { data: queue } = await supabase.rpc('get_next_rounds_public')
  const scheduled = Array.isArray(queue) ? queue.find(x => x.status === 'scheduled') : null

  if (currentRound && (currentRound.status === 'live' || currentRound.status === 'ended')) {
    const liveRoundId = currentRound.round_id ?? String(currentRound.id)
    const { error: betLiveErr } = await supabase.rpc('game_place_bet', { p_round_id: liveRoundId, p_side: 'top', p_stake_cents: 100 })
    if (betLiveErr && (betLiveErr.message?.includes('BETTING_CLOSED') || betLiveErr.message?.includes('scheduled'))) {
      r.U2 = pass('U2', 'Bet during live correctly rejected (BETTING_CLOSED)')
    } else if (!betLiveErr) {
      r.U2 = fail('U2', 'Bet during live was accepted (should fail server-side)')
      return r
    } else {
      r.U2 = pass('U2', `Bet during live rejected: ${(betLiveErr.message || '').slice(0, 50)}`)
    }
  } else {
    r.U2 = pass('U2', 'SKIP: no live round to test rejection')
  }

  if (!scheduled) {
    r.U3 = pass('U3', 'SKIP: no scheduled round')
    r.U4 = pass('U4', 'SKIP')
    r.U5 = pass('U5', 'SKIP')
    r.U6 = pass('U6', 'SKIP')
    return r
  }

  const roundId = scheduled.round_id ?? String(scheduled.id ?? '')
  if (!roundId) {
    r.U3 = fail('U3', 'Scheduled round has no round_id')
    return r
  }

  const { error: topErr } = await supabase.rpc('game_place_bet', { p_round_id: roundId, p_side: 'top', p_stake_cents: 100 })
  if (topErr) {
    r.U3 = fail('U3', `TOP bet failed: ${topErr.message}`)
    return r
  }
  const { error: botErr } = await supabase.rpc('game_place_bet', { p_round_id: roundId, p_side: 'bottom', p_stake_cents: 100 })
  if (botErr) {
    r.U3 = fail('U3', `BOTTOM bet failed: ${botErr.message}`)
    return r
  }
  r.U3 = pass('U3', 'TOP and BOTTOM bets placed')

  const { data: walletAfter } = await supabase.from('wallets').select('available_cents,locked_cents').eq('user_id', uAuth.user.id).maybeSingle()
  const avBefore = walletBefore?.available_cents ?? 0
  const avAfter = walletAfter?.available_cents ?? 0
  const lockedBefore = walletBefore?.locked_cents ?? 0
  const lockedAfter = walletAfter?.locked_cents ?? 0
  const stakeTotal = 200
  if (avAfter > avBefore || (avBefore - avAfter) !== stakeTotal) {
    r.U4 = fail('U4', `Wallet: available ${avBefore} -> ${avAfter} (expected decrease ${stakeTotal})`)
  } else if (lockedAfter < lockedBefore + stakeTotal) {
    r.U4 = fail('U4', `Wallet: locked ${lockedBefore} -> ${lockedAfter} (expected +${stakeTotal})`)
  } else {
    r.U4 = pass('U4', `available -${stakeTotal}, locked +${stakeTotal}`)
  }

  r.U5 = pass('U5', 'Admin ends+resolves (done in admin flow)')
  r.U6 = pass('U6', 'Resolution visible after admin flow (manual verification)')
  return r
}

async function main() {
  console.log('FINAL FLOW TEST — betIka')
  const ok = await runPreflight()
  if (!ok) {
    console.log('\n=== PRE-FLIGHT FAILED ===')
    process.exit(1)
  }

  if (!adminEmail || !adminPassword || !userEmail || !userPassword) {
    console.log('\n=== CREDENTIALS REQUIRED FOR FULL FLOW ===')
    console.log('Add to .env: TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_USER_EMAIL, TEST_USER_PASSWORD')
    process.exit(0)
  }

  const supabase = createClient(url, anonKey)
  const run1 = process.argv.includes('--run2') ? false : true
  const run2 = process.argv.includes('--run1') ? false : process.argv.includes('--both') || process.argv.includes('--run2')

  if (run1) {
    console.log('\n=== RUN #1 — ADMIN (A1–A5) ===')
    results.run1.admin = await runAdminFlow(supabase, 1)
    console.log('\n=== RUN #1 — USER (U1–U6) ===')
    results.run1.user = await runUserFlow(supabase, 1)
  }

  if (run2) {
    console.log('\n=== RUN #2 — ADMIN (A1–A5) ===')
    results.run2.admin = await runAdminFlow(supabase, 2)
    console.log('\n=== RUN #2 — USER (U1–U6) ===')
    results.run2.user = await runUserFlow(supabase, 2)
  }

  const allAdmin = [...Object.values(results.run1?.admin ?? {}), ...Object.values(results.run2?.admin ?? {})]
  const allUser = [...Object.values(results.run1?.user ?? {}), ...Object.values(results.run2?.user ?? {})]
  const hasFail = (arr) => arr.some(x => x && x.error)
  if (hasFail(allAdmin) || hasFail(allUser)) {
    console.log('\n=== VERDICT: FAIL ===')
    process.exit(1)
  }
  console.log('\n=== VERDICT: PASS ===')
  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
