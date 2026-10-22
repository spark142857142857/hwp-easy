/** Bounded horizontal text flow. These are conservative minima, not native layout. */
import {fail} from './local_complex_records.mjs';

const graphemes=new Intl.Segmenter('und',{granularity:'grapheme'});
const words=new Intl.Segmenter('und',{granularity:'word'});
const supported=/^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Number}\p{Punctuation}\p{Symbol}\p{Zs}\p{Mark}\n]*$/u;

export function tableTextLines(b,width,measure){
 const p=b.paragraph_properties;
 if(!b.text_mapping_verified||!b.unit_styles||!p||p.lineSpacingType!==0||p.lineSpacing<100||p.lineSpacing>300||p.keepLines||p.keepWithNext||p.marginLeft||p.marginRight||p.indent||p.spacingBefore||p.spacingAfter||p.pageBreakBefore||b.text.length>10000)fail('TABLE_REFLOW_PARAGRAPH_PROFILE_UNSUPPORTED');
 if(!supported.test(b.text))fail('TABLE_REFLOW_SHAPING_UNVERIFIED');
 const points=[...b.text],sizes=[],profiles=[];
 for(const run of b.character_runs){const q=run.properties;if(!Number.isFinite(q.fontSize)||q.fontSize<100||q.fontSize>20000||['ratios','relativeSizes'].some(k=>q[k]?.some(n=>n!==100)))fail('TABLE_REFLOW_FONT_PROFILE_UNSUPPORTED');const profile=JSON.stringify([q.fontFamily,q.fontFamilies,q.fontSize,q.bold,q.italic]);for(let i=run.start;i<run.end;i++){sizes[i]=q.fontSize;profiles[i]=profile;}}
 if(points.some((_,i)=>!sizes[i]))fail('TABLE_REFLOW_FONT_PROFILE_UNSUPPORTED');
 const measured=measure(b.text,b.character_runs),advances=[];let next=0;
 for(const ch of points){const w=ch==='\n'?0:measured[next++]*75*1.04;if(!Number.isFinite(w)||w<0)fail('TABLE_REFLOW_FONT_PROFILE_UNSUPPORTED');advances.push(w);}
 if(next!==measured.length)fail('TABLE_REFLOW_FONT_PROFILE_UNSUPPORTED');
 const atoms=[];let scalar=0;
 for(const {segment,index} of graphemes.segment(b.text)){
  const chars=[...segment],n=chars.length,ss=sizes.slice(scalar,scalar+n),size=ss[0]??1000;
  // A format boundary inside a combining sequence has reader-dependent metrics.
  // Do not split or normalize the original sequence to make it measurable.
  if(profiles.slice(scalar,scalar+n).some(p=>p!==profiles[scalar])||/^\p{Mark}/u.test(segment)||(segment.match(/\p{Mark}/gu)?.length??0)>2||n>1&&/\p{Symbol}/u.test(segment))fail('TABLE_REFLOW_SHAPING_UNVERIFIED');
  let w=advances.slice(scalar,scalar+n).reduce((a,v)=>a+v,0);scalar+=n;
  if(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(segment))w=Math.max(w,size*1.04);
  atoms.push({start:index,end:index+segment.length,width:w,size,newline:segment==='\n'});
 }
 const available=width*.96;if(!Number.isFinite(available)||available<=0)fail('TABLE_REFLOW_CELL_PROFILE_UNSUPPORTED');
 const lines=[];let x=0,height=0,at=0;
 const finish=fallback=>{lines.push(height||fallback||1000);x=0;height=0;};
 const put=a=>{if(a.width>available)fail('TABLE_REFLOW_GLYPH_WIDTH_UNSUPPORTED');if(x>0&&x+a.width>available)finish(a.size);x+=a.width;height=Math.max(height,a.size);};
 // Preserve whole words where they fit; long words wrap only between complete
 // graphemes. Widths come from the full styled string, preserving its context.
 for(const word of words.segment(b.text)){
  const group=[];while(at<atoms.length&&atoms[at].start<word.index+word.segment.length)group.push(atoms[at++]);
  const total=group.reduce((n,a)=>n+a.width,0);
  if(word.isWordLike&&total<=available&&x>0&&x+total>available)finish(group[0]?.size);
  for(const a of group){if(a.newline){height=Math.max(height,a.size);finish(a.size);}else put(a);}
 }
 finish(sizes.at(-1));return lines;
}

export function tableParagraphHeight(b,width,measure){
 const lines=tableTextLines(b,width,measure),spacing=b.paragraph_properties.lineSpacing/100;
 // Adjacent mixed-size lines can share the larger baseline gap. Reserve it on
 // either side instead of multiplying every line by a paragraph-wide font size.
 return Math.max(1600,Math.ceil(lines.reduce((n,size,i)=>n+Math.max(size,lines[i-1]??size,lines[i+1]??size)*spacing,0)*1.08));
}
