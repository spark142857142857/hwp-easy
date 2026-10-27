/** Full-size QA rasters of the exact SVG returned by the request interface. */
import fs from 'node:fs';import path from 'node:path';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
await initWasm(fs.readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const root=path.resolve(process.argv[2]),font=fs.readFileSync('vendor/local-preview/NanumGothic-Regular.ttf');let pages=0;
for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.svg'))){
 const tree=new Resvg(fs.readFileSync(path.join(root,name),'utf8'),{background:'#ffffff',font:{fontBuffers:[font],defaultFontFamily:'NanumGothic',sansSerifFamily:'NanumGothic',serifFamily:'NanumGothic',monospaceFamily:'NanumGothic'}});let image;
 try{image=tree.render();fs.writeFileSync(path.join(root,name.replace(/\.svg$/,'.png')),image.asPng());pages++;}finally{image?.free();tree.free();}
}console.log(JSON.stringify({status:'PASS',pages}));
