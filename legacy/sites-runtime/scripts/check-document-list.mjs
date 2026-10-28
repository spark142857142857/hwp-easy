// Actual workerd + durable storage + compiled WASM. User headers are mock
// identities, not proof of two real OAuth users. All HWP data is synthetic.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyTestMigrations } from './migrations.mjs';
const origin = 'https://list.invalid'; let outbound = 0;
const options = () => convertV4MiniflareOptions({ compatibilityDate:'2026-10-01', modulesRoot:path.resolve('dist/server'),
  modules:[{type:'ESModule',path:path.resolve('dist/server/index.js')},{type:'CompiledWasm',path:path.resolve('dist/server/rhwp_bg.wasm')}],
  d1Databases:{DB:'document-list-d1',LEGACY:'document-name-migration-d1'},r2Buckets:{BUCKET:'document-list-r2'},
  bindings:{HWP_EASY_ORIGIN:origin,HWP_EASY_ALLOW_UPLOADS:'true',HWP_EASY_FILE_ORIGINS:'[]'},
  outboundService:()=>{outbound++;throw new Error('No network');} });
const mf = new Miniflare(options());
const a = {'oai-authenticated-user-id':'list-a','oai-authenticated-user-email':'same@example.invalid'};
const b = {...a,'oai-authenticated-user-id':'list-b'};
const get = (route='/documents', headers=a) => mf.dispatchFetch(origin + route, {headers});
const invoke = async (name,args,headers=a) => {
  const response=await mf.dispatchFetch(origin+'/mcp',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  assert.equal(response.status,200);const result=(await response.json()).result;assert(!result.isError);return result.structuredContent.data;
};
const links = html => [...html.matchAll(/href="(\/documents\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/view)"/g)].map(m=>({path:m[1],doc:m[2],version:m[3]}));
const next = html => html.match(/href="(\/documents\?before=[^"]+)"/)?.[1].replaceAll('&amp;','&');
try {
  let db=await mf.getD1Database('DB'), bucket=await mf.getR2Bucket('BUCKET');await applyTestMigrations(db);
  // Upgrade an existing old-schema metadata row, not only a fresh database.
  const legacy=await mf.getD1Database('LEGACY');
  const migrations=fs.readdirSync('drizzle').filter(n=>/^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
  const apply=async names=>{for(const name of names)await legacy.batch(fs.readFileSync(`drizzle/${name}`,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>legacy.prepare(s)));};
  await apply(migrations.slice(0,2));
  const legacyId=crypto.randomUUID(),legacyVersion=crypto.randomUUID();
  await legacy.prepare('INSERT INTO hwp_documents(owner,id,current_version,revision,created_at) VALUES(?,?,?,?,?)').bind('migration-owner',legacyId,legacyVersion,7,123).run();
  const legacyBefore=await legacy.prepare('SELECT * FROM hwp_documents').first();
  await apply(migrations.slice(2));
  assert.deepEqual(await legacy.prepare('SELECT * FROM hwp_documents').first(),{...legacyBefore,display_name:'',name_revision:0});
  assert.equal((await get('/documents',{})).status,401);
  assert.equal((await get('/documents',{'oai-authenticated-user-id':'list-a'})).status,401);
  const empty=await get();assert.equal(empty.status,200);assert((await empty.text()).includes('아직 저장된 문서가 없습니다'));
  const fixed=await mf.dispatchFetch(origin+'/diagnostics/synthetic-result.hwp',{headers:a});
  assert.equal(fixed.status,200);const bytes=new Uint8Array(await fixed.arrayBuffer());
  const importFile=async headers=>{const response=await mf.dispatchFetch(origin+'/documents/import',{method:'POST',
    headers:{...headers,Origin:origin,'Content-Type':'application/x-hwp','hwp-request-id':crypto.randomUUID()},body:bytes});
    assert.equal(response.status,200);return response.json();};
  const documents=[];for(let i=0;i<22;i++)documents.push(await importFile(a));const other=await importFile(b);
  // Force ties and creation/current timestamp disagreement to exercise SQL.
  await db.prepare('UPDATE hwp_documents SET created_at=9').run();
  await db.prepare('UPDATE hwp_versions SET created_at=1000').run();
  const capture=async()=>({docs:(await db.prepare('SELECT * FROM hwp_documents ORDER BY owner,id').all()).results,
    versions:(await db.prepare('SELECT * FROM hwp_versions ORDER BY owner,document_id,id').all()).results,
    requests:(await db.prepare('SELECT * FROM hwp_requests ORDER BY owner,id').all()).results,
    blobs:(await bucket.list()).objects.map(o=>({key:o.key,etag:o.etag})).sort((x,y)=>x.key.localeCompare(y.key))});
  // Search all matching metadata before paginating, including Korean names and
  // timestamp ties. Percent/underscore are literal characters, not wildcards.
  await db.prepare("UPDATE hwp_documents SET display_name='합성 검색 공통'").run();
  await db.prepare('UPDATE hwp_documents SET display_name=? WHERE id=?').bind('합성 검색 공통 100%_HWP',documents[0].document_id).run();
  const searchCapture=await capture();
  const find=async (query,headers=a)=>get('/documents?q='+encodeURIComponent(query),headers);
  let searched=[],searchRoute='/documents?q='+encodeURIComponent('공통');
  do {const page=await get(searchRoute);assert.equal(page.status,200);const pageHtml=await page.text();searched.push(...links(pageHtml));searchRoute=next(pageHtml);
    if(searchRoute)assert.equal(new URL(origin+searchRoute).searchParams.get('q'),'공통');
  } while(searchRoute);
  assert.deepEqual(searched.map(l=>l.doc),documents.map(d=>d.document_id).sort().reverse());
  assert.deepEqual(links(await (await find('%_hwp')).text()).map(l=>l.doc),[documents[0].document_id]);
  assert.deepEqual(links(await (await find(documents[0].document_id.toUpperCase())).text()).map(l=>l.doc),[documents[0].document_id]);
  assert.deepEqual(links(await (await find(other.document_id)).text()),[]);
  assert.deepEqual(links(await (await find('공통',b)).text()).map(l=>l.doc),[other.document_id]);
  assert.deepEqual(links(await (await find("%' OR 1=1 --")).text()),[]);
  assert((await (await find('일치하지않는합성문서')).text()).includes('일치하는 문서가 없습니다'));
  for(const query of ['?q=a&q=b','?q=bad%0Ainput','?q='+encodeURIComponent('가'.repeat(81))])assert.equal((await get('/documents'+query)).status,400);
  assert.deepEqual(await capture(),searchCapture);
  await db.prepare("UPDATE hwp_documents SET display_name=''").run();
  const before=await capture();
  let response=await get();assert.equal(response.status,200);let html=await response.text();const firstPage=links(html);
  assert.equal(firstPage.length,20);assert(!html.includes(other.document_id));
  const secondPage=links(await (await get(next(html))).text());assert.equal(secondPage.length,2);
  const expected=documents.map(d=>d.document_id).sort().reverse();
  assert.deepEqual([...firstPage,...secondPage].map(l=>l.doc),expected);
  const otherPage=links(await (await get('/documents',b)).text());assert.deepEqual(otherPage.map(l=>l.doc),[other.document_id]);
  // A foreign cursor is only an ordering position; owner isolation still applies.
  const foreign=links(await (await get(`/documents?before=1000.${other.document_id}`,a)).text());
  assert(foreign.every(l=>expected.includes(l.doc)));
  for(const route of ['/documents?owner=private','/documents?before=private','/documents?before=&before=private']) {
    const denied=await get(route);assert.equal(denied.status,400);assert.equal((await denied.json()).error,'INVALID_DOCUMENT_LIST_REQUEST');
  }
  assert.equal((await mf.dispatchFetch(origin+'/documents',{method:'POST',headers:a})).status,405);
  assert.equal((await get('/documents',{...a,Range:'bytes=0-1'})).status,400);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert(response.headers.get('Content-Security-Policy').includes("default-src 'none'"));
  assert(!/<script|<iframe|<svg|<img/.test(html));assert.deepEqual(await capture(),before);
  assert.equal((await get(firstPage[0].path,b)).status,404);assert.equal((await get(firstPage[0].path,a)).status,200);
  // Real edit: the new explicit current pointer wins even when its timestamp is
  // older than another version. Never infer current by MAX(created_at).
  // Timestamp ties are ordered by random UUID, not insertion order. Select a
  // document proven to be on page one for the name-escaping assertion below.
  const doc=documents.find(d=>d.document_id===firstPage[0].doc),read=await invoke('hwp_read',{document_id:doc.document_id,version_id:doc.version_id});
  const nameRoute=`/documents/${doc.document_id}/name`;
  const rename=async (name,revision,headers=a)=>mf.dispatchFetch(origin+nameRoute,{method:'POST',
    headers:{...headers,Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({display_name:name,expected_name_revision:String(revision)}),redirect:'manual'});
  const nameCapture=await capture();
  const noName=await db.prepare('SELECT display_name,name_revision FROM hwp_documents WHERE id=?').bind(doc.document_id).first();
  assert.deepEqual(noName,{display_name:'',name_revision:0});
  assert.equal((await get(nameRoute,{})).status,401);
  assert.equal((await get(nameRoute,b)).status,404);assert.equal((await rename('타인 이름',0,b)).status,404);
  const nameForm=await get(nameRoute);assert.equal(nameForm.status,200);assert((await nameForm.text()).includes('이름 저장'));
  const name='합성 목록 시험 😀 <script> & "';
  const changedName=await rename(name,0);assert.equal(changedName.status,303);
  assert.equal(changedName.headers.get('Location'),`/documents/${doc.document_id}/versions/${doc.version_id}/view`);
  assert.equal((await rename(name,0)).status,303); // exact acknowledgement retry
  assert.equal((await rename('다른 이름',0)).status,409);
  assert.equal((await rename(name,1)).status,303); // no-op, no name revision increment
  assert.deepEqual(await db.prepare('SELECT display_name,name_revision FROM hwp_documents WHERE id=?').bind(doc.document_id).first(),{display_name:name,name_revision:1});
  const escaped='합성 목록 시험 😀 &lt;script&gt; &amp; &quot;';
  let namedHtml=await (await get()).text();assert(namedHtml.includes(escaped));assert(!namedHtml.includes('<script>'));
  assert(!(await (await get('/documents',b)).text()).includes('합성 목록 시험'));
  assert((await (await get(`/documents/${doc.document_id}/versions/${doc.version_id}/view`)).text()).includes(escaped));
  // Same-origin form guard, unexpected fields and bounded Unicode controls.
  for (const headers of [{...a,Origin:'https://other.invalid'},a]) {
    const rejected=await mf.dispatchFetch(origin+nameRoute,{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({display_name:'거부',expected_name_revision:'1'})});assert.equal(rejected.status,400);
  }
  const invalid=await rename('개인\n정보',1);assert.equal(invalid.status,400);assert(!(await invalid.text()).includes('개인'));
  // Racing rename forms: SQL allows one revision winner, no last-write-wins.
  const race=await Promise.all([rename('동시 A',1),rename('동시 B',1)]);assert.deepEqual(race.map(r=>r.status).sort(),[303,409]);
  assert.equal((await rename('',2)).status,303);
  assert.equal((await rename(name,3)).status,303);
  assert.equal((await rename('오래된 덮어쓰기',0)).status,409);
  const afterNames=await capture();
  for (const key of ['versions','requests','blobs']) assert.deepEqual(afterNames[key],nameCapture[key]);
  const omitNames=rows=>rows.map(({display_name,name_revision,...row})=>row);
  assert.deepEqual(omitNames(afterNames.docs),omitNames(nameCapture.docs));
  const target=read.blocks.find(x=>x.editable&&x.text);
  const edited=await invoke('hwp_edit',{document_id:doc.document_id,expected_version:doc.version_id,expected_sha256:doc.sha256,
    request_id:crypto.randomUUID(),operations:[{target_id:target.target_id,expected_old:target.text,new_text:'목록 현재 버전 시험'}]});
  assert(edited.saved);
  await db.prepare('UPDATE hwp_versions SET created_at=500 WHERE id=?').bind(edited.version_id).run();
  let allLinks=[],route='/documents';do {html=await (await get(route)).text();allLinks.push(...links(html));route=next(html);}while(route);
  assert.equal(allLinks.find(l=>l.doc===doc.document_id).version,edited.version_id);
  // Pending deletion is excluded even while the document row still exists.
  // UUID ordering can place any imported document first. Keep the deletion
  // fixture distinct from the document whose name revision was advanced above.
  const hidden=documents.find(d=>d.document_id!==doc.document_id),owner=(await db.prepare('SELECT owner FROM hwp_documents WHERE id=?').bind(hidden.document_id).first()).owner;
  await db.prepare("INSERT INTO hwp_deletions (owner,document_id,request_id,expected_version,phase,version_count,created_at) VALUES (?,?,?,?,'pending',1,1)")
    .bind(owner,hidden.document_id,crypto.randomUUID(),hidden.version_id).run();
  html=await (await get()).text();assert(!html.includes(hidden.document_id));
  assert.deepEqual(links(await (await find(hidden.document_id)).text()),[]);
  const hiddenRoute=`/documents/${hidden.document_id}/name`;
  assert.equal((await get(hiddenRoute)).status,404);
  const hiddenRename=await mf.dispatchFetch(origin+hiddenRoute,{method:'POST',headers:{...a,Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({display_name:'삭제 중 이름',expected_name_revision:'0'})});assert.equal(hiddenRename.status,404);
  assert.equal((await db.prepare('SELECT name_revision FROM hwp_documents WHERE id=?').bind(hidden.document_id).first()).name_revision,0);
  // Malformed metadata must never become an HTML href or expose an arbitrary row.
  const corrupt=documents.find(d=>d.document_id!==hidden.document_id && d.document_id!==doc.document_id && firstPage.some(l=>l.doc===d.document_id));
  await db.prepare('UPDATE hwp_versions SET byte_size=-1 WHERE id=?').bind(corrupt.version_id).run();
  const refused=await get();assert.equal(refused.status,400);assert.equal((await refused.json()).error,'BLOB_MISSING_OR_CORRUPT');
  await db.prepare('UPDATE hwp_versions SET byte_size=? WHERE id=?').bind(bytes.length,corrupt.version_id).run();
  await mf.setOptions(options());db=await mf.getD1Database('DB');bucket=await mf.getR2Bucket('BUCKET');
  const afterRestart=await get();assert.equal(afterRestart.status,200);assert(!links(await afterRestart.text()).some(l=>l.doc===hidden.document_id));
  assert.deepEqual(await db.prepare('SELECT display_name,name_revision FROM hwp_documents WHERE id=?').bind(doc.document_id).first(),{display_name:name,name_revision:4});
  assert.equal(outbound,0);
  console.log(JSON.stringify({document_list_contract:'passed',actual_workerd_d1_r2_wasm:true,identity_is_mock_not_oauth:true,
    owner_scope:true,tied_timestamp_pagination_no_gaps:true,explicit_current_version:true,pending_deletion_excluded:true,
    metadata_corruption_refused:true,read_only_capture_unchanged:true,restart_verified:true,layout_verified:false,
    names_owner_scoped:true,names_content_versions_requests_blobs_unchanged:true,names_exact_retry:true,names_conflicts_and_aba_refused:true,names_same_origin:true,names_escape_markup:true,names_restart_verified:true,names_existing_schema_upgrade_verified:true,
    search_korean_names_and_ascii_case:true,search_literal_not_wildcard:true,search_owner_and_deletion_scoped:true,search_pagination_no_gaps:true,search_read_only_capture_unchanged:true}));
}finally{await mf.dispose();}
