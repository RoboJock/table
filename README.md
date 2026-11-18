# Table

A shared table for a small group. The owner invites members by account id. Each member edits only their own seat. Strangers and signed-out visitors get nothing.

Members can also send a short **notice email** to everyone at the table who saved a notice email on their seat. The browser calls a Cloud Function; the Resend API key stays in the function’s environment and never ships in the client bundle.

Accounts use Firebase Authentication (email/password). Data uses Cloud Firestore. Hosting uses Firebase Hosting with the static export in `out/`. Notices use Cloud Functions + Resend.

The Firebase project is `shared-table-b46f`. The public site is [https://shared-table-b46f.web.app](https://shared-table-b46f.web.app).

## Permission brief

1. Product: shared table for a small group; owner invites; members edit only their own seat; any member can ask the server to email a notice to seats that have an email saved.

2. Collections:
   - `tables/{id}` → `name`, `ownerId`, `createdAt`
   - `tables/{id}/members/{uid}` → `displayName`, `role` (`"owner"` | `"member"`), `seatNote`, `email`, `joinedAt`
   - `tables/{id}/notices/{noticeId}` → `subject`, `body`, `sentBy`, `sentAt`, `to` (written by the Cloud Function)

3. Roles: owner, member, signed-in stranger, signed-out visitor

4. Allow:
   - members of a table can read that table, its member list, and its notice log
   - signed-in user can create a table with `ownerId` = their uid, and write themselves as owner in members
   - owner can invite/remove members, rename, delete the table (and its notice docs)
   - member can update only their own `seatNote`, `displayName`, and `email`; can leave by deleting their own member doc
   - callable `sendNotice`: signed-in caller who is a member; function sends mail with the server Resend key and writes the notice log

5. Deny:
   - signed-in non-member cannot read `tables/{id}` even if they know the id
   - member cannot edit another member’s seat fields
   - member cannot change `ownerId` or promote themselves to owner
   - signed-out visitor cannot read any table or member document
   - signed-out / non-member cannot send a notice (function returns unauthorized; no mail)
   - clients cannot create or update notice documents; `RESEND_API_KEY` is never in the web app

## Server secrets

Cloud Functions secrets (set in Firebase, not committed):

```bash
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set RESEND_FROM
```

Use a Resend test sender such as `Table <onboarding@resend.dev>` for `RESEND_FROM` until you verify your own domain. See `functions/.env.example`.

## Run it

```bash
npm install
npm test
npm --prefix functions install
npm run test:functions
npm run dev
```

Build and deploy (Blaze plan required for Functions):

```bash
npm test && npm run build
npm --prefix functions install && npm run build:functions
firebase deploy --only firestore:rules,functions,hosting
```
