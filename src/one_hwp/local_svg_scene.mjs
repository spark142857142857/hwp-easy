/** Bounded structural parsing of SVG emitted by our pinned renderer. No XML execution. */
import {fail} from './local_complex_records.mjs';
import {composeAffine as mul,inverseAffine} from './local_drawing_tree.mjs';
export {inverseAffine};
export const identitySvg=[1,0,0,0,1,0];
export const svgPoint=(m,x,y)=>[m[0]*x+m[1]*y+m[2],m[3]*x+m[4]*y+m[5]];
export const svgMatrix=m=>`matrix(${m[0]} ${m[3]} ${m[1]} ${m[4]} ${m[2]} ${m[5]})`;
const numbers=s=>(s.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)??[]).map(Number);
function transform(value){
 let m=identitySvg,at=0;
 for(const match of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)){
  if(value.slice(at,match.index).trim().replaceAll(',',''))return null;at=match.index+match[0].length;if(match[2].replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi,'').replace(/[\s,]/g,''))return null;const a=numbers(match[2]);if(a.some(n=>!Number.isFinite(n)))return null;let t;
  if(match[1]==='matrix'&&a.length===6)t=[a[0],a[2],a[4],a[1],a[3],a[5]];
  else if(match[1]==='translate'&&[1,2].includes(a.length))t=[1,0,a[0],0,1,a[1]??0];
  else if(match[1]==='scale'&&[1,2].includes(a.length))t=[a[0],0,0,0,a[1]??a[0],0];
  else if(match[1]==='rotate'&&[1,3].includes(a.length)){const c=Math.cos(a[0]*Math.PI/180),s=Math.sin(a[0]*Math.PI/180),x=a[1]??0,y=a[2]??0;t=[c,-s,x-c*x+s*y,s,c,y-s*x-c*y];}
  else return null;m=mul(m,t);
 }return value.slice(at).trim()?null:m;
}
export function parseEngineSvg(svg){
 if(typeof svg!=='string'||Buffer.byteLength(svg)>8*1024*1024)fail('RENDER_DRAWING_SVG_LIMIT');
 const nodes=[],stack=[];let at=0;
 while((at=svg.indexOf('<',at))>=0){
  if(svg.startsWith('<!--',at)){const end=svg.indexOf('-->',at+4);if(end<0)fail('DRAWING_SVG_STRUCTURE_UNVERIFIED');at=end+3;continue;}
  let end=at+1,quote=null;for(;end<svg.length;end++){const c=svg[end];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
  if(end===svg.length)fail('DRAWING_SVG_STRUCTURE_UNVERIFIED');const tag=svg.slice(at,end+1),name=/^<\/?([\w:-]+)/.exec(tag)?.[1];if(!name)fail('DRAWING_SVG_STRUCTURE_UNVERIFIED');
  if(/^<\//.test(tag)){const node=stack.pop();if(!node||node.name!==name)fail('DRAWING_SVG_STRUCTURE_UNVERIFIED');node.closeStart=at;node.end=end+1;at=end+1;continue;}
  const attrs=Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],m[2]??m[3]])),parent=stack.at(-1),local=transform(attrs.transform??'');let coordinate=local;
  if(name==='svg'&&parent){const box=numbers(attrs.viewBox??''),x=Number(attrs.x??0),y=Number(attrs.y??0),w=Number(attrs.width),h=Number(attrs.height);if(box.length!==4||box[2]<=0||box[3]<=0||![x,y,w,h].every(Number.isFinite))coordinate=null;
   else{let sx=w/box[2],sy=h/box[3],dx=x,dy=y;if(attrs.preserveAspectRatio!=='none'){if(attrs.preserveAspectRatio&&!/^xMidYMid(?: meet)?$/.test(attrs.preserveAspectRatio))coordinate=null;const scale=Math.min(sx,sy);dx+=(w-box[2]*scale)/2;dy+=(h-box[3]*scale)/2;sx=sy=scale;}if(coordinate)coordinate=mul(coordinate,[sx,0,dx-box[0]*sx,0,sy,dy-box[1]*sy]);}}
  const node={name,attrs,start:at,openEnd:end+1,end:/\/\s*>$/.test(tag)?end+1:null,parent,children:[],inDefs:Boolean(parent?.inDefs)||['defs','clipPath','pattern','mask'].includes(name),parentMatrix:parent?.matrix??identitySvg,ownMatrix:coordinate,matrix:coordinate&&(!parent||parent.matrix)?mul(parent?.matrix??identitySvg,coordinate):null};nodes.push(node);parent?.children.push(node);
  if(nodes.length>100000||stack.length>128)fail('RENDER_DRAWING_SVG_LIMIT');if(node.end==null)stack.push(node);at=end+1;
 }if(stack.length||nodes.some(n=>n.end==null))fail('DRAWING_SVG_STRUCTURE_UNVERIFIED');return nodes;
}
export function drawingSvgPoints(node){
 if(node.closeStart!=null||node.inDefs||!node.matrix||!node.ownMatrix||node.ownMatrix.some((n,i)=>Math.abs(n-identitySvg[i])>1e-9))return null;
 if(node.name==='path'){if(!/^M\s*[-+\d.][\deE+.,\s-]*L[\deE+.,\s-]*L[\deE+.,\s-]*L[\deE+.,\s-]*Z\s*$/.test(node.attrs.d??''))return null;const n=numbers(node.attrs.d);return n.length===8?Array.from({length:4},(_,i)=>[n[i*2],n[i*2+1]]):null;}
 if(node.name==='rect'){const [x,y,w,h]=['x','y','width','height'].map(k=>Number(node.attrs[k]??0));if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return null;return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];}
 return null;
}
