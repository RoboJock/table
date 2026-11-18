# Table

A shared table for a small group. The owner sets a seat limit and chooses **Invite only** or **First come, first serve**. Members edit only their own seat. Strangers and signed-out visitors get nothing on invite-only tables.

Members can also send a short **notice email** to everyone who saved a reminder email. The browser calls a Cloudflare Worker; the Resend API key stays in Worker secrets.

Members can upload **files** (images or PDFs, max 5 MB) to a personal inventory and choose **Only you**, **Everyone at this table**, or **Shared with selected people**. File bytes live in Cloudflare R2 behind the same Worker membership checks; metadata lives in Firestore.

Accounts use Firebase Authentication (email/password). Data uses Cloud Firestore. Hosting uses Firebase Hosting (`out/`). Notices use a Cloudflare Worker + Resend.

The Firebase project is `shared-table-b46f`. The public site is [https://shared-table-b46f.web.app](https://shared-table-b46f.web.app).

## Permission brief

1. Product: shared table with a max member count; owner invites and/or opens first-come seats; members edit only their own seat; members can ask the server to email a notice.

2. Collections:
   - `tables/{id}` → `name`, `ownerId`, `seatLimit`, `joinPolicy` (`inviteOnly` | `firstComeFirstServe`), `memberCount`, `createdAt`
   - `tables/{id}/members/{uid}` → `displayName`, `role`, `seatNote`, `email`, `joinedAt`
   - `tables/{id}/notices/{noticeId}` → `subject`, `body`, `sentBy`, `sentAt`, `to`
   - `tables/{id}/files/{fileId}` → `name`, `ownerId`, `contentType`, `size`, `visibility` (`private` | `table` | `shared`), `sharedWith`, `createdAt`

3. Roles: owner, member, signed-in stranger, signed-out visitor

4. Allow:
   - members read table, members, notices
   - first-come tables are readable by signed-in users so they can see open seats
   - create table with seat limit and join policy; owner seat counts as 1
   - owner invites only while `memberCount < seatLimit` (transaction)
   - first-come join by table id under the same transaction cap
   - owner may raise seat limit / change join policy; cannot set limit below current members
   - member updates own seat fields; leave frees a seat
   - Worker `sendNotice` for members only
   - members upload files to their inventory; uploader always reads/deletes; `table` visibility for all members; `shared` for listed uids

5. Deny:
   - invite/join when full → “This table is full.”
   - two concurrent last-seat joins → only one succeeds
   - invite-only stranger cannot read or join
   - signed-out visitor gets nothing
   - strangers cannot read private/shared files they are not listed on
   - oversize / wrong type refused
   - `RESEND_API_KEY` never in the web app

## Notice Worker

```bash
cd worker
npm install
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler deploy
```

Set `NEXT_PUBLIC_NOTICE_WORKER_URL` to the Worker URL.

## Run it

```bash
npm install
npm test
npm --prefix worker install
npm run test:worker
npm run dev
```

```bash
npm test && npm run build
firebase deploy --only firestore:rules,hosting
```
