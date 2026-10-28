/** Bounded raw inline flow. Rendered nested table origins are not native origins. */
import {view,equal,fail} from './local_complex_records.mjs';
import {trackPositions} from './local_complex_table.mjs';
import {parseRecords} from './guard/records.mjs';

export const cellPads=(rs,t,c)=>(view(rs[c.start].payload).getUint32(4,true)&0x10000)?[24,26,28,30].map(at=>view(rs[c.start].payload).getUint16(at,true)/75):['Left','Right','Top','Bottom'].map(k=>t.properties['padding'+k]/75);
export function inlineTableFlow(r){
 if(r?.tag!==71||r.payload.length<36)fail('NESTED_PLACEMENT_TABLE_PROFILE_UNSUPPORTED');
 const v=view(r.payload),f=v.getUint32(4,true);
 if(!(f&1)||((f>>>15)&7)!==4||((f>>>18)&3)!==2)fail('NESTED_PLACEMENT_TABLE_PROFILE_UNSUPPORTED');
 return {left:v.getUint16(28,true)/75,right:v.getUint16(30,true)/75,top:v.getUint16(32,true)/75,bottom:v.getUint16(34,true)/75};
}
const plain=p=>p&&['left','justify'].includes(p.alignment)&&['marginLeft','marginRight','indent','spacingBefore','spacingAfter'].every(k=>p[k]===0)&&p.lineSpacingType===0&&p.lineSpacing>=100&&p.lineSpacing<=300&&!p.fontLineHeight&&!p.pageBreakBefore;
export function needsComposedCellFlow(state,box){
 return box.cell_path.slice(0,-1).some((p,i)=>{
  const t=state.tables.find(t=>t.section===box.section&&t.paragraph===box.paragraph&&equal(t.cell_path,box.cell_path.slice(0,i))&&t.control===p.controlIndex),c=t?.cells.find(c=>c.cell===p.cellIndex);
  return c&&(c.blocks.length!==1||c.blocks.some(b=>{const children=state.tables.filter(t=>t.parent_id===b.id),pad=cellPads(state.recordSets.get(t.section),t,c),roughText=[...b.text].length*Math.max(1000,...(b.character_runs??[]).map(r=>r.properties.fontSize))/75;return b.text.includes('\n')||children.length>1||b.text.length>16||b.text.length>0&&roughText+children.reduce((n,t)=>n+t.properties.tableWidth/75+8,0)>c.width/75-pad[0]-pad[1];}));
 });
}

/** All tables in the root are measured before accepting any native cell origin.
 * Stored cell sizes are minima: insufficient room is refused, never interpreted
 * as a new grid. Limits bound hostile documents and ambiguous wrap decisions. */
export function composeCellTables(state,root,snapshot,selectedRootCell){
 const rs=state.recordSets.get(root.section);for(const t of state.tables)if(t!==root&&t.section===root.section&&t.paragraph===root.paragraph)inlineTableFlow(rs[t.record_index]);
 // Exact, source-bound regular Hamchorom widths use a 1% sensitivity band.
 // Unknown metrics retain 4%; uncertain vertical wraps still refuse saving.
 const samples=[.96,1,1.04].map(scale=>compose(state,root,snapshot,selectedRootCell,scale)),middle=samples[1];
 for(const [table,layout]of middle)for(const [child,p]of layout.children){
  const positions=samples.map(s=>s.get(table).children.get(child));
  if(positions.some(q=>Math.abs(q.y-p.y)>.5))fail('NESTED_PLACEMENT_WRAP_UNVERIFIED');
  const lo=Math.min(...positions.map(q=>q.x)),hi=Math.max(...positions.map(q=>q.x));p.x=(lo+hi)/2;p.error=hi-lo>0?(hi-lo)/2+1:0;
 }
 return middle;
}
function compose(state,root,snapshot,selectedRootCell,scale){
 const rs=state.recordSets.get(root.section),fonts=[...parseRecords(state.raw.streams.get('DocInfo'))].filter(r=>r.tag===21),layouts=new Map(),visiting=new Set();let work=0;
 const tick=()=>{if(++work>200000)fail('NESTED_PLACEMENT_CHECK_LIMIT');};
 function textMetrics(b){
  if(!b.unit_styles||!plain(b.paragraph_properties)||b.text.length>10000||!/^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\p{Zs}\n]*$/u.test(b.text))fail('NESTED_PLACEMENT_PARAGRAPH_UNVERIFIED');
  const sizes=new Set(b.unit_styles.map(id=>{const r=fonts[id];if(!r||r.payload.length<46)fail('NESTED_PLACEMENT_FONT_UNVERIFIED');return view(r.payload).getUint32(42,true)/75;}));
  // Mixed font metrics/complex scripts need a shaping model, not an average.
  if(sizes.size!==1)fail('NESTED_PLACEMENT_FONT_UNVERIFIED');const size=[...sizes][0];if(!(size>=1&&size<=200))fail('NESTED_PLACEMENT_FONT_UNVERIFIED');
  if(typeof snapshot.measureInlineText!=='function')fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');
  const widths=b.text?snapshot.measureInlineText(b.text,b.character_runs):[];
  if(widths.some(w=>!Number.isFinite(w)||w<0||w>size*3))fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');
  return {size,gap:size*(b.paragraph_properties.lineSpacing/100-1),widths,exact:snapshot.measureInlineText.isExact?.(b.text,b.character_runs)===true};
 }
 function tableLayout(t){
  tick();if(visiting.has(t)||t.cell_path.length>2||!t.layout_editable||t.properties.cellSpacing!==0)fail('NESTED_PLACEMENT_GRID_UNVERIFIED');if(layouts.has(t))return layouts.get(t);visiting.add(t);
  let xs,ys;try{xs=trackPositions(t,'col');ys=trackPositions(t,'row');}catch{fail('NESTED_PLACEMENT_GRID_UNVERIFIED');}
  if(xs.some(x=>x===null)||ys.some(y=>y===null)||xs.at(-1)!==t.properties.tableWidth||ys.at(-1)!==t.properties.tableHeight)fail('NESTED_PLACEMENT_GRID_UNVERIFIED');
  const cells=new Map(),children=new Map();
  for(const c of t.cells){
   tick();const flags=view(rs[c.start].payload).getUint32(4,true),align=(flags>>>5)&3,pad=cellPads(rs,t,c),w=c.width/75-pad[0]-pad[1],h=c.height/75-pad[2]-pad[3];
   if((flags&7)!==0||align>2||c.blocks.length>16||w<=0||xs[c.col+c.colSpan]-xs[c.col]!==c.width||ys[c.row+c.rowSpan]-ys[c.row]!==c.height)fail('NESTED_PLACEMENT_GRID_UNVERIFIED');
   cells.set(c.cell,{x:xs[c.col]/75,y:ys[c.row]/75,w:c.width/75,h:c.height/75,pad});
   // Later root rows cannot move a preceding cell's origin. Their automatic
   // growth/pagination remains outside this placement proof (F2).
   if(t===root&&c.row>=selectedRootCell.row+selectedRootCell.rowSpan){for(const b of c.blocks)for(const child of state.tables.filter(t=>t.parent_id===b.id))tableLayout(child);continue;}
   if(h<=0)fail('NESTED_PLACEMENT_FLOW_EXCEEDS_FIXED_CELL');
   let y=0,lastGap=0,error=0;const positions=[];
   for(const b of c.blocks){
    const m=textMetrics(b);if(y)y+=lastGap;let x=0,lineHeight=m.size,lineError=0,index=0,line=[],atoms=0,textAtoms=0;
    const finish=(justify=false)=>{const stretch=justify&&b.paragraph_properties.alignment==='justify'&&textAtoms>0&&atoms>1?(w-x)/(atoms-1):0;for(const item of line)positions.push({...item,x:item.x+stretch*item.before,y:y+lineHeight-item.height});y+=lineHeight;line=[];x=0;atoms=0;textAtoms=0;lineHeight=m.size;error=Math.max(error,lineError);lineError=0;};
    const wrap=(justify=true)=>{finish(justify);y+=m.gap;};
    const put=(width,height,item=null,count=1)=>{tick();if(x>0&&x+width>w)wrap();if(width>w)fail('NESTED_PLACEMENT_TABLE_BOUNDS_UNVERIFIED');if(item)line.push({...item,x,error:lineError,height,before:atoms});else textAtoms+=count;atoms+=count;x+=width;lineHeight=Math.max(lineHeight,height);};
    const controls=rs.slice(b.record_index+1,b.records_end).filter(r=>r.tag===71&&r.level===b.raw_level+1),anchors=b.tokens.filter(t=>t.code===11);let ordinal=0;
    if(controls.length!==anchors.length||b.tokens.some(t=>!t.text&&![11,13].includes(t.code)))fail('NESTED_PLACEMENT_CONTENT_UNVERIFIED');
    let word=[];const flushWord=()=>{const width=word.reduce((a,b)=>a+b,0);if(width>w){for(const glyph of word)put(glyph,m.size);}else if(width)put(width,m.size,null,word.length);word=[];};
    for(const token of b.tokens){
     if(!token.text||!/^[A-Za-z0-9]$/.test(token.text))flushWord();
     if(token.code===13)break;if(token.code===10){wrap(false);continue;}
     if(token.text){const width=m.widths[index++]*(m.exact?1+(scale-1)/4:scale);if(!Number.isFinite(width))fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');if(/^[A-Za-z0-9]$/.test(token.text))word.push(width);else put(width,m.size);lineError+=Math.max(.1,width*.04);continue;}
     const record=controls[ordinal++],anchor=rs[b.text_record]?.payload.subarray(token.unit*2+2,token.unit*2+6);if(!record||!anchor||!equal([...anchor],[...record.payload.subarray(0,4)]))fail('NESTED_PLACEMENT_CONTROL_MAPPING_UNVERIFIED');const child=state.tables.find(t=>rs[t.record_index]===record&&t.parent_id===b.id);
     if(child){const margins=inlineTableFlow(record);tableLayout(child);put(child.properties.tableWidth/75+margins.left+margins.right,child.properties.tableHeight/75+margins.top+margins.bottom,{table:child,margins});}
     else{const f=record?.payload.length>=36?view(record.payload):null,flags=f?.getUint32(4,true);if(!f||Buffer.from(record.payload.subarray(0,4)).toString()!==' osg'||(flags&1)||((flags>>>21)&7)!==3)fail('NESTED_PLACEMENT_CONTENT_UNVERIFIED');}
    }
    finish();lastGap=m.gap;
   }
   if(y>h+.5)fail('NESTED_PLACEMENT_FLOW_EXCEEDS_FIXED_CELL');const shift=align===1?(h-y)/2:align===2?h-y:0;
   cells.set(c.cell,{x:xs[c.col]/75,y:ys[c.row]/75,w:c.width/75,h:c.height/75,pad,error});
   for(const item of positions)children.set(item.table,{x:xs[c.col]/75+pad[0]+item.x+item.margins.left,y:ys[c.row]/75+pad[2]+shift+item.y+item.margins.top,error:item.error});
  }
  const result={cells,children};layouts.set(t,result);visiting.delete(t);return result;
 }
 tableLayout(root);return layouts;
}
