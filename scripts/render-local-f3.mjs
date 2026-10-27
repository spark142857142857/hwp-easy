/** Full-resolution QA PNGs from the exact shipped SVG, never document edits. */
import fs from 'node:fs';import path from 'node:path';import {Resvg,initWasm} from '@resvg/resvg-wasm';
await initWasm(fs.readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const root=path.resolve(process.argv[2]),cases=JSON.parse(fs.readFileSync(path.join(root,'cases.json'),'utf8'));
for(const c of cases)for(const stage of ['before','after'])for(let p=0;p<c[stage+'_layout'].page_count;p++){
 const file=path.join(root,`${c.name}-${stage}-${p}`),renderer=new Resvg(fs.readFileSync(file+'.svg'),{background:'#fff',font:{fontBuffers:[fs.readFileSync('vendor/local-preview/NanumGothic-Regular.ttf')],defaultFontFamily:'NanumGothic'}});let im;
 try{im=renderer.render();fs.writeFileSync(file+'-preview.png',im.asPng());}finally{im?.free();renderer.free();}
}
console.log(JSON.stringify({cases:cases.length,full_resolution:true,source:'shipped SVG'}));
