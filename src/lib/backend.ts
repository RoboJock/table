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
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  buildMember,
  buildTable,
  cleanDisplayName,
  cleanSeatNote,
  cleanTableName,
  cleanUid,
  memberPayload,
  newTableId,
  rememberTableId,
  sortMembers,
  tablePayload,
} from "./tables";
import type { AppUser, MemberDoc, TableDoc } from "./types";

export type Backend = {
  configured: boolean;
  subscribe(listener: (user: AppUser | null) => void): Unsubscribe | (() => void);
  register(email: string, password: string, name: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  listOwnedTables(): Promise<TableDoc[]>;
  openTable(tableId: string): Promise<{ table: TableDoc; members: MemberDoc[]; me: MemberDoc }>;
  createTable(name: string): Promise<TableDoc>;
  renameTable(tableId: string, name: string): Promise<void>;
  deleteTable(tableId: string, memberUids: string[]): Promise<void>;
  inviteMember(tableId: string, uid: string, displayName: string): Promise<MemberDoc>;
  removeMember(tableId: string, uid: string): Promise<void>;
  leaveTable(tableId: string): Promise<void>;
  updateSeat(tableId: string, displayName: string, seatNote: string): Promise<void>;
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
  return { id, name: data.name, ownerId: data.ownerId, createdAt: data.createdAt };
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
  return {
    uid,
    displayName: data.displayName,
    role: data.role,
    seatNote: data.seatNote,
    joinedAt: data.joinedAt,
  };
}

export function createBackend(): Backend {
  const configured = firebasePublicConfig() !== null;

  if (!configured) {
    return {
      configured: false,
      subscribe(listener) {
        listener(null);
        return () => undefined;
      },
      async register() {
        throw new Error("Firebase is not configured. Copy .env.example to .env.local.");
      },
      async signIn() {
        throw new Error("Firebase is not configured. Copy .env.example to .env.local.");
      },
      async signOut() {
        return;
      },
      async listOwnedTables() {
        return [];
      },
      async openTable() {
        throw new Error("Firebase is not configured.");
      },
      async createTable() {
        throw new Error("Firebase is not configured.");
      },
      async renameTable() {
        throw new Error("Firebase is not configured.");
      },
      async deleteTable() {
        throw new Error("Firebase is not configured.");
      },
      async inviteMember() {
        throw new Error("Firebase is not configured.");
      },
      async removeMember() {
        throw new Error("Firebase is not configured.");
      },
      async leaveTable() {
        throw new Error("Firebase is not configured.");
      },
      async updateSeat() {
        throw new Error("Firebase is not configured.");
      },
    };
  }

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
        rememberTableId(user.uid, id);
        return { table, members, me };
      } catch (error) {
        throw friendly(error);
      }
    },
    async createTable(name) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const table = buildTable({
          id: newTableId(),
          name,
          ownerId: user.uid,
        });
        const member = buildMember({
          uid: user.uid,
          displayName: user.displayName?.trim() || "Owner",
          role: "owner",
          seatNote: "",
        });
        // Write the table first, then the owner member doc. A single batch fails
        // rules that get() the new table while creating its first member.
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
    async renameTable(tableId, name) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can rename this table.");
        await updateDoc(doc(store, "tables", opened.table.id), {
          name: cleanTableName(name),
          ownerId: opened.table.ownerId,
          createdAt: opened.table.createdAt,
        });
        rememberTableId(user.uid, opened.table.id);
      } catch (error) {
        throw friendly(error);
      }
    },
    async deleteTable(tableId, memberUids) {
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
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can invite members.");
        const invitee = cleanUid(uid);
        if (invitee === user.uid) throw new Error("You are already at this table.");
        if (opened.members.some((member) => member.uid === invitee)) {
          throw new Error("That account is already a member.");
        }
        const member = buildMember({
          uid: invitee,
          displayName: displayName.trim() ? displayName : "Member",
          role: "member",
          seatNote: "",
        });
        await setDoc(doc(store, "tables", opened.table.id, "members", member.uid), memberPayload(member));
        return member;
      } catch (error) {
        throw friendly(error);
      }
    },
    async removeMember(tableId, uid) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role !== "owner") throw new Error("Only the owner can remove members.");
        const target = cleanUid(uid);
        if (target === opened.table.ownerId) throw new Error("The owner cannot be removed. Delete the table instead.");
        await deleteDoc(doc(store, "tables", opened.table.id, "members", target));
      } catch (error) {
        throw friendly(error);
      }
    },
    async leaveTable(tableId) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        if (opened.me.role === "owner") {
          throw new Error("The owner cannot leave. Delete the table, or transfer ownership in a later version.");
        }
        await deleteDoc(doc(store, "tables", opened.table.id, "members", user.uid));
      } catch (error) {
        throw friendly(error);
      }
    },
    async updateSeat(tableId, displayName, seatNote) {
      try {
        const user = requireUser();
        const { db: store } = services();
        const opened = await this.openTable(tableId);
        await updateDoc(doc(store, "tables", opened.table.id, "members", user.uid), {
          displayName: cleanDisplayName(displayName),
          role: opened.me.role,
          seatNote: cleanSeatNote(seatNote),
          joinedAt: opened.me.joinedAt,
        });
      } catch (error) {
        throw friendly(error);
      }
    },
  };
}
