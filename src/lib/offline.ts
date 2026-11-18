export type ConnectionState = {
  online: boolean;
  synced: boolean;
};

export function connectionMessage(state: ConnectionState): string | null {
  if (!state.online) {
    return "You're offline. You can keep reading and editing. Changes sync when you're back online.";
  }
  if (!state.synced) {
    return "Syncing your latest changes…";
  }
  return null;
}
