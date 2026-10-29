const pendingNames = new Map<string, string>();

export function persistOperatorDisplayName(userId: string, name: string): void {
  const trimmed = name.trim().slice(0, 64);
  if (userId.length < 1 || trimmed.length < 1) return;
  pendingNames.set(userId, trimmed);
}

export function takeOperatorDisplayName(userId: string): string | null {
  const name = pendingNames.get(userId);
  pendingNames.delete(userId);
  return name ?? null;
}
