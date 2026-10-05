import assert from 'node:assert/strict';
import test from 'node:test';
import { documentListBefore, documentListResponse } from '../host/document-list.mjs';
const origin = 'https://list.invalid';
const document_id = crypto.randomUUID(), version_id = crypto.randomUUID();
test('document list refuses extra identity input, duplicate or noncanonical cursors, body and ranges', () => {
  for (const query of ['?owner=other', '?before=', '?before=private', `?before=01.${document_id}`,
    `?before=8640000000000001.${document_id}`, `?before=1.${document_id}&before=2.${document_id}`]) {
    assert.throws(() => documentListBefore(new Request(origin + '/documents' + query)), e => e.code === 'INVALID_DOCUMENT_LIST_REQUEST');
  }
  for (const request of [new Request(origin + '/documents', {headers:{Range:'bytes=0-10'}}),
    new Request(origin + '/documents', {method:'POST', body:'private'})]) {
    assert.throws(() => documentListBefore(request), e => e.code === 'INVALID_DOCUMENT_LIST_REQUEST');
  }
  assert.deepEqual(documentListBefore(new Request(`${origin}/documents?before=0.${document_id}`)), {saved_at:0, document_id});
});
test('list forwards trusted owner and cursor, never opens document bytes or adds active content', async () => {
  let calls = 0;
  const response = await documentListResponse(new Request(`${origin}/documents?before=1.${document_id}`), 'trusted-owner', {
    listDocuments(args) { calls++; assert.deepEqual(args, {owner:'trusted-owner',before:{saved_at:1,document_id}});
      return {documents:[{document_id,version_id,saved_at:0,byte_size:13312,revision:3}],next:{saved_at:0,document_id}}; },
    read() { throw new Error('must not open HWP'); },
  });
  const html = await response.text(); assert.equal(calls,1);
  assert(html.includes(`/documents/${document_id}/versions/${version_id}/view`));
  assert(html.includes(`?before=0.${document_id}`)); assert(html.includes('저장 3회'));
  assert(!/<script|<iframe|<svg|<img|<form/.test(html));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert(response.headers.get('Content-Security-Policy').includes("default-src 'none'"));
});
test('empty lists offer upload and non-GET requests never query storage', async () => {
  let queries = 0; const store = { listDocuments() {queries++;return {documents:[],next:null};} };
  const html = await (await documentListResponse(new Request(origin + '/documents'), 'owner', store)).text();
  assert(html.includes('아직 저장된 문서가 없습니다')); assert(html.includes('/documents/upload')); assert.equal(queries,1);
  const denied = await documentListResponse(new Request(origin + '/documents', {method:'POST'}), 'owner', store);
  assert.equal(denied.status,405); assert.equal(queries,1);
});

test('explicit names replace the ID label and remain escaped passive text', async () => {
  const response=await documentListResponse(new Request(origin+'/documents'),'owner',{
    listDocuments(){return {documents:[{document_id,version_id,saved_at:0,byte_size:13312,revision:1,display_name:'<script>이름</script> & 😀'}],next:null};}
  });
  const html=await response.text();assert(html.includes('&lt;script&gt;이름&lt;/script&gt; &amp; 😀'));
  assert(!html.includes('<script>'));assert(!html.includes(`HWP 문서 · ${document_id.slice(0,8)}</a>`));
});
