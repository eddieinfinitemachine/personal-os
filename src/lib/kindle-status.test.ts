import { describe, it, expect } from 'vitest';
import { kindleStatus } from './kindle-status';

describe('kindleStatus', () => {
  it('returns sent when kindleSentAt is set', () => {
    expect(kindleStatus({ kindleSentAt: new Date().toISOString(), kindleError: null })).toBe('sent');
  });

  it('returns sending when kindleError is "sending"', () => {
    expect(kindleStatus({ kindleSentAt: null, kindleError: 'sending' })).toBe('sending');
  });

  it('returns failed when kindleError is set but not "sending"', () => {
    expect(kindleStatus({ kindleSentAt: null, kindleError: 'Some error' })).toBe('failed');
  });

  it('returns none when both are null', () => {
    expect(kindleStatus({ kindleSentAt: null, kindleError: null })).toBe('none');
  });

  it('returns sent even if kindleError is set when kindleSentAt is set', () => {
    expect(kindleStatus({ kindleSentAt: new Date().toISOString(), kindleError: 'error' })).toBe('sent');
  });

  it('handles undefined values like null', () => {
    expect(kindleStatus({ kindleSentAt: undefined, kindleError: undefined })).toBe('none');
  });
});
