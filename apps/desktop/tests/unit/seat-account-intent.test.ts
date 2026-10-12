import { expect, it } from 'vitest';
import { isSeatAccountIntent, seatAccountReply } from '../../src/shared/seat-account-intent';

it('accepts a seat reply only when it has no password field', () => {
  expect(seatAccountReply({
    ok: true,
    action: 'create',
    seat: { displayName: '外包甲', username: 'seatui', post: '客服', enabled: true },
  })).toEqual({
    ok: true,
    action: 'create',
    seat: { displayName: '外包甲', username: 'seatui', post: '客服', enabled: true },
  });
  expect(seatAccountReply({
    ok: true,
    action: 'create',
    seat: { displayName: '外包甲', username: 'seatui', post: '客服', enabled: true, password: 'pw-seat-ui' },
  })).toBeNull();
  expect(seatAccountReply({ ok: true, action: 'reset', username: 'seatui' })).toEqual({ ok: true, action: 'reset', username: 'seatui' });
  expect(seatAccountReply({ ok: true, action: 'reset', username: 'seatui', password: 'pw-seat-ui' })).toBeNull();
  expect(seatAccountReply({ ok: true, action: 'disable', username: 'seatui' })).toEqual({ ok: true, action: 'disable', username: 'seatui' });
  expect(seatAccountReply({
    ok: true, action: 'list', seats: [{ displayName: '外包甲', username: 'seatui', post: '客服', enabled: true }],
  })).toEqual({
    ok: true, action: 'list', seats: [{ displayName: '外包甲', username: 'seatui', post: '客服', enabled: true }],
  });
  expect(seatAccountReply({ ok: true, action: 'list', seats: [{ displayName: '外包甲', username: 'seatui', post: '客服', enabled: true, hash: 'ab' }] })).toBeNull();
  expect(seatAccountReply({ ok: false, message: '账号没有读取。' })).toEqual({ ok: false, message: '账号没有读取。' });
  expect(seatAccountReply({ ok: false, message: '请设定密码。' })).toEqual({ ok: false, message: '请设定密码。' });
  expect(seatAccountReply({ ok: false, message: '/var/stack/password-accounts.json' })).toBeNull();
});

it('accepts the seat intents and rejects a password-only extra field', () => {
  expect(isSeatAccountIntent({ action: 'list' })).toBe(true);
  expect(isSeatAccountIntent({ action: 'list', username: 'seatui' })).toBe(false);
  expect(isSeatAccountIntent({ action: 'create', displayName: '外包甲', username: 'seatui', password: 'pw', post: '客服' })).toBe(true);
  expect(isSeatAccountIntent({ action: 'reset', username: 'seatui', password: 'pw' })).toBe(true);
  expect(isSeatAccountIntent({ action: 'disable', username: 'seatui' })).toBe(true);
  expect(isSeatAccountIntent({ action: 'create', displayName: '外包甲', username: 'seatui', password: 'pw', post: '客服', file: 'password-accounts.json' })).toBe(false);
  expect(isSeatAccountIntent({ action: 'disable', username: 'seatui', password: 'pw' })).toBe(false);
});
