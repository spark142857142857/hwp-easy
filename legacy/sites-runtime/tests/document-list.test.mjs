import assert from 'node:assert/strict';
import test from 'node:test';
import { documentListBefore, documentListQuery, documentListResponse } from '../host/document-list.mjs';
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
  assert(!/<script|<iframe|<svg|<img/.test(html));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert(response.headers.get('Content-Security-Policy').includes("default-src 'none'"));
});

test('search is bounded passive metadata input and retains its cursor without guessing a total', async () => {
  for (const q of ['?q=a&q=b', '?q='+ '가'.repeat(81), '?q=bad%0Aquery', '?q=bad%E2%80%8Bquery']) {
    assert.throws(() => documentListQuery(new Request(origin+'/documents'+q)), e => e.code==='INVALID_DOCUMENT_LIST_REQUEST');
  }
  assert.deepEqual(documentListQuery(new Request(origin+'/documents?q=%20%20')), {query:undefined});
  const query='<script> & " %_';
  const response=await documentListResponse(new Request(origin+'/documents?q='+encodeURIComponent(query)), 'owner', {
    listDocuments(args){assert.deepEqual(args,{owner:'owner',query}); return {documents:[{document_id,version_id,saved_at:0,byte_size:13312,revision:1}],next:{saved_at:0,document_id}};},
    read(){throw Error('Search must not read HWP');}
  });
  const html=await response.text();assert(html.includes('role="search"'));assert(html.includes('method="get"'));
  assert(html.includes('value="&lt;script&gt; &amp; &quot; %_"'));assert(!html.includes('<script>'));
  assert(html.includes(`?before=0.${document_id}&amp;q=${encodeURIComponent(query)}`));
  assert(html.includes('검색 지우기'));assert(!html.includes('총 '));
});

test('an empty search distinguishes no match from an empty account and restarting search drops old cursor', async () => {
  const html=await (await documentListResponse(new Request(origin+'/documents?q=없는문서'), 'owner', {
    listDocuments(){return {documents:[],next:null};}
  })).text();
  assert(html.includes('일치하는 문서가 없습니다'));assert(!html.includes('아직 저장된 문서가 없습니다'));
  assert(!/<input[^>]*name="before"/.test(html));
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
