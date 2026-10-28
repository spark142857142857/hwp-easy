/** Pin and carry the CFB writer used only by the local complex formatter. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const integrity='sha512-KfdUZsSOw19/ObEWasvBP/Ac4reZvAGauZhs6S/gqNhXhI7cKwvlH7ulj+dOEYnca4bm4SGo8C1bTAQvnTjgQA==';
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
export function localCfbNotices(root){
 const base=root,installed=path.join(base,'node_modules/cfb'),pkg=JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8'));
 const lock=JSON.parse(fs.readFileSync(path.join(base,'package-lock.json'),'utf8')).packages['node_modules/cfb'];
 if(pkg.name!=='cfb'||pkg.version!=='1.2.2'||pkg.license!=='Apache-2.0'||lock.version!==pkg.version||lock.integrity!==integrity)throw Error('Local CFB package pin mismatch');
 const sourceSha='239f7fb9d74b0cb8856e0b1a182bdf310f9fcf5b75a958e84edc158cd387dab2',licenseSha='279ce5f639ecd1767f96948f9fbe6f0aa8145cb280cf98473fb366eab5e6de26';
 for(const [file,wanted] of [[path.join(installed,'cfb.js'),sourceSha],[path.join(installed,'LICENSE'),licenseSha],[path.join(base,'vendor/cfb/LICENSE.txt'),licenseSha]])if(hash(fs.readFileSync(file,'utf8'))!==wanted)throw Error('Local CFB source/notice mismatch');
 return {name:pkg.name,version:pkg.version,license:pkg.license,integrity,source_sha256_lf:sourceSha,license_sha256_lf:licenseSha,scope:'local complex formatting and derived preview cache writer; not deployed Worker',npm_provenance:'https://registry.npmjs.org/cfb/-/cfb-1.2.2.tgz'};
}
