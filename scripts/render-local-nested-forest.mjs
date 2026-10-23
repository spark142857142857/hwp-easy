/** QA-only full-size raster of saved public SVGs; production thumbnails stay bounded. */
import fs from 'node:fs';import path from 'node:path';import {Resvg,initWasm} from '@resvg/resvg-wasm';
const root=path.resolve(process.argv[2]);await initWasm(fs.readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));const font=fs.readFileSync('vendor/local-preview/NanumGothic-Regular.ttf');let count=0;
for(const file of fs.readdirSync(root).filter(f=>/-(before|after)-\d+\.svg$/.test(f))){const r=new Resvg(fs.readFileSync(path.join(root,file),'utf8'),{background:'#fff',font:{fontBuffers:[font],defaultFontFamily:'NanumGothic',sansSerifFamily:'NanumGothic',serifFamily:'NanumGothic',monospaceFamily:'NanumGothic'}});try{const im=r.render();try{fs.writeFileSync(path.join(root,file.replace('.svg','-preview.png')),im.asPng());count++;}finally{im.free();}}finally{r.free();}}
console.log(JSON.stringify({full_size_public_svg_pages:count}));
