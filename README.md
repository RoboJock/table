# Table

A shared table for a small group. The owner invites members by account id. Each member edits only their own seat. Strangers and signed-out visitors get nothing.

Accounts use Firebase Authentication (email/password). Data uses Cloud Firestore. Hosting can use Firebase Hosting with the static export in `out/`, the same pattern as Shelf and Study Deck.

## Permission brief

1. Product: shared table for a small group; owner invites; members edit only their own seat.

2. Collections:
   - `tables/{id}` → `name`, `ownerId`, `createdAt`
   - `tables/{id}/members/{uid}` → `displayName`, `role` (`"owner"` | `"member"`), `seatNote`, `joinedAt`

3. Roles: owner, member, signed-in stranger, signed-out visitor.

4. Allow:
   - members of a table can read that table and its member list
   - signed-in user can create a table with `ownerId` = their uid, and write themselves as owner in members
   - owner can invite/remove members, rename, delete the table
   - member can update only their own `seatNote` and `displayName`; can leave by deleting their own member doc

5. Deny:
   - signed-in non-member cannot read `tables/{id}` even if they know the id
   - member cannot edit another member’s `seatNote` or `displayName`
   - member cannot change `ownerId` or promote themselves to owner
   - signed-out visitor cannot read any table or member document

The rules in `firestore.rules` implement that brief. Invite is by Auth uid: the owner pastes the other person’s account id from the home page after they sign in.

## Run it

```bash
npm install
npm test
npm run dev
```

Copy `.env.example` to `.env.local` and paste the web app config from Firebase Project settings. Those values are the public client config, not a service account. Do not commit `.env.local`.

## Before the app can save data

1. Create a Firebase project and a web app.
2. In Authentication, enable the Email/Password provider.
3. Create a Cloud Firestore database in production mode.
4. Put the project id in `.firebaserc`.
5. Deploy rules, then hosting after a build:

```bash
npm run build
npx firebase-tools deploy --only firestore:rules,hosting
```

Authorized domains should include `localhost` and your `*.web.app` / `*.firebaseapp.com` hosts.

## Prove the deny cases

1. Create two accounts. From account A, create a table and invite B’s account id.
2. From account B, open the table id and edit only B’s seat.
3. From a third signed-in account, open the same table id and confirm the read is denied.
4. From B, try to change another seat or the owner field and confirm the write is denied.
5. From a signed-out window, confirm the table does not load.

GitHub Actions runs `npm test` and `npm run build` on every push.
