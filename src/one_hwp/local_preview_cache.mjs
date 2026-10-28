/** Refresh derived preview streams after a verified edit; never rewrite document records. */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {HwpDocument,initSync} from '@rhwp/core';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import {readHwp} from './guard/container.mjs';
import {GuardError,parseRecords} from './guard/records.mjs';
import {patchLocalPackedStreams} from './local_container_write.mjs';
import {renderLocalPreview} from './local_render_view.mjs';

let initialized;
const fail=code=>{throw new GuardError(code);};
function resource(name,fallback){const bundled=new URL(`./${name}`,import.meta.url);return fs.readFileSync(fs.existsSync(bundled)?bundled:new URL(fallback,import.meta.url));}
async function renderer(){
 if(!initialized)initialized=initWasm(resource('resvg_bg.wasm','../../node_modules/@resvg/resvg-wasm/index_bg.wasm'));
 await initialized;
}
export function bitmap24(pixels,width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>256||height>256||pixels.length!==width*height*4)fail('PREVIEW_REFRESH_FAILED');
 const stride=(width*3+3)&~3,bytes=Buffer.alloc(54+stride*height,0);bytes.write('BM');bytes.writeUInt32LE(bytes.length,2);bytes.writeUInt32LE(54,10);
 bytes.writeUInt32LE(40,14);bytes.writeInt32LE(width,18);bytes.writeInt32LE(height,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);bytes.writeUInt32LE(stride*height,34);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const from=(y*width+x)*4,to=54+(height-y-1)*stride+x*3,alpha=pixels[from+3]/255;
  for(let channel=0;channel<3;channel++)bytes[to+channel]=Math.round(pixels[from+2-channel]*alpha+255*(1-alpha));
 }
 return bytes;
}
export async function rasterizeLocalSvg(svg){
 if(typeof svg!=='string'||Buffer.byteLength(svg)>8*1024*1024)fail('PREVIEW_REFRESH_FAILED');
 await renderer();
 const font=resource('NanumGothic-Regular.ttf','../../vendor/local-preview/NanumGothic-Regular.ttf');
 let tree,image;
 try{
  // Parsing creates no raster. Bound the output using the parsed page size,
  // including landscape and unusually narrow/wide pages, before allocating it.
  tree=new Resvg(svg,{background:'#ffffff',font:{fontBuffers:[font],defaultFontFamily:'NanumGothic',sansSerifFamily:'NanumGothic',serifFamily:'NanumGothic',monospaceFamily:'NanumGothic'}});
  const width=tree.width,height=tree.height;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>100000||height>100000)fail('PREVIEW_REFRESH_FAILED');
  tree.free();tree=undefined;
  tree=new Resvg(svg,{background:'#ffffff',fitTo:{mode:'zoom',value:Math.min(1,180/Math.max(width,height))},font:{fontBuffers:[font],defaultFontFamily:'NanumGothic',sansSerifFamily:'NanumGothic',serifFamily:'NanumGothic',monospaceFamily:'NanumGothic'}});
  image=tree.render();return {bytes:bitmap24(image.pixels,image.width,image.height),width:image.width,height:image.height};
 }finally{image?.free();tree?.free();}
}
export function localPreviewText(bytes){
 const raw=readHwp(bytes),parts=[];let units=0;
 const bodies=[...raw.streams].filter(([name])=>name.startsWith('BodyText/Section')).sort(([a],[b])=>Number(a.slice(16))-Number(b.slice(16)));
 outer:for(const [,stream]of bodies)for(const record of parseRecords(stream))if(record.tag===67){
  const data=record.payload,view=new DataView(data.buffer,data.byteOffset,data.length);let line='';
  for(let offset=0;offset<data.length;){
   if(offset+2>data.length)fail('PREVIEW_REFRESH_FAILED');const code=view.getUint16(offset,true),width=code>=1&&code<=9||code===11||code===12||code>=14&&code<=23?16:2;
   if(offset+width>data.length)fail('PREVIEW_REFRESH_FAILED');
   if(code>=32||code===9||code===10){line+=String.fromCharCode(code);if(units+line.length>=4096){parts.push(line);break outer;}}
   offset+=width;
  }
  line+='\r\n';parts.push(line);units+=line.length;if(units>=4096)break outer;
 }
 let text=parts.join('').slice(0,4096);if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);return text;
}
export async function renderPreviewWorker(bytes){
 initSync({module:resource('rhwp_bg.wasm','../../node_modules/@rhwp/core/rhwp_bg.wasm')});
 const preview=renderLocalPreview(HwpDocument,bytes,0),rendered=await rasterizeLocalSvg(preview.svg);return {ok:true,image:Buffer.from(rendered.bytes).toString('base64'),width:rendered.width,height:rendered.height,render_flow_adaptations:preview.render_flow_adaptations,render_adaptations:preview.render_adaptations,render_unadapted_anchors:preview.render_unadapted_anchors,render_nested_tables:preview.render_nested_tables,render_unadapted_tables:preview.render_unadapted_tables,render_cell_wraps:preview.render_cell_wraps,render_unadapted_cells:preview.render_unadapted_cells,render_unadapted_drawings:preview.render_unadapted_drawings};
}
export async function refreshLocalPreview(_HwpDocument,bytes){
 const text=localPreviewText(bytes);
 // Native/WASM layout may loop on an unsupported profile. Isolate only this
 // derived image work; a timeout cannot hang an otherwise verified file edit.
 const child=spawnSync(process.execPath,['--max-old-space-size=256',fileURLToPath(import.meta.url),'--preview-worker'],{input:Buffer.from(bytes),encoding:'utf8',timeout:5000,maxBuffer:512*1024,windowsHide:true});
 let rendered;
 if(child.status===0&&!child.error){try{const value=JSON.parse(child.stdout);if(value.ok===true)rendered={bytes:Buffer.from(value.image,'base64'),width:value.width,height:value.height,render_flow_adaptations:value.render_flow_adaptations,render_adaptations:value.render_adaptations,render_unadapted_anchors:value.render_unadapted_anchors,render_nested_tables:value.render_nested_tables,render_unadapted_tables:value.render_unadapted_tables,render_cell_wraps:value.render_cell_wraps,render_unadapted_cells:value.render_unadapted_cells,render_unadapted_drawings:value.render_unadapted_drawings};}catch{}}
 const changes=new Map([['PrvText',Buffer.from(text,'utf16le')],['PrvImage',rendered?.bytes??Buffer.alloc(0)]]);
 const result=patchLocalPackedStreams(bytes,changes);
 return {bytes:result,preview_cache:{status:rendered?'updated':'text_updated_image_unavailable',text_excerpt:true,text_units:text.length,image_format:rendered?'BMP':null,image_width:rendered?.width??null,image_height:rendered?.height??null,render_flow_adaptations:rendered?.render_flow_adaptations??[],render_adaptations:rendered?.render_adaptations??[],render_unadapted_anchors:rendered?.render_unadapted_anchors??[],render_nested_tables:rendered?.render_nested_tables??[],render_unadapted_tables:rendered?.render_unadapted_tables??[],render_cell_wraps:rendered?.render_cell_wraps??[],render_unadapted_cells:rendered?.render_unadapted_cells??[],render_unadapted_drawings:rendered?.render_unadapted_drawings??[],image_content_complete:rendered?.render_unadapted_drawings?.length?false:null,...(!rendered?{image_failure:child.error?.code==='ETIMEDOUT'?'RENDER_TIMEOUT':'RENDER_FAILED',stale_image_cleared:true}:{}),page:0,renderer:'rhwp SVG + resvg WASM',fallback_font:'NanumGothic',font_substitution_possible:true,layout_verified:false,document_streams_preserved:true}};
}
if(process.argv[1]&&/[\\/]local_preview_cache\.mjs$/.test(process.argv[1])&&fileURLToPath(import.meta.url)===process.argv[1]&&process.argv[2]==='--preview-worker'){
 console.error=()=>{};
 try{const bytes=fs.readFileSync(0);if(bytes.length>4*1024*1024)fail('INPUT_LIMIT_EXCEEDED');process.stdout.write(JSON.stringify(await renderPreviewWorker(bytes)));}
 catch{process.stdout.write(JSON.stringify({ok:false}));process.exitCode=1;}
}
