# Admin model and helpers

## How admin is identified

Admins are identified by the value in **public.profiles.role**. Any row in `public.profiles` with `role = 'admin'` is treated as an admin. All other values (e.g. `'user'`, the default) are non-admin.

## How to promote a user to admin

Promotion is done only by a superuser or a service role that can bypass RLS. In the Supabase SQL editor (or any client with sufficient privileges), run an UPDATE on `public.profiles` setting `role = 'admin'` for the chosen profile's `id` (the same as `auth.users.id`). Example in plain English: update the `profiles` table, set the `role` column to the text `'admin'`, where the row's `id` equals the target user's auth id. Users cannot promote themselves because RLS blocks any update that changes `role`.

## Warning

Users must never be allowed to edit their own `role`. The RLS update policy for non-admin users restricts updates so that the new `role` must equal the existing `role`; only admins (or service role) can change roles.
