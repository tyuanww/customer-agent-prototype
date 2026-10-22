import { actionsForIntakePost, DEFAULT_INTAKE_POST, isIntakePost, type IntakePost } from '../../apps/desktop/src/shared/intake-post-actions.ts';

export type SeatAccountError =
  | 'missing-person'
  | 'missing-post'
  | 'missing-hash'
  | 'person-write-failed'
  | 'password-write-failed';

export type SeatPerson = {
  displayName: string;
  username: string;
  bindingId: string;
  userId: string;
  /** The post decides the job and the role band the seat is registered under. */
  post: IntakePost;
};

export type PreparedPassword = {
  username: string;
  bindingId: string;
  salt: string;
  hash: string;
};

export type SeatListedPerson = {
  displayName: string;
  bindingId: string;
  enabled: boolean;
};

export type SeatPeople = {
  insert(person: SeatPerson): Promise<{ ok: true } | { ok: false; error: 'person-write-failed' }>;
  remove(bindingId: string): Promise<{ ok: true } | { ok: false; error: 'person-write-failed' }>;
  disable(bindingId: string): Promise<{ ok: true } | { ok: false; error: 'missing-person' | 'person-write-failed' }>;
  find(bindingId: string): Promise<{ ok: true } | { ok: false; error: 'missing-person' | 'person-write-failed' }>;
  list(): Promise<{ ok: true; people: SeatListedPerson[] } | { ok: false; error: 'person-write-failed' }>;
};

export type SeatPasswordRecord = {
  username: string;
  bindingId: string;
  post: string | null;
};

export type SeatPasswords = {
  prepare(username: string, bindingId: string, password: string): Promise<{ ok: true; account: PreparedPassword } | { ok: false; error: 'missing-hash' }>;
  write(account: PreparedPassword, post: IntakePost): Promise<{ ok: true } | { ok: false; error: 'password-write-failed' }>;
  replace(username: string, bindingId: string, password: string): Promise<{ ok: true } | { ok: false; error: 'missing-hash' | 'password-write-failed' }>;
  list(): Promise<{ ok: true; rows: SeatPasswordRecord[] } | { ok: false; error: 'password-write-failed' }>;
};

export type SeatCreateResult =
  | { ok: true; username: string; bindingId: string; password: string; post: IntakePost }
  | { ok: false; error: SeatAccountError };

export type SeatResetResult =
  | { ok: true; username: string; password: string }
  | { ok: false; error: 'missing-person' | 'missing-hash' | 'password-write-failed' | 'person-write-failed' };

export type SeatDisableResult =
  | { ok: true }
  | { ok: false; error: 'missing-person' | 'person-write-failed' };

export type SeatListedAccount = {
  displayName: string;
  username: string;
  post: IntakePost;
  enabled: boolean;
};

export type SeatListResult =
  | { ok: true; seats: SeatListedAccount[] }
  | { ok: false; error: 'accounts-unavailable' };

const USERNAME = /^[A-Za-z0-9_-]{1,64}$/;

export function seatUsername(username: unknown): { ok: true; username: string; bindingId: string } | { ok: false; error: 'missing-person' } {
  if (typeof username !== 'string' || !USERNAME.test(username)) return { ok: false, error: 'missing-person' };
  return { ok: true, username, bindingId: `synthetic_${username}` };
}

export function seatPerson(displayName: unknown, username: unknown, post: IntakePost): { ok: true; person: SeatPerson } | { ok: false; error: 'missing-person' } {
  const login = seatUsername(username);
  if (!login.ok) return login;
  if (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.trim().length > 256) {
    return { ok: false, error: 'missing-person' };
  }
  return {
    ok: true,
    person: {
      displayName: displayName.trim(),
      username: login.username,
      bindingId: login.bindingId,
      userId: `usr_${login.bindingId}`,
      post,
    },
  };
}

function knownPost(post: unknown): IntakePost | null {
  const mapped = actionsForIntakePost(post);
  if (!mapped.ok || typeof post !== 'string' || !isIntakePost(post)) return null;
  return post;
}

function passwordText(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return null;
  return password;
}

export async function createSeatAccount(people: SeatPeople, passwords: SeatPasswords, input: {
  displayName: unknown;
  username: unknown;
  password: unknown;
  post: unknown;
}): Promise<SeatCreateResult> {
  const post = knownPost(input.post);
  if (!post) return { ok: false, error: 'missing-post' };
  const person = seatPerson(input.displayName, input.username, post);
  if (!person.ok) return person;
  const password = passwordText(input.password);
  if (!password) return { ok: false, error: 'missing-hash' };
  const prepared = await passwords.prepare(person.person.username, person.person.bindingId, password);
  if (!prepared.ok) return prepared;
  const inserted = await people.insert(person.person);
  if (!inserted.ok) return inserted;
  const written = await passwords.write(prepared.account, post);
  if (written.ok) return { ok: true, username: person.person.username, bindingId: person.person.bindingId, password, post };
  const removed = await people.remove(person.person.bindingId);
  if (!removed.ok) return removed;
  return written;
}

export async function resetSeatPassword(people: SeatPeople, passwords: SeatPasswords, input: {
  username: unknown;
  password: unknown;
}): Promise<SeatResetResult> {
  const login = seatUsername(input.username);
  if (!login.ok) return login;
  const found = await people.find(login.bindingId);
  if (!found.ok) return found;
  const password = passwordText(input.password);
  if (!password) return { ok: false, error: 'missing-hash' };
  const replaced = await passwords.replace(login.username, login.bindingId, password);
  if (!replaced.ok) return replaced;
  return { ok: true, username: login.username, password };
}

export async function disableSeatAccount(people: SeatPeople, input: { username: unknown }): Promise<SeatDisableResult> {
  const login = seatUsername(input.username);
  if (!login.ok) return login;
  return people.disable(login.bindingId);
}

function storedPost(post: string | null): IntakePost {
  return post !== null && isIntakePost(post) ? post : DEFAULT_INTAKE_POST;
}

export async function listSeatAccounts(people: SeatPeople, passwords: SeatPasswords): Promise<SeatListResult> {
  const listedPeople = await people.list();
  if (!listedPeople.ok) return { ok: false, error: 'accounts-unavailable' };
  const listedPasswords = await passwords.list();
  if (!listedPasswords.ok) return { ok: false, error: 'accounts-unavailable' };
  const byBinding = new Map(listedPasswords.rows.map((row) => [row.bindingId, row]));
  const seats: SeatListedAccount[] = [];
  for (const person of listedPeople.people) {
    const login = seatUsername(person.bindingId.startsWith('synthetic_') ? person.bindingId.slice('synthetic_'.length) : '');
    if (!login.ok || login.bindingId !== person.bindingId) continue;
    const stored = byBinding.get(person.bindingId);
    seats.push({
      displayName: person.displayName,
      username: login.username,
      post: storedPost(stored?.post ?? null),
      enabled: person.enabled,
    });
  }
  seats.sort((left, right) => left.username.localeCompare(right.username));
  return { ok: true, seats };
}
