# First production owner

This is an explicit hosting-operator workflow. It is never run by deployment, startup, migrations or the public website. It does not create an account, choose a password, copy staging credentials, mark an email verified or enable checkout.

Owner direction on September 11 supersedes the earlier inbox-verification prerequisite for authenticated hosting-owner onboarding: owner administration must be available before email-provider setup. The operator may use explicit hosting-owner approval for the exact existing account. This does not assert that the inbox is verified, change a password, or grant access automatically based on an email match. Ordinary registration and customer verification are unchanged.

1. Identify the existing production account with completed credentials. Use either verified email or an authenticated hosting owner's explicit approval for that exact account. Production email configuration is not required for the hosting-owner method.
2. Confirm the exact production account ID and email against the owner's authorization and existing account. An unverified registration alone does not establish hosting ownership.
3. Run the read-only review inside the production service:

   ```sh
   node --import tsx scripts/establish-initial-owner.ts --user-id VERIFIED_USER_ID --email VERIFIED_EMAIL --approval-reference 'Recorded approval for this exact production owner'
   ```

   For authenticated hosting-owner authorization, add `--hosting-owner-approval 'Recorded authenticated hosting ownership and explicit approval for this exact account'` to both review and apply. Without that option the default remains verified email. The statement is recorded with the ownership basis in the marker and audit; it does not replace authenticating the hosting owner and obtaining authorization.

4. After explicit authorization for that exact account, run the same command with `--apply`. The change grants `SUPER_ADMIN`, records the initial-owner marker and audit entry, and revokes existing sessions atomically. The owner signs in again using their existing credentials. Their customer profile/role remains; View as customer and Admin / Owner switch views. Owner account views do not show an email-verification prompt.

The command requires valid pinned production runtime settings and retained production database identity. It refuses mismatched, deleted or unfinished accounts, unverified accounts without hosting-owner approval, invalid future verification dates, any prior staff account (including deleted staff), competing first-owner claims, and attempts to re-grant previously revoked authority. A repeated successful command for the same still-authorized owner returns the original outcome without another grant or audit event. Failed audit storage rolls the entire action back.

The approval reference records the operator's stated authorization; it is not a substitute for obtaining that authorization. This command is not a general role-management or owner-recovery endpoint. Recover an established owner through the approved existing-account process.

The isolated native tests use a disposable schema inside the guarded loopback CI database. Synthetic verified-account fixtures are not real Google or email-provider acceptance.
