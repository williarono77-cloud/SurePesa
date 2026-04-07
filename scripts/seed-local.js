#!/usr/bin/env node
/**
 * SEED SCRIPT — LOCAL DEVELOPMENT ONLY
 * Creates auth users via Supabase Admin API, then applies SQL seed.
 *
 * Usage:
 *   node scripts/seed-local.js
 *
 * Required env:
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Alternative: Run db/seed/seed-local.sql directly in Supabase SQL Editor
 * (includes auth.users insert via pgcrypto).
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const USERS = [
  { email: 'user@test.com', password: 'password123', displayName: 'User1', role: 'user' },
  { email: 'low@test.com', password: 'password123', displayName: 'LowUser', role: 'user' },
  { email: 'whale@test.com', password: 'password123', displayName: 'Whale', role: 'user' },
  { email: 'admin@test.com', password: 'password123', displayName: 'Admin', role: 'admin' },
]

async function createAuthUsers() {
  const ids = []
  for (const u of USERS) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { display_name: u.displayName },
    })
    if (error) {
      if (error.message?.includes('already been registered')) {
        console.log(`User ${u.email} already exists, skipping`)
        const { data: list } = await supabase.auth.admin.listUsers()
        const existing = list?.users?.find((x) => x.email === u.email)
        if (existing) ids.push({ ...u, id: existing.id })
      } else {
        console.error(`Failed to create ${u.email}:`, error.message)
      }
    } else if (data?.user) {
      ids.push({ ...u, id: data.user.id })
      console.log(`Created ${u.email}`)
    }
  }
  return ids
}

async function updateProfilesAndWallets(ids) {
  const BALANCES = {
    'user@test.com': { avail: 70000, locked: 50000 },
    'low@test.com': { avail: 8000, locked: 0 },
    'whale@test.com': { avail: 4500000, locked: 0 },
    'admin@test.com': { avail: 100000, locked: 0 },
  }
  for (const u of ids) {
    await supabase.from('profiles').upsert(
      { id: u.id, display_name: u.displayName, role: u.role },
      { onConflict: 'id' }
    )
    const b = BALANCES[u.email] || { avail: 0, locked: 0 }
    await supabase.from('wallets').upsert(
      { user_id: u.id, available_cents: b.avail, locked_cents: b.locked },
      { onConflict: 'user_id' }
    )
  }
  console.log('Updated profiles and wallets')
}

async function main() {
  console.log('Seeding auth users...')
  const ids = await createAuthUsers()
  if (ids.length === 0) {
    console.log('No users created. Run db/seed/seed-local.sql in SQL Editor for full seed (auth + data).')
    return
  }
  await updateProfilesAndWallets(ids)
  console.log('Done. Now run db/seed/seed-local.sql in Supabase SQL Editor for rounds, bets, deposits, withdrawals, ledger.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
