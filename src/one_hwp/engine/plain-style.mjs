/** Complete plain-text UTF-16 envelopes and bounded mixed raw shape runs. */
import {parseRecords} from '../guard/records.mjs';
import {MAX_MIXED_STYLE_RUNS} from '../mixed_style.mjs';
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
export function rawPlainStyleProofs(decoded,blocks,mapping){
 const selected=new Map(blocks.filter(b=>b.text.length>2048&&b.text.isWellFormed()&&!/[\u0000-\u001f]/.test(b.text)).map(b=>{const p=mapping.get(b.id);return [`${p?.section}:${p?.record_index}`,b];})),proofs=new Map();
 if(!selected.size)return proofs;
 for(const section of decoded.profile.sections){let ordinal=-1,active;
  const finish=()=>{
   if(!active)return;const {header,children,block}=active,h=view(header.payload),[text,shape,lines]=children;
   if(![22,24].includes(header.payload.length)||children.length!==3||h.getUint32(4,true)!==0||h.getUint16(14,true)!==0
     ||text.tag!==67||shape.tag!==68||lines.tag!==69||children.some(r=>r.level!==header.level+1)
     ||text.payload.length!==(block.text.length+1)*2||(h.getUint32(0,true)&0x7fffffff)!==text.payload.length/2
     ||!shape.payload.length||shape.payload.length%8||shape.payload.length/8>MAX_MIXED_STYLE_RUNS||h.getUint16(12,true)!==shape.payload.length/8
     ||!lines.payload.length||lines.payload.length%36||h.getUint16(16,true)!==lines.payload.length/36)return;
   const t=view(text.payload),v=view(shape.payload);if(t.getUint16(block.text.length*2,true)!==13)return;
   for(let i=0;i<block.text.length;i++)if(t.getUint16(i*2,true)!==block.text.charCodeAt(i))return;
   const offsets=new Map();let unit=0,count=0;for(const ch of block.text){offsets.set(unit,count++);unit+=ch.length;}offsets.set(unit,count);
   const runs=[];for(let p=0;p<shape.payload.length;p+=8){const position=v.getUint32(p,true),start=offsets.get(position),id=v.getUint32(p+4,true);
    if(start===undefined||start>=count||(!p&&start!==0)||(p&&start<=runs.at(-1).start))return;
    if(runs.length)runs.at(-1).end=start;runs.push({start,end:count,char_shape_id:id});
   }
   // Adjacent identical anchors have no semantic boundary in the model.
   const merged=[];for(const r of runs){if(merged.at(-1)?.char_shape_id===r.char_shape_id)merged.at(-1).end=r.end;else merged.push({...r});}proofs.set(block.id,merged);
  };
  for(const record of parseRecords(decoded.streams.get(`BodyText/Section${section.section}`))){
   if(active&&(record.tag===66||record.level<=active.header.level)){if(record.level>active.header.level&&active.children.length<4)active.children.push(record);finish();active=undefined;}
   if(record.tag===66){ordinal++;const block=selected.get(`${section.section}:${ordinal}`);if(block&&record.level===(block.kind==='paragraph'?0:2))active={header:record,children:[],block};}
   else if(active&&active.children.length<4)active.children.push(record);
  }finish();
 }return proofs;
}
