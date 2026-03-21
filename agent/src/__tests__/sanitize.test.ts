import { describe, it, expect } from 'vitest';
import { sanitizeInput } from '../sanitize.js';

describe('sanitizeInput', () => {
  it('should trim leading and trailing whitespace', () => {
    expect(sanitizeInput('  hello world  ')).toBe('hello world');
  });

  it('should collapse multiple consecutive spaces into one', () => {
    expect(sanitizeInput('hello   world   foo')).toBe('hello world foo');
  });

  it('should normalize tabs and mixed whitespace to single spaces', () => {
    expect(sanitizeInput('hello\t\tworld\n  foo')).toBe('hello world foo');
  });

  it('should strip trailing unmatched brackets', () => {
    expect(sanitizeInput('remind me to get food at 8:50]')).toBe(
      'remind me to get food at 8:50',
    );
  });

  it('should strip multiple trailing junk characters', () => {
    expect(sanitizeInput('buy milk]]}')).toBe('buy milk');
  });

  it('should strip trailing pipe and tilde characters', () => {
    expect(sanitizeInput('task name|~')).toBe('task name');
  });

  it('should strip trailing backslash and backtick characters', () => {
    expect(sanitizeInput('task name\\`')).toBe('task name');
  });

  it('should handle combined whitespace and trailing junk', () => {
    expect(sanitizeInput('  remind me to get food at 8:50]  ')).toBe(
      'remind me to get food at 8:50',
    );
  });

  it('should normalize smart single quotes to straight quotes', () => {
    expect(sanitizeInput('\u2018hello\u2019')).toBe("'hello'");
  });

  it('should normalize smart double quotes to straight quotes', () => {
    expect(sanitizeInput('\u201Chello\u201D')).toBe('"hello"');
  });

  it('should normalize em-dash to hyphen', () => {
    expect(sanitizeInput('task\u2014name')).toBe('task-name');
  });

  it('should normalize en-dash to hyphen', () => {
    expect(sanitizeInput('task\u2013name')).toBe('task-name');
  });

  it('should normalize ellipsis character to three dots', () => {
    expect(sanitizeInput('hmm\u2026')).toBe('hmm...');
  });

  it('should preserve time tokens like 8:50', () => {
    expect(sanitizeInput('at 8:50')).toBe('at 8:50');
  });

  it('should preserve date tokens like tomorrow', () => {
    expect(sanitizeInput('remind me tomorrow at 3pm')).toBe(
      'remind me tomorrow at 3pm',
    );
  });

  it('should preserve AM/PM tokens', () => {
    expect(sanitizeInput('meeting at 10 AM')).toBe('meeting at 10 AM');
  });

  it('should return empty string for whitespace-only input', () => {
    expect(sanitizeInput('   ')).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('should handle a realistic noisy input', () => {
    expect(
      sanitizeInput('  remind me to   get food   at 8:50]  '),
    ).toBe('remind me to get food at 8:50');
  });

  it('should not strip brackets in the middle of text', () => {
    expect(sanitizeInput('[PT] hello')).toBe('[PT] hello');
  });

  it('should handle leading junk brackets without stripping them', () => {
    // Leading brackets are meaningful (e.g. [PT]) — we only strip trailing junk
    expect(sanitizeInput('[tag] do something]')).toBe('[tag] do something');
  });
});
