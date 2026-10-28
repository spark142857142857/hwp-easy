/** Give invisible section setup anchors the visible title's font in a private view.
 * The pinned renderer derives the first line's advance from the setup run.
 * Native HWP instead uses the visible text. Authoring bytes are never changed.
 */
import {readHwp} from './guard/container.mjs';
import {parseRecords} from './guard/records.mjs';
import {view,textTokens,encodeRecords} from './local_complex_records.mjs';
import {packLocalBodyRewrite} from './local_body_write.mjs';

export function prepareSetupFontRender(bytes){
 const raw=readHwp(bytes),fonts=[...parseRecords(raw.streams.get('DocInfo'))].filter(r=>r.tag===21),changes=new Map(),notes=[];
 for(const [name,data]of raw.streams){
  if(!/^BodyText\/Section\d+$/.test(name))continue;
  const rs=[...parseRecords(data)],head=rs[0];if(head?.tag!==66||head.level!==0||head.payload.length<22)continue;
  let end=1;while(end<rs.length&&rs[end].level>0)end++;
  const own=rs.slice(1,end).filter(r=>r.level===1),texts=own.filter(r=>r.tag===67),shapes=own.filter(r=>r.tag===68),controls=own.filter(r=>r.tag===71);
  if(texts.length!==1||shapes.length!==1)continue;
  const names=controls.map(r=>Buffer.from(r.payload.subarray(0,4)).toString());
  if(names.filter(n=>n==='dces').length!==1||names.filter(n=>n==='dloc').length!==1||names.some(n=>!['dces','dloc','toof','daeh'].includes(n)))continue;
  const tokens=textTokens(texts[0].payload),setup=tokens.slice(0,2),rest=tokens.slice(2,-1),visible=rest.filter(t=>t.text),shape=shapes[0],fixed=rest.filter(t=>!t.text);
  if(setup.some((t,i)=>t.code!==2||t.unit!==i*8)||setup.length!==2||!visible.length||visible.some(t=>t.code<32)||fixed.length!==controls.length-2||fixed.some(t=>t.code!==16||t.length!==8||t.unit<visible.at(-1).unit||!['toof','daeh'].includes(Buffer.from(texts[0].payload.subarray(t.unit*2+2,t.unit*2+6)).toString()))||tokens.at(-1).code!==13||shape.payload.length<16||shape.payload.length>256||shape.payload.length%8)continue;
  const p=view(shape.payload),runs=Array.from({length:shape.payload.length/8},(_,i)=>({at:p.getUint32(i*8,true),id:p.getUint32(i*8+4,true)})),units=texts[0].payload.length/2;
  if(runs[0].at!==0||runs.some((r,i)=>r.at>=units||!fonts[r.id]||i&&r.at<=runs[i-1].at))continue;
  const styleAt=unit=>runs.findLast(r=>r.at<=unit).id,selected=styleAt(16),prior=runs[0].id;
  if(selected===prior||runs.some(r=>r.at>0&&r.at<16)||visible.some(t=>styleAt(t.unit)!==selected||t.length===2&&styleAt(t.unit+1)!==selected))continue;
  const a=fonts[prior].payload,b=fonts[selected].payload;
  if(![70,74].includes(a.length)||![70,74].includes(b.length)||view(a).getUint32(42,true)===view(b).getUint32(42,true))continue;
  if([a,b].some(f=>view(f).getUint32(42,true)<100||view(f).getUint32(42,true)>20000||[...f.subarray(28,35)].some(n=>n!==100)))continue;
  const out=rs.map(r=>({...r,payload:r.payload.slice()}));view(out[rs.indexOf(shape)].payload).setUint32(4,selected,true);view(out[0].payload).setUint16(16,0,true);
  changes.set(name,encodeRecords(out.filter((r,i)=>!(i<end&&r.tag===69&&r.level===1))));notes.push({kind:'setup_anchor_font',section:Number(name.slice(16)),paragraph:0,source_char_shape:prior,render_char_shape:selected});
 }
 return {bytes:changes.size?packLocalBodyRewrite(bytes,raw,changes):bytes,notes};
}
