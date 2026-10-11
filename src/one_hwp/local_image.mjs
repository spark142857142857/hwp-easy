/** Bounded PNG and baseline/progressive JPEG envelopes; exact bytes stay embedded. */
import path from 'node:path';
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
const fail=code=>{throw new GuardError(code);};
export function imageSize(bytes,source) {
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width,height,extension;
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  extension='png';let offset=8,first=true,idat=false,ended=false;
  while(offset<b.length){if(ended||offset+12>b.length)fail('INVALID_PNG');const length=b.readUInt32BE(offset),end=offset+12+length;if(end>b.length)fail('INVALID_PNG');const tag=b.toString('ascii',offset+4,offset+8);
   let crc=0xffffffff;for(let i=offset+4;i<end-4;i++){crc^=b[i];for(let k=0;k<8;k++)crc=crc>>>1^((crc&1)?0xedb88320:0);}if((crc^0xffffffff)>>>0!==b.readUInt32BE(end-4))fail('INVALID_PNG');
   if(first){if(tag!=='IHDR'||length!==13)fail('INVALID_PNG');width=b.readUInt32BE(offset+8);height=b.readUInt32BE(offset+12);first=false;}else if(tag==='IHDR')fail('INVALID_PNG');
   if(tag==='IDAT')idat=true;if(tag==='IEND'){if(length||!idat)fail('INVALID_PNG');ended=true;}offset=end;
  }if(!ended)fail('INVALID_PNG');
 }else if(b.length>=4&&b[0]===255&&b[1]===216){
  // ITU-T T.81 marker/scan framing. Arithmetic/lossless/hierarchical coding is
  // outside this profile. No trailing payload or truncated entropy scan.
  extension='jpg';let p=2,frame=false,scan=false,ended=false,quant=false,huffman=false;
  while(p<b.length){if(b[p++]!==255)fail('INVALID_JPEG');while(b[p]===255)p++;const marker=b[p++];if(marker===217){if(!frame||!scan||p!==b.length)fail('INVALID_JPEG');ended=true;break;}
   if(marker===0||marker===216||marker===1||marker>=208&&marker<=215||p+2>b.length)fail('INVALID_JPEG');const length=b.readUInt16BE(p),end=p+length;if(length<2||end>b.length)fail('INVALID_JPEG');
   if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
    if(frame||![192,194].includes(marker)||length<8||b[p+2]!==8)fail('JPEG_PROFILE_UNSUPPORTED');height=b.readUInt16BE(p+3);width=b.readUInt16BE(p+5);const n=b[p+7];if(![1,3].includes(n)||length!==8+n*3)fail('JPEG_PROFILE_UNSUPPORTED');frame=true;
   }else if(marker===219)quant=true;else if(marker===196)huffman=true;
   else if(marker===218){if(!frame||!quant||!huffman||length<6||length!==6+b[p+2]*2)fail('INVALID_JPEG');scan=true;p=end;let entropy=0;
    while(p<b.length){if(b[p]!==255){p++;entropy++;continue;}let q=p+1;while(b[q]===255)q++;if(q>=b.length)fail('INVALID_JPEG');if(b[q]===0||b[q]>=208&&b[q]<=215){p=q+1;entropy++;continue;}break;}
    if(!entropy)fail('INVALID_JPEG');continue;
   }p=end;
  }if(!ended)fail('INVALID_JPEG');
 }else fail('INVALID_IMAGE_FORMAT');
 if(source){const ext=path.extname(source).toLowerCase();if(extension==='png'?ext!=='.png':!['.jpg','.jpeg'].includes(ext))fail('IMAGE_EXTENSION_MISMATCH');}
 if(!width||!height||width>8192||height>8192||width*height>16000000)fail('IMAGE_LIMIT_EXCEEDED');return {width,height,extension};
}
