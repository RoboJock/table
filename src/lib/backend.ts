import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type Unsubscribe,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  assertAllowedFile,
  buildFileDoc,
  cleanFileVisibility,
  cleanSharedWith,
  filePayload,
  newFileId,
  sortFiles,
} from "./files";
import {
  buildMember,
  buildTable,
  cleanDisplayName,
  cleanEmail,
  cleanJoinPolicy,
  cleanSeatLimit,
  cleanSeatNote,
  cleanTableName,
  cleanUid,
  memberPayload,
  newTableId,
  rememberTableId,
  sortMembers,
  sortNotices,
  tablePayload,
} from "./tables";
import type {
  AppUser,
  FileDoc,
  FileVisibility,
  JoinPolicy,
  MemberDoc,
  NoticeDoc,
  TableDoc,
} from "./types";

export type SendNoticeResult = {
  noticeId: string;
  recipientCount: number;
};

export type Backend = {
  configured: boolean;
  subscribe(listener: (user: AppUser | null) => void): Unsubscribe | (() => void);
  register(email: string, password: string, name: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  listOwnedTables(): Promise<TableDoc[]>;
  peekTable(tableId: string): Promise<TableDoc>;
  openTable(tableId: string): Promise<{
    table: TableDoc;
    members: MemberDoc[];
    me: MemberDoc;
    notices: NoticeDoc[];
    files: FileDoc[];
  }>;
  createTable(name: string, seatLimit: number, joinPolicy: JoinPolicy): Promise<TableDoc>;
  updateTableSettings(
    tableId: string,
    name: string,
    seatLimit: number,
    joinPolicy: JoinPolicy,
  ): Promise<void>;
  deleteTable(tableId: string, memberUids: string[], noticeIds: string[]): Promise<void>;
  inviteMember(tableId: string, uid: string, displayName: string): Promise<MemberDoc>;
  joinTable(tableId: string): Promise<MemberDoc>;
  removeMember(tableId: string, uid: string): Promise<void>;
  leaveTable(tableId: string): Promise<void>;
  updateSeat(tableId: string, displayName: string, seatNote: string, email: string): Promise<void>;
  sendNotice(tableId: string, subject: string, body: string): Promise<SendNoticeResult>;
  uploadFile(
    tableId: string,
    file: File,
    visibility: FileVisibility,
    sharedWith: string[],
  ): Promise<FileDoc>;
  updateFileSharing(
    tableId: string,
    fileId: string,
    visibility: FileVisibility,
    sharedWith: string[],
  ): Promise<void>;
  deleteFile(tableId: string, fileId: string): Promise<void>;
  openFile(tableId: string, fileId: string): Promise<void>;
};

export function firebasePublicConfig(): Record<string, string> | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "";
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "";
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() ?? "";
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  const config: Record<string, string> = { apiKey, authDomain, projectId, appId };
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  const sender = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim();
  if (bucket) config.storageBucket = bucket;
  if (sender) config.messagingSenderId = sender;
  return config;
}

function friendly(error: unknown): Error {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const text: Record<string, string> = {
    "auth/operation-not-allowed": "Email sign-in is turned off in the Firebase console.",
    "auth/email-already-in-use": "That email already has an account. Sign in instead.",
    "auth/invalid-credential": "Email or password did not match.",
    "auth/invalid-email": "That email address does not look valid.",
    "auth/weak-password": "Use at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "permission-denied": "Permission denied by the table rules.",
    "not-found": "That table could not be found.",
  };
  if (code && text[code]) return new Error(text[code]);
  if (error instanceof Error && error.message) return error;
  return new Error("Something went wrong. Try again.");
}

/** Last-seat races often surface as permission-denied on the losing write. */
function seatRaceFriendly(error: unknown): Error {
  if (error instanceof Error && /full/i.test(error.message)) return error;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "permission-denied") return new Error("This table is full.");
  return friendly(error);
}

function noticeWorkerUrl(): string {
  return (process.env.NEXT_PUBLIC_NOTICE_WORKER_URL ?? "").trim().replace(/\/$/, "");
}

let firebaseApp: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function services() {
  const config = firebasePublicConfig();
  if (!config) throw new Error("Firebase is not configured. Copy .env.example to .env.local.");
  firebaseApp ??= initializeApp(config);
  auth ??= getAuth(firebaseApp);
  db ??= getFirestore(firebaseApp);
  return { auth, db };
}

function requireUser() {
  const { auth: current } = services();
  const user = current.currentUser;
  if (!user) throw new Error("Sign in first.");
  return user;
}

function asUser(user: { uid: string; displayName: string | null; email: string | null }): AppUser {
  return {
    id: user.uid,
    name: user.displayName?.trim() || "Member",
    email: user.email ?? "",
  };
}

function readTable(id: string, data: Record<string, unknown>): TableDoc {
  if (typeof data.name !== "string" || typeof data.ownerId !== "string" || typeof data.createdAt !== "number") {
    throw new Error("That table document is incomplete.");
  }
  const seatLimit = typeof data.seatLimit === "number" ? data.seatLimit : 40;
  const memberCount = typeof data.memberCount === "number" ? data.memberCount : 1;
  const joinPolicy =
    data.joinPolicy === "inviteOnly" || data.joinPolicy === "firstComeFirstServe"
      ? data.joinPolicy
      : "inviteOnly";
  return {
    id,
    name: data.name,
    ownerId: data.ownerId,
    seatLimit,
    joinPolicy,
    memberCount,
    createdAt: data.createdAt,
  };
}

function readMember(uid: string, data: Record<string, unknown>): MemberDoc {
  if (
    typeof data.displayName !== "string" ||
    (data.role !== "owner" && data.role !== "member") ||
    typeof data.seatNote !== "string" ||
    typeof data.joinedAt !== "number"
  ) {
    throw new Error("That member document is incomplete.");
  }
  const email = typeof data.email === "string" ? data.email : "";
  return {
    uid,
    displayName: data.displayName,
    role: data.role,
    seatNote: data.seatNote,
    email,
    joinedAt: data.joinedAt,
  };
}

function readNotice(id: string, data: Record<string, unknown>): NoticeDoc {
  if (
    typeof data.subject !== "string" ||
    typeof data.body !== "string" ||
    typeof data.sentBy !== "string" ||
    typeof data.sentAt !== "number" ||
    !Array.isArray(data.to)
  ) {
    throw new Error("That notice document is incomplete.");
  }
  return {
    id,
    subject: data.subject,
    body: data.body,
    sentBy: data.sentBy,
    sentAt: data.sentAt,
    to: data.to.filter((item): item is string => typeof item === "string"),
  };
}

function readFile(id: string, data: Record<string, unknown>): FileDoc {
  if (
    typeof data.name !== "string" ||
    typeof data.ownerId !== "string" ||
    typeof data.contentType !== "string" ||
    typeof data.size !== "number" ||
    typeof data.createdAt !== "number" ||
    (data.visibility !== "private" && data.visibility !== "table" && data.visibility !== "shared") ||
    !Array.isArray(data.sharedWith)
  ) {
    throw new Error("That file document is incomplete.");
  }
  return {
    id,
    name: data.name,
    ownerId: data.ownerId,
    contentType: data.contentType,
    size: data.size,
    visibility: data.visibility,
    sharedWith: data.sharedWith.filter((item): item is string => typeof item === "string"),
    createdAt: data.createdAt,
  };
}

async function listAccessibleFiles(store: Firestore, tableId: string, uid: string): Promise<FileDoc[]> {
  const filesRef = collection(store, "tables", tableId, "files");
  const [owned, tableWide, shared] = await Promise.all([
    getDocs(query(filesRef, where("ownerId", "==", uid))),
    getDocs(query(filesRef, where("visibility", "==", "table"))),
    getDocs(query(filesRef, where("visibility", "==", "shared"), where("sharedWith", "array-contains", uid))),
  ]);
  const map = new Map<string, FileDoc>();
  for (const snap of [...owned.docs, ...tableWide.docs, ...shared.docs]) {
    map.set(snap.id, readFile(snap.id, snap.data()));
  }
  return sortFiles([...map.values()]);
}

function notConfiguredBackend(): Backend {
  const missing = () => {
    throw new Error("Firebase is not configured. Copy .env.example to .env.local.");
  };
  return {
    configured: false,
    subscribe(listener) {
      listener(null);
      return () => undefined;
    },
    async register() {
      missing();
    },
    async signIn() {
      missing();
    },
    async signOut() {
      return;
    },
    async listOwnedTables() {
      return [];
    },
    async peekTable() {
      missing();
      return undefined as never;
    },
    async openTable() {
      missing();
      return undefined as never;
    },
    async createTable() {
      missing();
      return undefined as never;
    },
    async updateTableSettings() {
      missing();
    },
    async deleteTable() {
      missing();
    },
    async inviteMember() {
      missing();
      return undefined as never;
    },
    async joinTable() {
      missing();
      return undefined as never;
    },
    async removeMember() {
      missing();
    },
    async leaveTable() {
      missing();
    },
    async updateSeat() {
      missing();
    },
    async sendNotice() {
      missing();
      return undefined as never;
    },
    async uploadFile() {
      missing();
      return undefined as never;
    },
    async updateFileSharing() {
      missing();
    },
    async deleteFile() {
      missing();
    },
    async openFile() {
      missing();
    },
  };
}

export function createBackend(): Backend {
  if (firebasePublicConfig() === null) return notConfiguredBackend();

  return {
    configured: true,
    subscribe(listener) {
      const { auth: current } = services();
      return onAuthStateChanged(current, (user) => {
        listener(user ? asUser(user) : null);
      });
    },
    async register(email, password, name) {
      try {
        const { auth: current } = services();
        const display = cleanDisplayName(name);
        if (password.length < 8) throw new Error("Use at least 8 characters.");
        const created = await createUserWithEmailAndPassword(current, email.trim(), password);
        await updateProfile(created.user, { displayName: display });
      } catch (error) {
        throw friendly(error);
      }
    },
    async signIn(email, password) {
      try {
        const { auth: current } = services();
        await signInWithEmailAndPassword(current, email.trim(), password);
      } catch (error) {
        throw friendly(error);
      }
    },
    async signOut() {
      try {
        const { auth: current } = services();
        await signOut(current);
      } catch (error) {
        throw friendly(error);
      }
    },
    async listOwnedTables() {
      try {
        const user = requireUser();
        const { db: store } = services();
        const snap = await getDocs(query(collection(store, "tables"), where("ownerId", "==", user.uid)));
        return snap.docs
          .map((item) => readTable(item.id, item.data()))
          .sort((a, b) => b.createdAt - a.createdAt);
      } catch (error) {
        throw friendly(error);
      }
    },
    async peekTable(tableId) {
      try {
        requireUser();
        const { db: store } = services();
        const id = tableId.trim();
        if (!id) throw new Error("Choose a table id.");
        const tableSnap = await getDoc(doc(store, "tables", id));
        if (!tableSnap.exists()) {
          throw new Error("That table could not be found, or it is invite only.");
        }
        return readTable(tableSnap.id, tableSnap.data());
      } catch (error) {
        throw friendly(error);
      }
    },
    async openTable(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const id = tableId.trim();
        if (!id) throw new Error("Choose a table id.");
        const tableRef = doc(store, "tables", id);
        const tableSnap = await getDoc(tableRef);
        if (!tableSnap.exists()) throw new Error("That table could not be found, or you are not a member.");
        const table = readTable(tableSnap.id, tableSnap.data());
        const membersSnap = await getDocs(collection(store, "tables", id, "members"));
        const members = sortMembers(membersSnap.docs.map((item) => readMember(item.id, item.data())));
        const me = members.find((member) => member.uid === user.uid);
        if (!me) throw new Error("You are not a member of this table.");
        const noticesSnap = await getDocs(collection(store, "tables", id, "notices"));
        const notices = sortNotices(noticesSnap.docs.map((item) => readNotice(item.id, item.data())));
        const files = await listAccessibleFiles(store, id, user.uid);
        rememberTableId(user.uid, id);
        return { table, members, me, notices, files };
      } catch (error) {
        throw friendly(error);
      }
    },
    async createTable(name, seatLimit, joinPolicy) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const table = buildTable({
          id: newTableId(),
          name,
          ownerId: user.uid,
          seatLimit,
          joinPolicy,
          memberCount: 1,
        });
        const member = buildMember({
          uid: user.uid,
          displayName: user.displayName?.trim() || "Owner",
          role: "owner",
          seatNote: "",
          email: user.email ?? "",
        });
        const tableRef = doc(store, "tables", table.id);
        const memberRef = doc(store, "tables", table.id, "members", member.uid);
        await setDoc(tableRef, tablePayload(table));
        try {
          await setDoc(memberRef, memberPayload(member));
        } catch (error) {
          try {
            await deleteDoc(tableRef);
          } catch {
            // Best-effort cleanup if the owner seat could not be written.
          }
          throw error;
        }
        rememberTableId(user.uid, table.id);
        return table;
      } catch (error) {
        throw friendly(error);
      }
    },
    async updateTableSettings(tableId, name, seatLimit, joinPolicy) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can change table settings.");
        const nextLimit = cleanSeatLimit(seatLimit);
        if (nextLimit < opened.table.memberCount) {
          throw new Error("Seat limit cannot be below the people already at the table.");
        }
        await updateDoc(doc(store, "tables", opened.table.id), {
          name: cleanTableName(name),
          ownerId: opened.table.ownerId,
          seatLimit: nextLimit,
          joinPolicy: cleanJoinPolicy(joinPolicy),
          memberCount: opened.table.memberCount,
          createdAt: opened.table.createdAt,
        });
        rememberTableId(user.uid, opened.table.id);
      } catch (error) {
        throw friendly(error);
      }
    },
    async deleteTable(tableId, memberUids, noticeIds) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner" || opened.table.ownerId !== user.uid) {
          throw new Error("Only the owner can delete this table.");
        }
        const batch = writeBatch(store);
        for (const uid of memberUids) {
          batch.delete(doc(store, "tables", opened.table.id, "members", uid));
        }
        for (const noticeId of noticeIds) {
          batch.delete(doc(store, "tables", opened.table.id, "notices", noticeId));
        }
        batch.delete(doc(store, "tables", opened.table.id));
        await batch.commit();
      } catch (error) {
        throw friendly(error);
      }
    },
    async inviteMember(tableId, uid, displayName) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const invitee = cleanUid(uid);
        if (invitee === user.uid) throw new Error("You are already at this table.");

        const member = await runTransaction(store, async (tx) => {
          const tableRef = doc(store, "tables", tableId.trim());
          const tableSnap = await tx.get(tableRef);
          if (!tableSnap.exists()) throw new Error("That table could not be found.");
          const table = readTable(tableSnap.id, tableSnap.data());
          if (table.ownerId !== user.uid) throw new Error("Only the owner can invite members.");

          const memberRef = doc(store, "tables", table.id, "members", invitee);
          const existing = await tx.get(memberRef);
          if (existing.exists()) throw new Error("That account is already a member.");
          if (table.memberCount >= table.seatLimit) {
            throw new Error("This table is full.");
          }

          const next = buildMember({
            uid: invitee,
            displayName: displayName.trim() ? displayName : "Member",
            role: "member",
            seatNote: "",
            email: "",
          });
          tx.set(memberRef, memberPayload(next));
          tx.update(tableRef, {
            name: table.name,
            ownerId: table.ownerId,
            seatLimit: table.seatLimit,
            joinPolicy: table.joinPolicy,
            memberCount: table.memberCount + 1,
            createdAt: table.createdAt,
          });
          return next;
        });
        return member;
      } catch (error) {
        throw seatRaceFriendly(error);
      }
    },
    async joinTable(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const id = tableId.trim();
        if (!id) throw new Error("Choose a table id.");

        const member = await runTransaction(store, async (tx) => {
          const tableRef = doc(store, "tables", id);
          const tableSnap = await tx.get(tableRef);
          if (!tableSnap.exists()) {
            throw new Error("That table could not be found, or it is invite only.");
          }
          const table = readTable(tableSnap.id, tableSnap.data());
          if (table.joinPolicy !== "firstComeFirstServe") {
            throw new Error("This table is invite only. Ask the owner to invite your account id.");
          }

          const memberRef = doc(store, "tables", table.id, "members", user.uid);
          const existing = await tx.get(memberRef);
          if (existing.exists()) throw new Error("You are already at this table.");
          if (table.memberCount >= table.seatLimit) {
            throw new Error("This table is full.");
          }

          const next = buildMember({
            uid: user.uid,
            displayName: user.displayName?.trim() || "Member",
            role: "member",
            seatNote: "",
            email: user.email ?? "",
          });
          tx.set(memberRef, memberPayload(next));
          tx.update(tableRef, {
            name: table.name,
            ownerId: table.ownerId,
            seatLimit: table.seatLimit,
            joinPolicy: table.joinPolicy,
            memberCount: table.memberCount + 1,
            createdAt: table.createdAt,
          });
          return next;
        });
        rememberTableId(user.uid, id);
        return member;
      } catch (error) {
        throw seatRaceFriendly(error);
      }
    },
    async removeMember(tableId, uid) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const target = cleanUid(uid);
        await runTransaction(store, async (tx) => {
          const tableRef = doc(store, "tables", tableId.trim());
          const tableSnap = await tx.get(tableRef);
          if (!tableSnap.exists()) throw new Error("That table could not be found.");
          const table = readTable(tableSnap.id, tableSnap.data());
          if (table.ownerId !== user.uid) throw new Error("Only the owner can remove members.");
          if (target === table.ownerId) {
            throw new Error("The owner cannot be removed. Delete the table instead.");
          }
          const memberRef = doc(store, "tables", table.id, "members", target);
          const memberSnap = await tx.get(memberRef);
          if (!memberSnap.exists()) throw new Error("That member is not at this table.");
          tx.delete(memberRef);
          tx.update(tableRef, {
            name: table.name,
            ownerId: table.ownerId,
            seatLimit: table.seatLimit,
            joinPolicy: table.joinPolicy,
            memberCount: Math.max(1, table.memberCount - 1),
            createdAt: table.createdAt,
          });
        });
      } catch (error) {
        throw friendly(error);
      }
    },
    async leaveTable(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        await runTransaction(store, async (tx) => {
          const tableRef = doc(store, "tables", tableId.trim());
          const tableSnap = await tx.get(tableRef);
          if (!tableSnap.exists()) throw new Error("That table could not be found.");
          const table = readTable(tableSnap.id, tableSnap.data());
          if (table.ownerId === user.uid) {
            throw new Error("The owner cannot leave. Delete the table, or transfer ownership in a later version.");
          }
          const memberRef = doc(store, "tables", table.id, "members", user.uid);
          const memberSnap = await tx.get(memberRef);
          if (!memberSnap.exists()) throw new Error("You are not a member of this table.");
          tx.delete(memberRef);
          tx.update(tableRef, {
            name: table.name,
            ownerId: table.ownerId,
            seatLimit: table.seatLimit,
            joinPolicy: table.joinPolicy,
            memberCount: Math.max(1, table.memberCount - 1),
            createdAt: table.createdAt,
          });
        });
      } catch (error) {
        throw friendly(error);
      }
    },
    async updateSeat(tableId, displayName, seatNote, email) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        await updateDoc(doc(store, "tables", opened.table.id, "members", user.uid), {
          displayName: cleanDisplayName(displayName),
          role: opened.me.role,
          seatNote: cleanSeatNote(seatNote),
          email: cleanEmail(email),
          joinedAt: opened.me.joinedAt,
        });
      } catch (error) {
        throw friendly(error);
      }
    },
    async sendNotice(tableId, subject, body) {
      try {
        const user = requireUser();
        const base = noticeWorkerUrl();
        if (!base) {
          throw new Error("Notice sending is not configured yet.");
        }
        const token = await user.getIdToken();
        const response = await fetch(`${base}/sendNotice`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tableId: tableId.trim(),
            subject,
            body,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          noticeId?: unknown;
          recipientCount?: unknown;
          error?: unknown;
        };
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" && payload.error
              ? payload.error
              : "That notice could not be sent.",
          );
        }
        if (typeof payload.noticeId !== "string" || typeof payload.recipientCount !== "number") {
          throw new Error("The notice server returned an incomplete response.");
        }
        return {
          noticeId: payload.noticeId,
          recipientCount: payload.recipientCount,
        };
      } catch (error) {
        throw friendly(error);
      }
    },
    async uploadFile(tableId, file, visibility, sharedWith) {
      const user = requireUser();
      const { db: store } = services();
      const base = noticeWorkerUrl();
      if (!base) throw new Error("File storage is not configured yet.");
      const checked = assertAllowedFile({ name: file.name, type: file.type, size: file.size });
      const docFile = buildFileDoc({
        id: newFileId(),
        name: checked.name,
        ownerId: user.uid,
        contentType: checked.contentType,
        size: checked.size,
        visibility: cleanFileVisibility(visibility),
        sharedWith,
      });
      const fileRef = doc(store, "tables", tableId.trim(), "files", docFile.id);
      await setDoc(fileRef, filePayload(docFile));
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${base}/files/upload`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": checked.contentType,
            "X-Table-Id": tableId.trim(),
            "X-File-Id": docFile.id,
          },
          body: file,
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" && payload.error
              ? payload.error
              : "That file could not be uploaded.",
          );
        }
        return docFile;
      } catch (error) {
        try {
          await deleteDoc(fileRef);
        } catch {
          // Best-effort metadata cleanup if bytes never landed.
        }
        throw friendly(error);
      }
    },
    async updateFileSharing(tableId, fileId, visibility, sharedWith) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const fileRef = doc(store, "tables", tableId.trim(), "files", fileId.trim());
        const snap = await getDoc(fileRef);
        if (!snap.exists()) throw new Error("That file could not be found.");
        const current = readFile(snap.id, snap.data());
        if (current.ownerId !== user.uid) throw new Error("Only the uploader can change sharing.");
        const nextVisibility = cleanFileVisibility(visibility);
        const nextShared =
          nextVisibility === "shared" ? cleanSharedWith(sharedWith, user.uid) : [];
        if (nextVisibility === "shared" && nextShared.length === 0) {
          throw new Error("Pick at least one person to share with, or choose another option.");
        }
        await updateDoc(fileRef, {
          name: current.name,
          ownerId: current.ownerId,
          contentType: current.contentType,
          size: current.size,
          visibility: nextVisibility,
          sharedWith: nextShared,
          createdAt: current.createdAt,
        });
      } catch (error) {
        throw friendly(error);
      }
    },
    async deleteFile(tableId, fileId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const base = noticeWorkerUrl();
        if (!base) throw new Error("File storage is not configured yet.");
        const fileRef = doc(store, "tables", tableId.trim(), "files", fileId.trim());
        const snap = await getDoc(fileRef);
        if (!snap.exists()) throw new Error("That file could not be found.");
        const current = readFile(snap.id, snap.data());
        if (current.ownerId !== user.uid) throw new Error("Only the uploader can delete this file.");
        const token = await user.getIdToken();
        const response = await fetch(
          `${base}/files/object?tableId=${encodeURIComponent(tableId.trim())}&fileId=${encodeURIComponent(fileId.trim())}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" && payload.error
              ? payload.error
              : "That file could not be deleted.",
          );
        }
        await deleteDoc(fileRef);
      } catch (error) {
        throw friendly(error);
      }
    },
    async openFile(tableId, fileId) {
      try {
        const user = requireUser();
        const base = noticeWorkerUrl();
        if (!base) throw new Error("File storage is not configured yet.");
        const token = await user.getIdToken();
        const response = await fetch(
          `${base}/files/download?tableId=${encodeURIComponent(tableId.trim())}&fileId=${encodeURIComponent(fileId.trim())}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
          throw new Error(
            typeof payload.error === "string" && payload.error
              ? payload.error
              : "That file could not be opened.",
          );
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } catch (error) {
        throw friendly(error);
      }
    },
  };
}
