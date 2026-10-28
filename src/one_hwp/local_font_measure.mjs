/** Disposable source-font measurements. No scratch bytes reach a writer. */
import {parseRecords} from './guard/records.mjs';
import {readCfb,readHwp} from './guard/container.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {view,fail,encodeRecords} from './local_complex_records.mjs';

export function createNaturalTextMeasurer(HwpDocument,source,{prefixProof=false}={}){
 let template;const cache=new Map();
 const families=new Set(['함초롬바탕','HCR Batang','함초롬돋움','HCR Dotum']);
 const input=()=>{
  if(template)return template;if(!source)fail('TEXT_MEASURE_SOURCE_REQUIRED');
  const raw=readHwp(source),empty=HwpDocument.createEmpty();let bytes;
  try{bytes=empty.exportHwp();}finally{empty.free();}
  // createEmpty exports a zero version. Only the private template receives
  // the source format version and exact definitions; the source is immutable.
  const header=readCfb(bytes).get('FileHeader').slice();header.set(raw.streams.get('FileHeader').subarray(32,36),32);
  if(view(header).getUint32(36,true)!==0)fail('TEXT_MEASURE_TEMPLATE_UNVERIFIED');
  const definitions=[...parseRecords(raw.streams.get('DocInfo'))].map(r=>({...r,payload:r.payload.slice()})),paragraph=definitions.find(r=>r.tag===25);
  if(!paragraph||![46,54,58].includes(paragraph.payload.length))fail('TEXT_MEASURE_TEMPLATE_UNVERIFIED');
  // Paragraph zero belongs to the scratch document, not to the source block.
  // Keep original font/character records exact but remove unrelated defaults.
  paragraph.payload=new Uint8Array(paragraph.payload.length);const p=view(paragraph.payload);p.setUint32(0,0x184,true);p.setInt32(24,160,true);if(paragraph.payload.length>=54)p.setInt32(50,160,true);
  template=patchLocalPackedStreams(bytes,new Map([['FileHeader',header],['DocInfo',encodeRecords(definitions)]]));return template;
 };
 const measure=(text,runs)=>{
  if(text==='')return [];if(typeof text!=='string'||text.length>20000||!Array.isArray(runs))fail('NESTED_PLACEMENT_CHECK_LIMIT');
  const key=JSON.stringify([text,runs]);if(cache.has(key))return cache.get(key).widths;
  const doc=new HwpDocument(input());try{
   doc.insertText(0,0,0,text);doc.applyParaFormat(0,0,JSON.stringify({alignment:'left',marginLeft:0,marginRight:0,indent:0,spacingBefore:0,spacingAfter:0}));
   let end=0,trusted=prefixProof&&text.length<=1024&&typeof doc.getFontDecisionTrace==='function';const count=[...text].length,ids=[];
   for(const run of runs){
    const p=run.properties,id=p?.charShapeId;
    if(run.start!==end||!Number.isInteger(run.end)||run.end<=end||run.end>count||!Number.isInteger(id)||id<0||id>65534)fail('NESTED_PLACEMENT_FONT_UNVERIFIED');
    try{if(JSON.parse(doc.setCharShapeId(0,0,run.start,run.end,id)).ok!==true)fail('NESTED_PLACEMENT_FONT_UNVERIFIED');}catch{fail('NESTED_PLACEMENT_FONT_UNVERIFIED');}
    // Resolve actual source properties even when the caller used a fast raw
    // inspection containing only shape IDs and sizes.
    let actual;try{actual=JSON.parse(doc.getCharPropertiesAt(0,0,run.start));}catch{fail('NESTED_PLACEMENT_FONT_UNVERIFIED');}
    if(actual.charShapeId!==id||actual.fontSize!==p.fontSize||p.fontFamilies===undefined&&p.fontFamily!==undefined&&actual.fontFamily!==p.fontFamily||p.fontFamilies!==undefined&&JSON.stringify(actual.fontFamilies)!==JSON.stringify(p.fontFamilies)||['ratios','relativeSizes'].some(k=>actual[k]?.some(n=>n<50||n>200))||actual.spacings?.some(n=>n< -20||n>50)||actual.charOffsets?.some(n=>n!==0)||actual.subscript||actual.superscript||actual.kerning||['bold','italic'].some(k=>p[k]!==undefined&&p[k]!==actual[k]))fail('NESTED_PLACEMENT_FONT_UNVERIFIED');
    trusted&&=['ratios','relativeSizes'].every(k=>actual[k]?.every(n=>n===100))&&actual.spacings?.every(n=>n===0)&&actual.fontFamilies.every(f=>families.has(f))&&!actual.bold&&!actual.italic;for(let i=run.start;i<run.end;i++)ids.push(id);end=run.end;
   }
   if(end!==count)fail('NESTED_PLACEMENT_FONT_UNVERIFIED');
   const pages=doc.pageCount();if(pages>32)fail('NESTED_PLACEMENT_CHECK_LIMIT');const observed=[];
   for(let page=0;page<pages;page++)observed.push(...JSON.parse(doc.getPageTextLayout(page)).runs.filter(r=>r.text));
   if(observed.map(r=>r.text).join('').replaceAll('\n','')!==text.replaceAll('\n',''))fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');
   const widths=[];for(const r of observed){const chars=[...r.text];if(!Array.isArray(r.charX)||r.charX.length!==chars.length+1)fail('NESTED_PLACEMENT_INLINE_PREFIX_UNVERIFIED');for(let i=0;i<chars.length;i++)if(chars[i]!=='\n')widths.push(r.charX[i+1]-r.charX[i]);}
   if(trusted){
    const records=[];for(let page=0;page<pages;page++){let trace;try{trace=JSON.parse(doc.getFontDecisionTrace(page,JSON.stringify({maxCharacters:2048})));}catch{trusted=false;break;}if(trace.schemaVersion!==1||!Array.isArray(trace.records)){trusted=false;break;}records.push(...trace.records);}
    let offset=0,index=0;for(const ch of text){if(ch!=='\n'){const samples=records.filter(r=>r.source?.status==='complete'&&r.source.sectionIndex===0&&r.source.paragraphIndex===0&&Array.isArray(r.source.nestedPath)&&r.source.nestedPath.length===0&&r.source.charOffset===offset&&r.source.character===ch&&r.source.charShapeId===ids[index]),m=samples[0]?.layoutMetric;if(samples.length!==1||!m||m.matchKind!=='exact'||m.characterMatch!=='hit'||!['embeddedMetric','metricHalfSpace'].includes(m.widthSource)||!Number.isFinite(m.baseAdvanceHwpunit))trusted=false;}offset+=ch.length;index++;}
   }
   Object.freeze(widths);cache.set(key,{widths,trusted});return widths;
  }finally{doc.free();}
 };
 measure.isExact=(text,runs)=>{if(!text)return true;measure(text,runs);return cache.get(JSON.stringify([text,runs])).trusted;};return measure;
}
