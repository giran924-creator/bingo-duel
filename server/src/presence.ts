const sockets = new Map<string, Set<string>>();
const offlineAt = new Map<string, number>();
export function online(id: string) {
  return (sockets.get(id)?.size ?? 0) > 0;
}
export function connect(id: string, socketId: string) {
  const set = sockets.get(id) ?? new Set<string>();
  set.add(socketId);
  sockets.set(id, set);
  offlineAt.delete(id);
}
export function disconnect(id: string, socketId: string) {
  const set = sockets.get(id);
  set?.delete(socketId);
  if (!set?.size) {
    sockets.delete(id);
    offlineAt.set(id, Date.now());
  }
}
export function offlineDuration(id: string) {
  if (online(id)) return 0;
  const start = offlineAt.get(id);
  if (!start) {
    offlineAt.set(id, Date.now());
    return 0;
  }
  return (Date.now() - start) / 1000;
}
export function onlineCount() {
  return sockets.size;
}
