#!/usr/bin/env node
/**
 * TEST SCRIPT - Deposit Flow Simulation
 * Tests the manual M-Pesa deposit flow and admin approval
 * 
 * Usage: node scripts/test-deposit-flow.js
 * 
 * Required env:
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (for admin operations)
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

async function testDepositFlow() {
  console.log('🧪 Testing Deposit Flow...\n')

  try {
    // 1. Create a test user
    console.log('1. Creating test user...')
    const testEmail = `test-${Date.now()}@test.com`
    const testPassword = 'testpassword123'
    
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true
    })

    if (authError) {
      console.error('❌ Failed to create user:', authError.message)
      return
    }

    const userId = authData.user.id
    console.log('✅ User created:', userId)

    // 2. Create profile
    console.log('\n2. Creating profile...')
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: userId, role: 'user' })

    if (profileError) {
      console.error('❌ Failed to create profile:', profileError.message)
      return
    }
    console.log('✅ Profile created')

    // 3. Create wallet
    console.log('\n3. Creating wallet...')
    const { error: walletError } = await supabase
      .from('wallets')
      .insert({ user_id: userId, available_cents: 0, locked_cents: 0 })

    if (walletError) {
      console.error('❌ Failed to create wallet:', walletError.message)
      return
    }
    console.log('✅ Wallet created')

    // 4. Sign in as user
    console.log('\n4. Signing in as user...')
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword
    })

    if (signInError) {
      console.error('❌ Failed to sign in:', signInError.message)
      return
    }
    console.log('✅ Signed in successfully')

    // 5. Test deposit_initiate
    console.log('\n5. Testing deposit_initiate...')
    const amountCents = 50000 // 500 KES
    const phone = '0712345678'
    
    const { data: depositId, error: depositError } = await supabase.rpc('deposit_initiate', {
      p_amount_cents: amountCents,
      p_phone: phone
    })

    if (depositError) {
      console.error('❌ deposit_initiate failed:', depositError.message)
      return
    }
    console.log('✅ Deposit initiated, ID:', depositId)

    // 6. Update deposit to pending_submit
    console.log('\n6. Updating deposit status to pending_submit...')
    const { error: updateError } = await supabase
      .from('deposits')
      .update({ method: 'manual_mpesa', status: 'pending_submit' })
      .eq('id', depositId)

    if (updateError) {
      console.error('❌ Failed to update deposit:', updateError.message)
      return
    }
    console.log('✅ Deposit status updated')

    // 7. Test deposit_submit_mpesa_ref
    console.log('\n7. Testing deposit_submit_mpesa_ref...')
    const mpesaRef = 'TEST123ABC'
    const { error: submitError } = await supabase.rpc('deposit_submit_mpesa_ref', {
      p_deposit_id: depositId,
      p_mpesa_ref: mpesaRef
    })

    if (submitError) {
      console.error('❌ deposit_submit_mpesa_ref failed:', submitError.message)
      return
    }
    console.log('✅ M-Pesa reference submitted')

    // 8. Verify deposit status
    console.log('\n8. Verifying deposit status...')
    const { data: deposit, error: fetchError } = await supabase
      .from('deposits')
      .select('*')
      .eq('id', depositId)
      .single()

    if (fetchError) {
      console.error('❌ Failed to fetch deposit:', fetchError.message)
      return
    }

    if (deposit.status !== 'submitted') {
      console.error('❌ Expected status "submitted", got:', deposit.status)
      return
    }
    if (deposit.external_ref !== mpesaRef) {
      console.error('❌ Expected external_ref "' + mpesaRef + '", got:', deposit.external_ref)
      return
    }
    console.log('✅ Deposit status verified:', deposit.status)
    console.log('✅ External ref verified:', deposit.external_ref)

    // 9. Create admin user
    console.log('\n9. Creating admin user...')
    const adminEmail = `admin-${Date.now()}@test.com`
    const { data: adminAuthData, error: adminAuthError } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: testPassword,
      email_confirm: true
    })

    if (adminAuthError) {
      console.error('❌ Failed to create admin user:', adminAuthError.message)
      return
    }

    const adminId = adminAuthData.user.id
    const { error: adminProfileError } = await supabase
      .from('profiles')
      .insert({ id: adminId, role: 'admin' })

    if (adminProfileError) {
      console.error('❌ Failed to create admin profile:', adminProfileError.message)
      return
    }
    console.log('✅ Admin user created')

    // 10. Sign in as admin
    console.log('\n10. Signing in as admin...')
    await supabase.auth.signOut()
    const { error: adminSignInError } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: testPassword
    })

    if (adminSignInError) {
      console.error('❌ Failed to sign in as admin:', adminSignInError.message)
      return
    }
    console.log('✅ Signed in as admin')

    // 11. Test admin_deposit_approve
    console.log('\n11. Testing admin_deposit_approve...')
    const { error: approveError } = await supabase.rpc('admin_deposit_approve', {
      p_deposit_id: depositId
    })

    if (approveError) {
      console.error('❌ admin_deposit_approve failed:', approveError.message)
      return
    }
    console.log('✅ Deposit approved')

    // 12. Verify wallet updated
    console.log('\n12. Verifying wallet updated...')
    const { data: wallet, error: walletFetchError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (walletFetchError) {
      console.error('❌ Failed to fetch wallet:', walletFetchError.message)
      return
    }

    if (wallet.available_cents !== amountCents) {
      console.error('❌ Expected available_cents', amountCents, ', got:', wallet.available_cents)
      return
    }
    console.log('✅ Wallet updated correctly:', wallet.available_cents / 100, 'KES')

    // 13. Verify deposit status
    console.log('\n13. Verifying deposit status after approval...')
    const { data: approvedDeposit, error: approvedFetchError } = await supabase
      .from('deposits')
      .select('*')
      .eq('id', depositId)
      .single()

    if (approvedFetchError) {
      console.error('❌ Failed to fetch approved deposit:', approvedFetchError.message)
      return
    }

    if (approvedDeposit.status !== 'approved') {
      console.error('❌ Expected status "approved", got:', approvedDeposit.status)
      return
    }
    console.log('✅ Deposit status verified:', approvedDeposit.status)

    // 14. Check ledger entry
    console.log('\n14. Checking ledger entry...')
    const { data: ledger, error: ledgerError } = await supabase
      .from('ledger')
      .select('*')
      .eq('reference_id', depositId)
      .eq('type', 'deposit_approved')
      .single()

    if (ledgerError) {
      console.error('❌ Failed to fetch ledger entry:', ledgerError.message)
      return
    }
    console.log('✅ Ledger entry created')

    console.log('\n✅✅✅ All tests passed! ✅✅✅\n')

    // Cleanup
    console.log('Cleaning up test data...')
    await supabase.auth.admin.deleteUser(userId)
    await supabase.auth.admin.deleteUser(adminId)
    console.log('✅ Cleanup complete')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

testDepositFlow()
