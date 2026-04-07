# Database Rules & Access Control

## Actors

### Guest
- Unauthenticated users
- Can view public game data only
- Cannot place bets
- Cannot access wallet or transaction data

### User
- Authenticated users (via Supabase Auth)
- Can view public game data
- Can place bets
- Can view own wallet balance
- Can view own deposits and withdrawals
- Can initiate deposit requests (STK Push)
- Can create withdrawal requests
- Cannot modify wallet balance directly
- Cannot view other users' data

### Admin
- Authenticated users with admin role (identified by email pattern or metadata)
- Can view all public and private data
- Can view all user wallets
- Can view all transactions
- Can view next round preview before it goes live
- Can view live player counts and statistics
- Can view daily deposit totals and charts
- Can manually process withdrawal requests
- Cannot modify wallet balances directly (must use Edge Functions or admin tools)

## Ownership Rules

### Wallet Ownership
- Each user has exactly one wallet row
- Wallet `user_id` must match authenticated user's `auth.uid()`
- Users can only SELECT their own wallet
- Users cannot INSERT, UPDATE, or DELETE wallet rows
- Wallet balance changes only via:
  - Edge Functions (STK callback, admin actions)
  - Admin tools (with proper audit trail)

### Bet Ownership
- Bets are owned by the user who created them (`user_id`)
- Users can SELECT their own bets
- Users can INSERT bets (place bets)
- Users cannot UPDATE or DELETE bets after placement
- Bets are immutable once created

### Deposit Ownership
- Deposits are owned by the user who initiated them (`user_id`)
- Users can SELECT their own deposits
- Users can INSERT deposit requests (initiate STK)
- Edge Functions can UPDATE deposit status
- Users cannot UPDATE or DELETE deposits

### Withdrawal Request Ownership
- Withdrawal requests are owned by the user who created them (`user_id`)
- Users can SELECT their own withdrawal requests
- Users can INSERT withdrawal requests
- Only admins can UPDATE withdrawal request status
- Users cannot DELETE withdrawal requests

## Real-Money Wallet Rules

### Balance Integrity
- Wallet balance must never be negative
- All balance changes must be audited in ledger
- Balance calculations must be atomic (use database transactions)
- No client-side balance mutations allowed

### Balance Sources
- Initial balance: 0 (on wallet creation)
- Increases: Successful deposits (STK callback)
- Decreases: Successful withdrawals (admin processed)
- Betting: Does not affect wallet balance (bets are separate)
- Winnings: Credited via separate mechanism (not wallet balance)

### Wallet Lifecycle
- Wallet created automatically on user registration
- Wallet persists for user lifetime
- Wallet cannot be deleted by user
- Wallet deletion requires admin action (if ever needed)

## Deposit (STK) Rules

### Initiation
- User initiates deposit via Edge Function `/stk/initiate`
- Edge Function validates amount (min/max limits)
- Edge Function creates deposit record with status `pending`
- Edge Function initiates STK Push via payment provider
- Frontend receives reference/request ID

### Processing
- Payment provider sends callback to Edge Function
- Edge Function validates callback signature
- Edge Function updates deposit status to `completed` or `failed`
- On `completed`: Edge Function atomically updates wallet balance
- Edge Function creates ledger entry for audit

### Status Flow
- `pending` → `completed` (successful payment)
- `pending` → `failed` (payment failed or cancelled)
- `pending` → `expired` (timeout)

### Limits
- Minimum deposit: Defined in database rules/config
- Maximum deposit: Defined in database rules/config
- Rate limiting: Per user, per time period

## Withdrawal (Manual) Rules

### Request Creation
- User creates withdrawal request via frontend
- Request includes: amount, phone number, user_id
- Request status: `pending`
- Request validated: amount <= wallet balance, amount >= minimum
- Request cannot exceed wallet balance

### Processing
- Only admins can process withdrawal requests
- Admin reviews request
- Admin updates status to `approved` or `rejected`
- On `approved`: Admin manually sends payment
- Admin updates status to `completed` after payment sent
- On `completed`: Wallet balance decreased atomically
- Ledger entry created for audit

### Status Flow
- `pending` → `approved` (admin approved)
- `pending` → `rejected` (admin rejected)
- `approved` → `completed` (payment sent)
- `approved` → `failed` (payment failed)

### Limits
- Minimum withdrawal: Defined in database rules/config
- Maximum withdrawal: Defined in database rules/config
- Withdrawal frequency: Per user, per time period

## Ledger/Audit Rules

### Purpose
- Immutable record of all wallet balance changes
- Traceability for all financial transactions
- Compliance and dispute resolution

### Entries
- Every wallet balance change creates a ledger entry
- Ledger entries are immutable (INSERT only, no UPDATE/DELETE)
- Ledger entries include:
  - `user_id`: Owner of the wallet
  - `transaction_type`: `deposit`, `withdrawal`, `admin_adjustment`
  - `amount`: Positive for increases, negative for decreases
  - `balance_before`: Wallet balance before transaction
  - `balance_after`: Wallet balance after transaction
  - `reference_id`: Link to deposit/withdrawal record
  - `created_at`: Timestamp
  - `metadata`: Additional context (JSON)

### Access
- Users can SELECT their own ledger entries
- Admins can SELECT all ledger entries
- No one can INSERT ledger entries directly (only Edge Functions/Admin tools)
- No one can UPDATE or DELETE ledger entries

### Integrity
- Ledger entries must match wallet balance changes
- Balance calculations must reconcile with ledger sum
- Discrepancies trigger alerts for admin review

## Public vs Private Data

### Public Data (Readable by Anyone)
- `current_round`: Current game round data (multiplier, state)
- `rounds`: Historical round data (read-only)
- `round_history`: Public round history
- `winners`: Public winner announcements
- Game statistics and leaderboards

### Private Data (User-Specific)
- `wallets`: User's own wallet only
- `deposits`: User's own deposits only
- `withdrawal_requests`: User's own requests only
- `bets`: User's own bets only
- `ledger`: User's own ledger entries only

### Admin-Only Data
- All user wallets (aggregated view)
- All deposits (all users)
- All withdrawal requests (all users)
- All bets (all users)
- All ledger entries (all users)
- Next round preview (before it goes live)
- Live player statistics
- Daily deposit totals and charts

## Realtime Visibility Rules

### Public Realtime Subscriptions
- `current_round`: Multiplier updates, state changes
- `rounds`: New round starts
- `winners`: New winner announcements
- All users (including guests) can subscribe

### Private Realtime Subscriptions
- `wallets`: User's own wallet balance changes
- `deposits`: User's own deposit status updates
- `withdrawal_requests`: User's own request status updates
- `bets`: User's own bet updates
- Only authenticated users can subscribe to their own data

### Admin Realtime Subscriptions
- All tables: Admins can subscribe to all data
- Aggregated statistics: Live player counts, deposit totals
- Next round preview: See upcoming rounds before they go live

### Subscription Filters
- RLS (Row Level Security) automatically filters subscriptions
- Users only receive updates for rows they can SELECT
- Admins receive updates for all rows
- Public subscriptions only receive public data

## Security Rules Summary

1. **No Client-Side Mutations**: Wallet balances, deposits, withdrawals can only be modified via Edge Functions or admin tools
2. **RLS Enforcement**: All tables must have Row Level Security policies matching these rules
3. **Audit Trail**: All financial transactions must create ledger entries
4. **Atomic Operations**: Balance changes must be atomic (use database transactions)
5. **Validation**: All amounts must be validated (min/max limits, balance checks)
6. **Immutability**: Ledger entries, bets, and historical data cannot be modified or deleted
