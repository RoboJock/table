# Table

A shared table for a small group. The owner invites members by account id. Each member edits only their own seat. Strangers and signed-out visitors get nothing.

Members can also send a short **notice email** to everyone at the table who saved a reminder email on their seat. The browser calls a Cloudflare Worker; the Resend API key stays in the Worker’s secrets and never ships in the client bundle.

Accounts use Firebase Authentication (email/password). Data uses Cloud Firestore. Hosting uses Firebase Hosting with the static export in `out/`. Notices use a Cloudflare Worker + Resend (free-tier friendly).

The Firebase project is `shared-table-b46f`. The public site is [https://shared-table-b46f.web.app](https://shared-table-b46f.web.app).

## Permission brief

1. Product: shared table for a small group; owner invites; members edit only their own seat; any member can ask the server to email a notice to seats that have an email saved.

2. Collections:
   - `tables/{id}` → `name`, `ownerId`, `createdAt`
   - `tables/{id}/members/{uid}` → `displayName`, `role` (`"owner"` | `"member"`), `seatNote`, `email`, `joinedAt`
   - `tables/{id}/notices/{noticeId}` → `subject`, `body`, `sentBy`, `sentAt`, `to` (written after the Worker sends mail)

3. Roles: owner, member, signed-in stranger, signed-out visitor

4. Allow:
   - members of a table can read that table, its member list, and its notice log
   - signed-in user can create a table with `ownerId` = their uid, and write themselves as owner in members
   - owner can invite/remove members, rename, delete the table (and its notice docs)
   - member can update only their own `seatNote`, `displayName`, and `email`; can leave by deleting their own member doc
   - Worker `POST /sendNotice`: signed-in caller who is a member; Worker sends mail with the server Resend key and writes the notice log

5. Deny:
   - signed-in non-member cannot read `tables/{id}` even if they know the id
   - member cannot edit another member’s seat fields
   - member cannot change `ownerId` or promote themselves to owner
   - signed-out visitor cannot read any table or member document
   - signed-out / non-member cannot send a notice (Worker returns unauthorized; no mail)
   - notice documents cannot be updated by clients; `RESEND_API_KEY` is never in the web app

## Notice Worker (Cloudflare)

```bash
cd worker
npm install
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler deploy
```

Use a Resend test sender such as `Table <onboarding@resend.dev>` for `RESEND_FROM` until you verify your own domain. Put the Worker URL in `.env.local` as `NEXT_PUBLIC_NOTICE_WORKER_URL`.

## Run it

```bash
npm install
npm test
npm --prefix worker install
npm run test:worker
npm run dev
```

Deploy the site and rules:

```bash
npm test && npm run build
firebase deploy --only firestore:rules,hosting
```
