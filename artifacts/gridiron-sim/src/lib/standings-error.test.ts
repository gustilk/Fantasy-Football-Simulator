import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standingsErrorMessage } from './standings-error.ts';

test('Replit HTML failures identify the app service without leaking HTML', () => {
  const message = standingsErrorMessage(new Error('HTTP 404 Not Found: <!DOCTYPE html> <html><head><title>Run this app to see the results here.</title>'));
  assert.match(message, /app’s standings service is unavailable/);
  assert.match(message, /Saved standings are unchanged/);
  assert.doesNotMatch(message, /ESPN|<html|DOCTYPE/);
});

test('network failures give connection guidance', () => {
  assert.match(standingsErrorMessage(new TypeError('Failed to fetch')), /Check your connection/);
});

test('ESPN evidence validation failures retain their explanation', () => {
  assert.equal(standingsErrorMessage(new Error('ESPN returned the wrong season.')),
    'ESPN standings could not be loaded: ESPN returned the wrong season. Saved standings are unchanged.');
});
