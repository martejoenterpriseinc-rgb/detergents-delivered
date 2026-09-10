# First production owner

This is an explicit hosting-operator workflow. It is never run by deployment, startup, migrations or the public website. It does not create an account, choose a password, copy staging credentials, mark an email verified or enable checkout.

1. Configure the intended production identity provider securely in hosting. A successful production Google sign-in creates a customer account only, with the existing verified-email checks. Alternatively use an existing account whose email was verified through an approved ownership-verification flow.
2. Confirm the exact production account ID and email with the owner. Do not infer ownership from a similar email, a staging role or an unverified registration.
3. Run the read-only review inside the production service:

   ```sh
   node --import tsx scripts/establish-initial-owner.ts --user-id VERIFIED_USER_ID --email VERIFIED_EMAIL --approval-reference 'Recorded approval for this exact production owner'
   ```

4. After explicit authorization for that exact account, run the same command with `--apply`. The change grants `SUPER_ADMIN`, records the initial-owner marker and audit entry, and revokes existing sessions atomically. The owner signs in again using their existing credentials.

The command requires valid pinned production runtime settings and retained production database identity. It refuses mismatched, unverified, deleted or unfinished accounts, any prior staff account (including deleted staff), competing first-owner claims, and attempts to re-grant previously revoked authority. A repeated successful command for the same still-authorized owner returns the original outcome without another grant or audit event. Failed audit storage rolls the entire action back.

The approval reference records the operator's stated authorization; it is not a substitute for obtaining that authorization. This command is not a general role-management or owner-recovery endpoint. Recover an established owner through the approved existing-account process.

The isolated native tests use a disposable schema inside the guarded loopback CI database. Synthetic verified-account fixtures are not real Google or email-provider acceptance.
