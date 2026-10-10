import assert from 'node:assert/strict';
import test from 'node:test';
import { domainChallengeResponse, documentSignInResponse } from '../host/public-entry.mjs';
const origin = 'https://synthetic-entry.invalid';
const token = 'synthetic-domain-proof-0123456789';

test('verification serves only the configured proof, never request input', async () => {
  const request = new Request(origin + '/.well-known/openai-apps-challenge?token=caller-value');
  const response = domainChallengeResponse(request, token);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), token);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Type'), /^text\/plain/);
});

test('verification is unavailable without valid server configuration', async () => {
  const request = new Request(origin + '/.well-known/openai-apps-challenge');
  for (const value of [undefined, '', token + '\n', 'Bearer ' + token, '<script>unsafe</script>']) {
    const response = domainChallengeResponse(request, value);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'Not found');
  }
  assert.equal(domainChallengeResponse(new Request(origin + '/documents'), token), null);
});

test('proof methods are read-only and HEAD has no body', async () => {
  const url = origin + '/.well-known/openai-apps-challenge';
  const head = domainChallengeResponse(new Request(url, { method: 'HEAD' }), token);
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = domainChallengeResponse(new Request(url, { method }), token);
    assert.equal(response.status, 405); assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    assert.equal(await response.text(), '');
  }
});

test('anonymous browser gets a fixed platform login destination without reflecting input', async () => {
  const response = documentSignInResponse(new Request(origin + '/documents?return_to=https://outside.invalid&name=secret-document',
    { headers: { Accept: 'text/html' } }));
  assert.equal(response.status, 401);
  const html = await response.text();
  assert.match(html, /href="\/signin-with-chatgpt\?return_to=%2Fdocuments" target="_top"/);
  assert.doesNotMatch(html, /outside\.invalid|secret-document/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});

test('API calls and individual document paths do not receive the entry page', () => {
  for (const path of ['/mcp', '/documents/import', '/documents/synthetic/versions/old.hwp']) {
    assert.equal(documentSignInResponse(new Request(origin + path, { headers: { Accept: 'text/html' } })), null);
  }
  assert.equal(documentSignInResponse(new Request(origin + '/documents')), null);
  assert.equal(documentSignInResponse(new Request(origin + '/documents', { method: 'POST', headers: { Accept: 'text/html' } })), null);
});
