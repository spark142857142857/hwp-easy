/** Fixed portable preview renderer and Korean fallback font provenance. */
import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function localPreviewNotices(root){
 const installed=path.join(root,'node_modules/@resvg/resvg-wasm'),pkg=JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8'));
 const pin=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')).packages['node_modules/@resvg/resvg-wasm'];
 if(pkg.name!=='@resvg/resvg-wasm'||pkg.version!=='2.6.2'||pkg.license!=='MPL-2.0'||pin.version!==pkg.version||pin.integrity!=='sha512-FqALmHI8D4o6lk/LRWDnhw95z5eO+eAa6ORjVg09YRR7BkcM6oPHU9uyC0gtQG5vpFLvgpeU4+zEAz2H8APHNw==')throw Error('Preview renderer pin mismatch');
 const files=[['node_modules/@resvg/resvg-wasm/index_bg.wasm','22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70'],['vendor/local-preview/NanumGothic-Regular.ttf','76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31'],['vendor/local-preview/OFL.txt','eeacf16032901d0ed0456876ec77b8f0fda6b3fecec7d972f8543eb602e6c30f'],['vendor/local-preview/RESVG-LICENSE.txt','4b89d4518bd135ab4ee154a7bce722246b57a98c3d7efc1a09409898160c2bd1']];
 for(const [name,wanted]of files){let bytes=fs.readFileSync(path.join(root,name));if(name.endsWith('.txt'))bytes=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));if(sha(bytes)!==wanted)throw Error('Preview resource or license digest mismatch');}
 return {renderer:{name:pkg.name,version:pkg.version,license:pkg.license,integrity:pin.integrity,wasm_sha256:files[0][1],source:'https://github.com/thx/resvg-js/tree/v2.6.2',source_modified:false},font:{name:'NanumGothic Regular',license:'OFL-1.1',sha256:files[1][1],source:'https://github.com/google/fonts/tree/133ccbee9a8b408eb71f31a36ccb9116f5c695ad/ofl/nanumgothic',modified:false,scope:'fallback font for local derived thumbnails only; not installed or substituted in HWP records'}};
}
