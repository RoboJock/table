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
  initializeFirestore,
  onSnapshot,
  onSnapshotsInSync,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import { activityPayload, buildActivity, sortActivity } from "./activity";
import { buildChatMessage, chatPayload, sortChat } from "./chat";
import {
  buildTableExport,
  downloadTextFile,
  tableExportFilename,
  tableExportJson,
} from "./export";
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
  buildPresence,
  filterPresent,
  PRESENCE_HEARTBEAT_MS,
  presencePayload,
} from "./presence";
import {
  buildMember,
  buildTable,
  cleanDisplayName,
  cleanEmail,
  cleanJoinCode,
  cleanJoinPolicy,
  cleanSeatLimit,
  cleanSeatNote,
  cleanTableName,
  cleanUid,
  joinCodePayload,
  memberPayload,
  newJoinCode,
  newTableId,
  rememberTableId,
  sortMembers,
  sortNotices,
  tableFieldsForCountBump,
  tablePayload,
} from "./tables";
import type { ConnectionState } from "./offline";
import type {
  ActivityDoc,
  AppUser,
  ChatMessage,
  FileDoc,
  FileVisibility,
  JoinCodeDoc,
  JoinPolicy,
  MemberDoc,
  NoticeDoc,
  PresenceDoc,
  TableDoc,
} from "./types";

export type SendNoticeResult = {
  noticeId: string;
  recipientCount: number;
};

export type TableRoomSnapshot = {
  table: TableDoc;
  members: MemberDoc[];
  me: MemberDoc;
  notices: NoticeDoc[];
  files: FileDoc[];
  activity: ActivityDoc[];
  presence: PresenceDoc[];
  messages: ChatMessage[];
};

export type Backend = {
  configured: boolean;
  subscribe(listener: (user: AppUser | null) => void): Unsubscribe | (() => void);
  watchConnection(listener: (state: ConnectionState) => void): Unsubscribe | (() => void);
  register(email: string, password: string, name: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  listOwnedTables(): Promise<TableDoc[]>;
  peekTable(tableId: string): Promise<TableDoc>;
  peekJoinCode(code: string): Promise<JoinCodeDoc>;
  openTable(tableId: string): Promise<TableRoomSnapshot>;
  subscribeTableRoom(
    tableId: string,
    listener: (snapshot: TableRoomSnapshot | null, error?: Error) => void,
  ): Unsubscribe | (() => void);
  createTable(name: string, seatLimit: number, joinPolicy: JoinPolicy): Promise<TableDoc>;
  updateTableSettings(
    tableId: string,
    name: string,
    seatLimit: number,
    joinPolicy: JoinPolicy,
  ): Promise<void>;
  rotateJoinCode(tableId: string): Promise<string>;
  archiveTable(tableId: string): Promise<void>;
  restoreTable(tableId: string): Promise<void>;
  exportTable(tableId: string): Promise<{ filename: string }>;
  deleteTable(tableId: string, memberUids: string[], noticeIds: string[]): Promise<void>;
  joinWithCode(code: string): Promise<{ tableId: string; member: MemberDoc }>;
  joinTable(tableId: string): Promise<MemberDoc>;
  removeMember(tableId: string, uid: string): Promise<void>;
  leaveTable(tableId: string): Promise<void>;
  touchPresence(tableId: string, displayName: string): Promise<void>;
  clearPresence(tableId: string): Promise<void>;
  updateSeat(tableId: string, displayName: string, seatNote: string, email: string): Promise<void>;
  sendChat(tableId: string, body: string): Promise<ChatMessage>;
  deleteChat(tableId: string, messageId: string): Promise<void>;
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

function openFirestore(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    try {
      return getFirestore(app);
    } catch {
      return initializeFirestore(app, { localCache: persistentLocalCache() });
    }
  }
}

function services() {
  const config = firebasePublicConfig();
  if (!config) throw new Error("Firebase is not configured. Copy .env.example to .env.local.");
  firebaseApp ??= initializeApp(config);
  auth ??= getAuth(firebaseApp);
  db ??= openFirestore(firebaseApp);
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
  const joinCode = typeof data.joinCode === "string" ? data.joinCode : "";
  const archived = data.archived === true;
  const archivedAt =
    typeof data.archivedAt === "number" ? data.archivedAt : archived ? data.createdAt : 0;
  return {
    id,
    name: data.name,
    ownerId: data.ownerId,
    joinCode,
    seatLimit,
    joinPolicy,
    memberCount,
    archived,
    archivedAt: archived ? archivedAt : 0,
    createdAt: data.createdAt,
  };
}

function readMember(uid: string, data: Record<string, unknown>): MemberDoc {
  if (
    typeof data.displayName !== "string" ||
    (data.role !== "owner" && data.role !== "member") ||
    typeof data.joinedAt !== "number"
  ) {
    throw new Error("That member document is incomplete.");
  }
  return {
    uid,
    displayName: data.displayName,
    role: data.role,
    seatNote: typeof data.seatNote === "string" ? data.seatNote : "",
    email: typeof data.email === "string" ? data.email : "",
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

function readActivity(id: string, data: Record<string, unknown>): ActivityDoc {
  const allowed = new Set([
    "created",
    "joined",
    "left",
    "removed",
    "notice",
    "settings",
    "code_rotated",
    "archived",
    "restored",
  ]);
  if (
    typeof data.type !== "string" ||
    !allowed.has(data.type) ||
    typeof data.actorId !== "string" ||
    typeof data.actorName !== "string" ||
    typeof data.summary !== "string" ||
    typeof data.createdAt !== "number"
  ) {
    throw new Error("That activity document is incomplete.");
  }
  return {
    id,
    type: data.type as ActivityDoc["type"],
    actorId: data.actorId,
    actorName: data.actorName,
    summary: data.summary,
    createdAt: data.createdAt,
  };
}

function readPresence(uid: string, data: Record<string, unknown>): PresenceDoc {
  if (typeof data.displayName !== "string" || typeof data.lastSeen !== "number") {
    throw new Error("That presence document is incomplete.");
  }
  return {
    uid,
    displayName: data.displayName,
    lastSeen: data.lastSeen,
  };
}

function readChat(id: string, data: Record<string, unknown>): ChatMessage {
  if (
    typeof data.body !== "string" ||
    typeof data.authorId !== "string" ||
    typeof data.authorName !== "string" ||
    typeof data.createdAt !== "number"
  ) {
    throw new Error("That chat message is incomplete.");
  }
  return {
    id,
    body: data.body,
    authorId: data.authorId,
    authorName: data.authorName,
    createdAt: data.createdAt,
  };
}

function readJoinCode(code: string, data: Record<string, unknown>): JoinCodeDoc {
  if (
    typeof data.tableId !== "string" ||
    typeof data.name !== "string" ||
    typeof data.ownerId !== "string" ||
    typeof data.seatLimit !== "number" ||
    typeof data.memberCount !== "number" ||
    (data.joinPolicy !== "inviteOnly" && data.joinPolicy !== "firstComeFirstServe")
  ) {
    throw new Error("That join code could not be found.");
  }
  return {
    code,
    tableId: data.tableId,
    name: data.name,
    ownerId: data.ownerId,
    seatLimit: data.seatLimit,
    memberCount: data.memberCount,
    joinPolicy: data.joinPolicy,
    archived: data.archived === true,
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

async function allocateJoinCode(store: Firestore, exclude?: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = newJoinCode();
    if (exclude && code === exclude) continue;
    const snap = await getDoc(doc(store, "joinCodes", code));
    if (!snap.exists()) return code;
  }
  throw new Error("Could not mint a free join code. Try again.");
}

function writeActivityInTx(
  tx: Transaction,
  store: Firestore,
  tableId: string,
  activity: ActivityDoc,
) {
  tx.set(doc(store, "tables", tableId, "activity", activity.id), activityPayload(activity));
}

async function writeActivity(store: Firestore, tableId: string, activity: ActivityDoc) {
  await setDoc(doc(store, "tables", tableId, "activity", activity.id), activityPayload(activity));
}

async function syncJoinCodeDoc(store: Firestore, table: TableDoc) {
  if (!table.joinCode) return;
  await setDoc(doc(store, "joinCodes", table.joinCode), joinCodePayload(table));
}

async function ensureTableJoinCode(
  store: Firestore,
  table: TableDoc,
  ownerUid: string,
): Promise<TableDoc> {
  let next = table;
  // Older tables may predate archived fields; owner backfills once.
  if (table.ownerId === ownerUid) {
    const raw = await getDoc(doc(store, "tables", table.id));
    const data = raw.data() ?? {};
    if (!("archived" in data) || !("archivedAt" in data)) {
      next = { ...next, archived: false, archivedAt: 0 };
      await updateDoc(doc(store, "tables", table.id), tablePayload(next));
    }
  }
  if (next.joinCode) {
    const codeSnap = await getDoc(doc(store, "joinCodes", next.joinCode));
    if (!codeSnap.exists() && next.ownerId === ownerUid) {
      await syncJoinCodeDoc(store, next);
    } else if (codeSnap.exists() && next.ownerId === ownerUid) {
      const codeData = codeSnap.data();
      if (codeData.archived !== next.archived) {
        await syncJoinCodeDoc(store, next);
      }
    }
    return next;
  }
  if (next.ownerId !== ownerUid) return next;
  const code = await allocateJoinCode(store);
  next = { ...next, joinCode: code };
  await updateDoc(doc(store, "tables", next.id), tablePayload(next));
  await syncJoinCodeDoc(store, next);
  return next;
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
    watchConnection(listener) {
      listener({ online: true, synced: true });
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
    async peekJoinCode() {
      missing();
      return undefined as never;
    },
    async openTable() {
      missing();
      return undefined as never;
    },
    subscribeTableRoom(_tableId, listener) {
      listener(null, new Error("Firebase is not configured. Copy .env.example to .env.local."));
      return () => undefined;
    },
    async createTable() {
      missing();
      return undefined as never;
    },
    async updateTableSettings() {
      missing();
    },
    async rotateJoinCode() {
      missing();
      return undefined as never;
    },
    async archiveTable() {
      missing();
    },
    async restoreTable() {
      missing();
    },
    async exportTable() {
      missing();
      return undefined as never;
    },
    async deleteTable() {
      missing();
    },
    async joinWithCode() {
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
    async touchPresence() {
      missing();
    },
    async clearPresence() {
      missing();
    },
    async updateSeat() {
      missing();
    },
    async sendChat() {
      missing();
      return undefined as never;
    },
    async deleteChat() {
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
    watchConnection(listener) {
      if (typeof window === "undefined") {
        listener({ online: true, synced: true });
        return () => undefined;
      }
      const { db: store } = services();
      let online = navigator.onLine;
      let synced = true;
      const emit = () => listener({ online, synced });
      const markOnline = () => {
        online = true;
        emit();
      };
      const markOffline = () => {
        online = false;
        synced = false;
        emit();
      };
      window.addEventListener("online", markOnline);
      window.addEventListener("offline", markOffline);
      const stopSync = onSnapshotsInSync(store, () => {
        if (online) synced = true;
        emit();
      });
      emit();
      return () => {
        window.removeEventListener("online", markOnline);
        window.removeEventListener("offline", markOffline);
        stopSync();
      };
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
          throw new Error("That table could not be found.");
        }
        const table = readTable(tableSnap.id, tableSnap.data());
        if (table.joinPolicy !== "firstComeFirstServe") {
          throw new Error("That table is invite only. Ask for the join code instead.");
        }
        return table;
      } catch (error) {
        throw friendly(error);
      }
    },
    async peekJoinCode(code) {
      try {
        requireUser();
        const { db: store } = services();
        const normalized = cleanJoinCode(code);
        const snap = await getDoc(doc(store, "joinCodes", normalized));
        if (!snap.exists()) throw new Error("That join code could not be found.");
        const peeked = readJoinCode(normalized, snap.data());
        if (peeked.archived) {
          throw new Error("That table is archived. Ask the owner to restore it before joining.");
        }
        return peeked;
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
        let table = readTable(tableSnap.id, tableSnap.data());
        const membersSnap = await getDocs(collection(store, "tables", id, "members"));
        const members = sortMembers(membersSnap.docs.map((item) => readMember(item.id, item.data())));
        const me = members.find((member) => member.uid === user.uid);
        if (!me) throw new Error("You are not a member of this table.");
        table = await ensureTableJoinCode(store, table, user.uid);
        const noticesSnap = await getDocs(collection(store, "tables", id, "notices"));
        const notices = sortNotices(noticesSnap.docs.map((item) => readNotice(item.id, item.data())));
        const activitySnap = await getDocs(collection(store, "tables", id, "activity"));
        const activity = sortActivity(activitySnap.docs.map((item) => readActivity(item.id, item.data())));
        const messagesSnap = await getDocs(collection(store, "tables", id, "messages"));
        const messages = sortChat(messagesSnap.docs.map((item) => readChat(item.id, item.data())));
        const presenceSnap = await getDocs(collection(store, "tables", id, "presence"));
        const presence = filterPresent(
          presenceSnap.docs.map((item) => readPresence(item.id, item.data())),
        );
        const files = await listAccessibleFiles(store, id, user.uid);
        rememberTableId(user.uid, id);
        return { table, members, me, notices, files, activity, presence, messages };
      } catch (error) {
        throw friendly(error);
      }
    },
    subscribeTableRoom(tableId, listener) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const id = tableId.trim();
        if (!id) {
          listener(null, new Error("Choose a table id."));
          return () => undefined;
        }

        let table: TableDoc | null = null;
        let members: MemberDoc[] = [];
        let notices: NoticeDoc[] = [];
        let activity: ActivityDoc[] = [];
        let messages: ChatMessage[] = [];
        let presence: PresenceDoc[] = [];
        let files: FileDoc[] = [];
        let readyFlags = {
          table: false,
          members: false,
          notices: false,
          activity: false,
          messages: false,
          presence: false,
          files: false,
        };
        let heartbeatTimer: number | undefined;
        let presenceName = user.displayName?.trim() || "Member";

        const publish = () => {
          if (
            !readyFlags.table ||
            !readyFlags.members ||
            !readyFlags.notices ||
            !readyFlags.activity ||
            !readyFlags.messages ||
            !readyFlags.presence ||
            !readyFlags.files
          ) {
            return;
          }
          if (!table) {
            listener(null, new Error("That table could not be found, or you are not a member."));
            return;
          }
          const me = members.find((member) => member.uid === user.uid);
          if (!me) {
            listener(null, new Error("You are not a member of this table."));
            return;
          }
          presenceName = me.displayName;
          rememberTableId(user.uid, id);
          listener({
            table,
            members,
            me,
            notices,
            files,
            activity,
            presence: filterPresent(presence),
            messages,
          });
        };

        const beat = () => {
          void setDoc(
            doc(store, "tables", id, "presence", user.uid),
            presencePayload(buildPresence({ uid: user.uid, displayName: presenceName })),
          ).catch(() => {
            // Presence is best-effort; room still works if a beat fails.
          });
        };

        const unsubs = [
          onSnapshot(
            doc(store, "tables", id),
            (snap) => {
              readyFlags.table = true;
              if (!snap.exists()) {
                table = null;
                publish();
                return;
              }
              table = readTable(snap.id, snap.data());
              void ensureTableJoinCode(store, table, user.uid)
                .then((ensured) => {
                  table = ensured;
                  publish();
                })
                .catch(() => publish());
            },
            (error) => listener(null, friendly(error)),
          ),
          onSnapshot(
            collection(store, "tables", id, "members"),
            (snap) => {
              readyFlags.members = true;
              members = sortMembers(snap.docs.map((item) => readMember(item.id, item.data())));
              publish();
            },
            (error) => listener(null, friendly(error)),
          ),
          onSnapshot(
            collection(store, "tables", id, "notices"),
            (snap) => {
              readyFlags.notices = true;
              notices = sortNotices(snap.docs.map((item) => readNotice(item.id, item.data())));
              publish();
            },
            (error) => listener(null, friendly(error)),
          ),
          onSnapshot(
            collection(store, "tables", id, "activity"),
            (snap) => {
              readyFlags.activity = true;
              activity = sortActivity(snap.docs.map((item) => readActivity(item.id, item.data())));
              publish();
            },
            (error) => listener(null, friendly(error)),
          ),
          onSnapshot(
            collection(store, "tables", id, "messages"),
            (snap) => {
              readyFlags.messages = true;
              messages = sortChat(snap.docs.map((item) => readChat(item.id, item.data())));
              publish();
            },
            (error) => listener(null, friendly(error)),
          ),
          onSnapshot(
            collection(store, "tables", id, "presence"),
            (snap) => {
              readyFlags.presence = true;
              presence = snap.docs.map((item) => readPresence(item.id, item.data()));
              publish();
            },
            (error) => listener(null, friendly(error)),
          ),
        ];

        const refreshFiles = () => {
          void listAccessibleFiles(store, id, user.uid)
            .then((next) => {
              readyFlags.files = true;
              files = next;
              publish();
            })
            .catch((error) => listener(null, friendly(error)));
        };
        refreshFiles();
        const filesTimer = window.setInterval(refreshFiles, 15_000);
        beat();
        heartbeatTimer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
        // Re-filter stale heartbeats even when Firestore has no new writes.
        const staleTimer = window.setInterval(() => {
          if (readyFlags.presence) publish();
        }, 10_000);

        return () => {
          for (const unsub of unsubs) unsub();
          window.clearInterval(filesTimer);
          window.clearInterval(staleTimer);
          if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
          void deleteDoc(doc(store, "tables", id, "presence", user.uid)).catch(() => {
            // Leaving the page should not surface presence cleanup errors.
          });
        };
      } catch (error) {
        listener(null, friendly(error));
        return () => undefined;
      }
    },
    async createTable(name, seatLimit, joinPolicy) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const joinCode = await allocateJoinCode(store);
        const table = buildTable({
          id: newTableId(),
          name,
          ownerId: user.uid,
          seatLimit,
          joinPolicy,
          joinCode,
          memberCount: 1,
        });
        const member = buildMember({
          uid: user.uid,
          displayName: user.displayName?.trim() || "Owner",
          role: "owner",
          seatNote: "",
          email: user.email ?? "",
        });
        const activity = buildActivity({
          type: "created",
          actorId: user.uid,
          actorName: member.displayName,
          summary: `${member.displayName} created this table.`,
        });
        const tableRef = doc(store, "tables", table.id);
        const memberRef = doc(store, "tables", table.id, "members", member.uid);
        const codeRef = doc(store, "joinCodes", table.joinCode);
        await setDoc(tableRef, tablePayload(table));
        try {
          await setDoc(memberRef, memberPayload(member));
          await setDoc(codeRef, joinCodePayload(table));
          await writeActivity(store, table.id, activity);
        } catch (error) {
          try {
            await deleteDoc(codeRef);
          } catch {
            // ignore
          }
          try {
            await deleteDoc(memberRef);
          } catch {
            // ignore
          }
          try {
            await deleteDoc(tableRef);
          } catch {
            // ignore
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
        if (opened.table.archived) {
          throw new Error("Restore this table before changing settings.");
        }
        const nextLimit = cleanSeatLimit(seatLimit);
        if (nextLimit < opened.table.memberCount) {
          throw new Error("Seat limit cannot be below the people already at the table.");
        }
        const next: TableDoc = {
          ...opened.table,
          name: cleanTableName(name),
          seatLimit: nextLimit,
          joinPolicy: cleanJoinPolicy(joinPolicy),
          archived: false,
          archivedAt: 0,
        };
        await updateDoc(doc(store, "tables", opened.table.id), tablePayload(next));
        await syncJoinCodeDoc(store, next);
        await writeActivity(
          store,
          opened.table.id,
          buildActivity({
            type: "settings",
            actorId: user.uid,
            actorName: opened.me.displayName,
            summary: `${opened.me.displayName} updated table settings.`,
          }),
        );
        rememberTableId(user.uid, opened.table.id);
      } catch (error) {
        throw friendly(error);
      }
    },
    async rotateJoinCode(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can make a new join code.");
        if (opened.table.archived) {
          throw new Error("Restore this table before making a new join code.");
        }
        const nextCode = await allocateJoinCode(store, opened.table.joinCode);
        const next = { ...opened.table, joinCode: nextCode };
        const batch = writeBatch(store);
        batch.update(doc(store, "tables", opened.table.id), tablePayload(next));
        if (opened.table.joinCode) {
          batch.delete(doc(store, "joinCodes", opened.table.joinCode));
        }
        batch.set(doc(store, "joinCodes", nextCode), joinCodePayload(next));
        await batch.commit();
        await writeActivity(
          store,
          opened.table.id,
          buildActivity({
            type: "code_rotated",
            actorId: user.uid,
            actorName: opened.me.displayName,
            summary: `${opened.me.displayName} made a new join code.`,
          }),
        );
        return nextCode;
      } catch (error) {
        throw friendly(error);
      }
    },
    async archiveTable(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can archive this table.");
        if (opened.table.archived) throw new Error("This table is already archived.");
        const next: TableDoc = {
          ...opened.table,
          archived: true,
          archivedAt: Date.now(),
        };
        await updateDoc(doc(store, "tables", opened.table.id), tablePayload(next));
        await syncJoinCodeDoc(store, next);
        await writeActivity(
          store,
          opened.table.id,
          buildActivity({
            type: "archived",
            actorId: user.uid,
            actorName: opened.me.displayName,
            summary: `${opened.me.displayName} archived this table.`,
          }),
        );
      } catch (error) {
        throw friendly(error);
      }
    },
    async restoreTable(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can restore this table.");
        if (!opened.table.archived) throw new Error("This table is already active.");
        const next: TableDoc = {
          ...opened.table,
          archived: false,
          archivedAt: 0,
        };
        await updateDoc(doc(store, "tables", opened.table.id), tablePayload(next));
        await syncJoinCodeDoc(store, next);
        await writeActivity(
          store,
          opened.table.id,
          buildActivity({
            type: "restored",
            actorId: user.uid,
            actorName: opened.me.displayName,
            summary: `${opened.me.displayName} restored this table.`,
          }),
        );
      } catch (error) {
        throw friendly(error);
      }
    },
    async exportTable(tableId) {
      try {
        const opened = await this.openTable(tableId);
        const exportedAt = Date.now();
        const payload = buildTableExport({
          table: opened.table,
          members: opened.members,
          notices: opened.notices,
          activity: opened.activity,
          files: opened.files,
          messages: opened.messages,
          exportedAt,
        });
        const filename = tableExportFilename(opened.table, exportedAt);
        downloadTextFile(filename, tableExportJson(payload));
        return { filename };
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
        const activitySnap = await getDocs(collection(store, "tables", opened.table.id, "activity"));
        const messagesSnap = await getDocs(collection(store, "tables", opened.table.id, "messages"));
        const presenceSnap = await getDocs(collection(store, "tables", opened.table.id, "presence"));
        const batch = writeBatch(store);
        for (const uid of memberUids) {
          batch.delete(doc(store, "tables", opened.table.id, "members", uid));
        }
        for (const noticeId of noticeIds) {
          batch.delete(doc(store, "tables", opened.table.id, "notices", noticeId));
        }
        for (const item of activitySnap.docs) {
          batch.delete(item.ref);
        }
        for (const item of messagesSnap.docs) {
          batch.delete(item.ref);
        }
        for (const item of presenceSnap.docs) {
          batch.delete(item.ref);
        }
        if (opened.table.joinCode) {
          batch.delete(doc(store, "joinCodes", opened.table.joinCode));
        }
        batch.delete(doc(store, "tables", opened.table.id));
        await batch.commit();
      } catch (error) {
        throw friendly(error);
      }
    },
    async joinWithCode(code) {
      try {
        const peeked = await this.peekJoinCode(code);
        const member = await this.joinTable(peeked.tableId);
        return { tableId: peeked.tableId, member };
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
            throw new Error("That table could not be found.");
          }
          const table = readTable(tableSnap.id, tableSnap.data());
          if (table.archived) {
            throw new Error("That table is archived. Ask the owner to restore it before joining.");
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
          const bumped = tableFieldsForCountBump(table, table.memberCount + 1);
          tx.set(memberRef, memberPayload(next));
          tx.update(tableRef, bumped);
          writeActivityInTx(
            tx,
            store,
            table.id,
            buildActivity({
              type: "joined",
              actorId: user.uid,
              actorName: next.displayName,
              summary: `${next.displayName} took a seat.`,
            }),
          );
          return next;
        });

        const tableSnap = await getDoc(doc(store, "tables", id));
        if (tableSnap.exists()) {
          await syncJoinCodeDoc(store, readTable(tableSnap.id, tableSnap.data()));
        }
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
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can remove members.");
        const targetMember = opened.members.find((member) => member.uid === target);
        await writeActivity(
          store,
          opened.table.id,
          buildActivity({
            type: "removed",
            actorId: user.uid,
            actorName: opened.me.displayName,
            summary: `${opened.me.displayName} removed ${targetMember?.displayName ?? "a member"}.`,
          }),
        );
        try {
          await deleteDoc(doc(store, "tables", opened.table.id, "presence", target));
        } catch {
          // Presence may already be gone.
        }
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
          tx.update(tableRef, tableFieldsForCountBump(table, Math.max(1, table.memberCount - 1)));
        });
        const tableSnap = await getDoc(doc(store, "tables", tableId.trim()));
        if (tableSnap.exists()) {
          await syncJoinCodeDoc(store, readTable(tableSnap.id, tableSnap.data()));
        }
      } catch (error) {
        throw friendly(error);
      }
    },
    async leaveTable(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.table.ownerId === user.uid) {
          throw new Error("The owner cannot leave. Delete the table, or transfer ownership in a later version.");
        }
        await writeActivity(
          store,
          opened.table.id,
          buildActivity({
            type: "left",
            actorId: user.uid,
            actorName: opened.me.displayName,
            summary: `${opened.me.displayName} left the table.`,
          }),
        );
        try {
          await deleteDoc(doc(store, "tables", opened.table.id, "presence", user.uid));
        } catch {
          // Presence cleanup is best-effort before the seat is removed.
        }
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
          tx.update(tableRef, tableFieldsForCountBump(table, Math.max(1, table.memberCount - 1)));
        });
        const tableSnap = await getDoc(doc(store, "tables", tableId.trim()));
        if (tableSnap.exists()) {
          await syncJoinCodeDoc(store, readTable(tableSnap.id, tableSnap.data()));
        }
      } catch (error) {
        throw friendly(error);
      }
    },
    async touchPresence(tableId, displayName) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const id = tableId.trim();
        if (!id) throw new Error("Choose a table id.");
        await setDoc(
          doc(store, "tables", id, "presence", user.uid),
          presencePayload(buildPresence({ uid: user.uid, displayName })),
        );
      } catch (error) {
        throw friendly(error);
      }
    },
    async clearPresence(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const id = tableId.trim();
        if (!id) throw new Error("Choose a table id.");
        await deleteDoc(doc(store, "tables", id, "presence", user.uid));
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code === "not-found") return;
        throw friendly(error);
      }
    },
    async updateSeat(tableId, displayName, seatNote, email) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        const nextName = cleanDisplayName(displayName);
        await updateDoc(doc(store, "tables", opened.table.id, "members", user.uid), {
          displayName: nextName,
          role: opened.me.role,
          seatNote: cleanSeatNote(seatNote),
          email: cleanEmail(email),
          joinedAt: opened.me.joinedAt,
        });
        try {
          await setDoc(
            doc(store, "tables", opened.table.id, "presence", user.uid),
            presencePayload(buildPresence({ uid: user.uid, displayName: nextName })),
          );
        } catch {
          // Keep seat save even if presence refresh fails.
        }
      } catch (error) {
        throw friendly(error);
      }
    },
    async sendChat(tableId, body) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        const message = buildChatMessage({
          body,
          authorId: user.uid,
          authorName: opened.me.displayName,
        });
        await setDoc(
          doc(store, "tables", opened.table.id, "messages", message.id),
          chatPayload(message),
        );
        return message;
      } catch (error) {
        throw friendly(error);
      }
    },
    async deleteChat(tableId, messageId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        const message = opened.messages.find((item) => item.id === messageId.trim());
        if (!message) throw new Error("That message could not be found.");
        if (message.authorId !== user.uid && opened.me.role !== "owner") {
          throw new Error("Only the author or the owner can remove that message.");
        }
        await deleteDoc(doc(store, "tables", opened.table.id, "messages", message.id));
      } catch (error) {
        throw friendly(error);
      }
    },
    async sendNotice(tableId, subject, body) {
      try {
        const user = requireUser();
        const { db: store } = services();
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
        const opened = await this.openTable(tableId);
        await writeActivity(
          store,
          tableId.trim(),
          buildActivity({
            type: "notice",
            actorId: user.uid,
            actorName: opened.me.displayName,
            summary: `${opened.me.displayName} sent a notice.`,
          }),
        );
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
