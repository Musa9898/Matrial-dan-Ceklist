# Supabase Login Setup

The app uses email and password for invited users only; it has no public registration form. Supabase persists the verified session so a returning user can stay signed in. The optional checkbox remembers only the email address on that device. The app never saves passwords; users may allow their browser's password manager to save them.

## Configure Supabase

1. Create a Supabase project and copy its Project URL and publishable key into `supabase-config.js`. The publishable key is intended for browser use. Never put a `service_role` or secret key in this file.
2. In Supabase SQL Editor, run `supabase-setup.sql`.
3. In Authentication settings, enable Email/password, disable public sign-ups, and configure the production site URL plus the exact redirect URL for the app. For local testing, serve this folder over HTTP (for example, VS Code Live Server); opening `index.html` as `file://` cannot complete authentication redirects.
4. Invite each employee from Supabase Authentication. The invite link opens the app's set-password form. In the SQL Editor, add that invited user's Auth UUID to `public.project_access`, along with their employee ID, full name, approved role, and assigned project. Users cannot edit this table from the app.
5. Enable and require TOTP multi-factor authentication for staff accounts where the Supabase plan and workflow support it. Secure the employees' email accounts as well, since email access controls magic-link login.

The supported profile roles include `Administrator`. This labels the account and grants access only to its assigned project; it does not create an in-app user-management panel or protect the app's browser-stored project data.

Example access assignment (replace every value with real data):

```sql
insert into public.project_access
  (user_id, employee_id, full_name, role, project_id, project_name)
values
  ('00000000-0000-0000-0000-000000000000', 'EMP-001', 'Nama Karyawan', 'Logistik', 'sentral-tower', 'Proyek Sentral Tower');
```

## Security Boundary

Authentication and the access-profile lookup are server-verified, and row-level security limits profile reads to the signed-in user. This does **not** yet protect the app's material, checklist, report, or file data: those are still stored in browser storage. Do not use this build as production data security until those records and file uploads are migrated to Supabase tables/storage with project-membership RLS policies. No login system can guarantee that an account is impossible to compromise; use MFA, HTTPS, restricted invitations, and secure email accounts.