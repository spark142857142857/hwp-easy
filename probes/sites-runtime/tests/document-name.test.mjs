import assert from 'node:assert/strict';
import test from 'node:test';
import { documentNameResponse } from '../host/document-name.mjs';
import { validDocumentName, createDocumentNames } from '../storage/document-names.mjs';
const origin = 'https://names.invalid', document_id = crypto.randomUUID(), current_version = crypto.randomUUID();
const route = `${origin}/documents/${document_id}/name`;
const post = (fields, headers = {}) => new Request(route, {method:'POST', headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(fields)});
const valid = {display_name:'시험 이름', expected_name_revision:'0'};

test('names count Unicode code points, accept literal markup and reject controls, surrogates and excessive length', () => {
  for (const value of ['', '한글 😀 <script>&"', '😀'.repeat(80)]) assert(validDocumentName(value));
  for (const value of ['😀'.repeat(81), '\n이름', '이름\n문서', '이름\u202e', 'a\u0000', '\ud800', ' 이름 ']) assert(!validDocumentName(value));
});
test('name form escapes attributes and performs metadata-only reads; GET never renames', async () => {
  let reads = 0;
  const response = await documentNameResponse(new Request(route), 'owner', {
    documentName(args) { reads++; assert.deepEqual(args,{owner:'owner',document_id}); return {display_name:'"><img src=x onerror=alert(1)>',name_revision:3,current_version}; },
    renameDocument() {throw Error('GET mutation');}, read() {throw Error('No HWP reads');}
  }, origin);
  const html=await response.text();assert.equal(reads,1); assert(html.includes('&quot;&gt;&lt;img'));
  assert(!/<img|<script/.test(html)); assert(html.includes('name="expected_name_revision" value="3"'));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert(response.headers.get('Content-Security-Policy').includes("form-action 'self'"));
});
test('POST requires same-origin bounded exact fields and never reflects rejected input', async () => {
  const store={renameDocument(){throw Error('Invalid mutation');}};
  for(const request of [post(valid,{Origin:'https://other.invalid'}),post(valid,{Origin:''}),
    post({...valid,owner:'private'}),post({display_name:'secret\nvalue',expected_name_revision:'0'}),
    post({...valid,expected_name_revision:'01'}),post({...valid,display_name:'secret'.repeat(1000)}),
    post([...Object.entries(valid),['display_name','private']]),post(valid,{'Content-Type':'text/plain'})]) {
    let response;try{response=await documentNameResponse(request,'owner',store,origin);}catch(e){assert.equal(e.code,'TRANSFER_LIMIT_EXCEEDED');continue;}
    assert.equal(response.status,400);const html=await response.text(); assert(!html.includes('secret'));assert(!html.includes('https://other.invalid'));
  }
});
test('successful rename trims input and redirects to explicit current version; conflict gives reread guidance', async () => {
  const response=await documentNameResponse(post({...valid,display_name:'  이름 😀  '}),'owner',{
    renameDocument(args){assert.deepEqual(args,{owner:'owner',document_id,display_name:'이름 😀',expected_name_revision:0});return {current_version};}
  },origin);
  assert.equal(response.status,303);assert.equal(response.headers.get('Location'),`/documents/${document_id}/versions/${current_version}/view`);
  const denied=await documentNameResponse(post(valid),'owner',{renameDocument(){throw Object.assign(Error('private'),{code:'DOCUMENT_NAME_CONFLICT'});}},origin);
  assert.equal(denied.status,409);assert((await denied.text()).includes('새로 열어')); 
});
function fixture() {
  let row={display_name:'',name_revision:0,current_version}, writes=0, loseAck=false;
  const api=createDocumentNames({ownerKey(){},id(){},fail(code){throw Object.assign(Error(code),{code});},
    first(){return row&&{...row};},all(sql,values){writes++;assert(!/hwp_requests|blob_key/.test(sql));
      row={display_name:values[0],name_revision:row.name_revision+1,current_version};if(loseAck)throw Error('Lost ack');return [{...row}];}});
  return {api,get writes(){return writes;},set loseAck(v){loseAck=v;},set row(v){row=v;}};
}
test('rename retries resolve a lost acknowledgement exactly once and stale forms cannot ABA overwrite', async () => {
  const f=fixture();f.loseAck=true;
  const args={owner:'owner',document_id,display_name:'A',expected_name_revision:0};
  assert((await f.api.renameDocument(args)).replayed);assert.equal(f.writes,1);
  assert((await f.api.renameDocument(args)).replayed);assert.equal(f.writes,1);
  f.loseAck=false;
  await f.api.renameDocument({...args,display_name:'B',expected_name_revision:1});
  await f.api.renameDocument({...args,display_name:'A',expected_name_revision:2});
  await assert.rejects(()=>f.api.renameDocument(args),e=>e.code==='DOCUMENT_NAME_CONFLICT');assert.equal(f.writes,3);
});
test('unchanged names do not increment revisions, missing or corrupt metadata never reaches updates', async () => {
  const f=fixture(),args={owner:'owner',document_id,display_name:'',expected_name_revision:0};
  assert((await f.api.renameDocument(args)).unchanged);assert.equal(f.writes,0);
  f.row=null;await assert.rejects(()=>f.api.renameDocument(args),e=>e.code==='DOCUMENT_OR_VERSION_NOT_FOUND');assert.equal(f.writes,0);
  f.row={display_name:'secret\n',name_revision:0,current_version};
  await assert.rejects(()=>f.api.documentName(args),e=>e.code==='BLOB_MISSING_OR_CORRUPT');
});
