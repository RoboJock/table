# Table

A shared table for a small group. The owner sets a seat limit and chooses **Invite only** or **First come, first serve**. People join with a **6-character join code** instead of pasting account ids. The room updates **live** as seats change, shows **who’s here now**, keeps a **chat** for people at the table, and an **activity feed** records joins, leaves, notices, and settings changes. Members can **export** a JSON copy of the table. Owners can **archive** a table (soft delete) and restore it later, or delete forever. Firestore keeps a local cache so a short disconnect still lets you read and edit; a banner appears until you are back online and synced.

Members edit only their own seat. Signed-out visitors get nothing.

Members can also send a short **notice email** to everyone who saved a reminder email. The browser calls a Cloudflare Worker; the Resend API key stays in Worker secrets.

Members can upload **files** (images or PDFs, max 5 MB) when Cloudflare R2 is enabled (backlog if billing is required). Metadata and visibility rules already live in Firestore.

Accounts use Firebase Authentication (email/password). Data uses Cloud Firestore. Hosting uses Firebase Hosting (`out/`). Notices use a Cloudflare Worker + Resend.

The Firebase project is `shared-table-b46f`. The public site is [https://shared-table-b46f.web.app](https://shared-table-b46f.web.app).

## Permission brief

1. Product: shared table with a max member count; share a join code; live member list + activity feed; members edit only their own seat; members can ask the server to email a notice.

2. Collections:
   - `tables/{id}` → `name`, `ownerId`, `joinCode`, `seatLimit`, `joinPolicy`, `memberCount`, `archived`, `archivedAt`, `createdAt`
   - `joinCodes/{code}` → public peek fields for a code (`tableId`, `name`, seats, policy, `ownerId`)
   - `tables/{id}/members/{uid}` → `displayName`, `role`, `seatNote`, `email`, `joinedAt`
   - `tables/{id}/notices/{noticeId}` → `subject`, `body`, `sentBy`, `sentAt`, `to`
   - `tables/{id}/activity/{activityId}` → `type`, `actorId`, `actorName`, `summary`, `createdAt`
   - `tables/{id}/messages/{messageId}` → `body`, `authorId`, `authorName`, `createdAt`
   - `tables/{id}/presence/{uid}` → `displayName`, `lastSeen` (fresh heartbeats = here now)
   - `tables/{id}/files/{fileId}` → `name`, `ownerId`, `contentType`, `size`, `visibility`, `sharedWith`, `createdAt`

3. Roles: owner, member, signed-in stranger, signed-out visitor

4. Allow:
   - signed-in `get` of a table by id (needed for join transactions); listing stays narrow
   - signed-in read of `joinCodes/{code}` when you know the code
   - members live-read table, members, notices, activity
   - create table with seat limit, join policy, and join code; owner seat counts as 1
   - join by code for both policies while seats remain (transaction)
   - owner may raise seat limit / change join policy / rotate join code
   - member updates own seat fields; leave frees a seat
   - Worker `sendNotice` for members only

5. Deny:
   - join when full → “This table is full.”
   - two concurrent last-seat joins → only one succeeds
   - unknown join code cannot find the table
   - signed-out visitor gets nothing
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
