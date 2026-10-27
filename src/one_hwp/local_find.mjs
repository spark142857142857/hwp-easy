/** Exact, read-only search over fully assembled supported body/cell blocks. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
import {digest} from './local_file.mjs';
const fail=code=>{throw new GuardError(code);};
const positionKeys=['kind','section','paragraph','control','cell','cell_paragraph','row','column','row_span','column_span','cell_path','list_id','text_box_id','object_path'];
export function validateFind(options,version){
  const {query,max_matches=50,cursor}=options;
  if(typeof query!=='string'||!query.length||query.length>256||!query.isWellFormed()||/[\u0000-\u001f]/.test(query))fail('INVALID_SEARCH_QUERY');
  if(!Number.isSafeInteger(max_matches)||max_matches<1||max_matches>200)fail('INVALID_SEARCH_LIMIT');
  if(cursor!==undefined&&(!cursor||Object.getPrototypeOf(cursor)!==Object.prototype
    ||JSON.stringify(Object.keys(cursor).sort())!==JSON.stringify(['sha256','query_sha256','block_index','offset'].sort())))fail('INVALID_SEARCH_CURSOR');
  const query_sha256=digest(Buffer.from(query));
  if(cursor!==undefined){
    if(typeof cursor.sha256!=='string'||!/^[0-9a-f]{64}$/.test(cursor.sha256))fail('INVALID_SEARCH_CURSOR');
    if(version!==undefined&&cursor.sha256!==version)fail('CURSOR_VERSION_CONFLICT');
    if(cursor.query_sha256!==query_sha256||!Number.isSafeInteger(cursor.block_index)||cursor.block_index<0
      ||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)fail('INVALID_SEARCH_CURSOR');
  }
  return {query,max_matches,cursor,query_sha256};
}
export function findLocalDocument(document,options){
  const version=document.source_sha256,{query,max_matches,cursor,query_sha256}=validateFind(options,version),blocks=[];
  let pageCursor,base;
  do{
    const page=document.read({expected_sha256:version,max_chars:64000,max_blocks:128,...(pageCursor?{cursor:pageCursor}:{})});
    if(!page.target_mapping_verified)fail('TARGET_MAPPING_UNVERIFIED');
    base??=page;
    for(const fragment of page.blocks){
      let block;
      if(fragment.start_offset===0){block={...Object.fromEntries(positionKeys.filter(k=>Object.hasOwn(fragment,k)).map(k=>[k,fragment[k]])),
        id:fragment.id,target_id:fragment.target_id,text:'',end_offset:0,total_chars:fragment.total_chars};blocks.push(block);}
      else block=blocks.at(-1);
      if(!block||block.id!==fragment.id||block.end_offset!==fragment.start_offset||block.total_chars!==fragment.total_chars)fail('SEARCH_READ_INCOMPLETE');
      block.text+=fragment.text;block.end_offset=fragment.end_offset;
    }
    pageCursor=page.next_cursor;
  }while(pageCursor);
  for(const box of base.text_boxes??[])for(const p of box.paragraphs)blocks.push({kind:'text_box_paragraph',id:p.id,target_id:p.target_id,text:p.text,text_box_id:box.id,object_path:box.object_path,section:box.section,paragraph:p.paragraph,cell_path:box.cell_path,end_offset:[...p.text].length,total_chars:[...p.text].length});
  if(blocks.some(b=>b.end_offset!==b.total_chars))fail('SEARCH_READ_INCOMPLETE');
  let index=0,offset=0;
  if(cursor!==undefined){
    if(cursor.sha256!==version)fail('CURSOR_VERSION_CONFLICT');
    if(cursor.query_sha256!==query_sha256||!Number.isSafeInteger(cursor.block_index)||!blocks[cursor.block_index]
      ||!Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.offset>blocks[cursor.block_index].total_chars)fail('INVALID_SEARCH_CURSOR');
    index=cursor.block_index;offset=cursor.offset;
  }
  const matches=[],length=[...query].length;
  const result=next=>({source_sha256:version,query,match_mode:'exact_case_sensitive_nonoverlapping_within_one_block',
    offsets:'unicode_code_points',matches,returned_matches:matches.length,complete:next===null,next_cursor:next,
    scope:base.text_boxes?.length?'supported_paragraph_cell_and_text_box_blocks':'supported_paragraph_and_cell_blocks',all_content_supported:base.all_content_supported,
    unsupported:base.unsupported,target_mapping_verified:true,saved:false,persistence:'local_file'});
  for(;index<blocks.length;index++,offset=0){
    const block=blocks[index];let utf16=0,point=0,points;
    while(point<offset){utf16+=block.text.codePointAt(utf16)>0xffff?2:1;point++;}
    for(let found;(found=block.text.indexOf(query,utf16))!==-1;){
      while(utf16<found){utf16+=block.text.codePointAt(utf16)>0xffff?2:1;point++;}
      if(matches.length===max_matches)return result({sha256:version,query_sha256,block_index:index,offset:point});
      points??=[...block.text];
      const start=Math.max(0,point-20),end=Math.min(points.length,point+length+20);
      matches.push({...Object.fromEntries(positionKeys.filter(k=>Object.hasOwn(block,k)).map(k=>[k,block[k]])),
        target_id:block.target_id,start:point,end:point+length,whole_block_chars:block.total_chars,
        excerpt:{text:points.slice(start,end).join(''),start,end}});
      point+=length;utf16=found+query.length;
    }
  }
  return result(null);
}
