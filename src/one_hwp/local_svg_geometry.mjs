/** Bounded coordinate projection of trusted SVG emitted by the pinned engine. */
import {GuardError} from '../../probes/sites-runtime/guard/records.mjs';
export const svgInner=svg=>/^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)?.[1];
export const svgNamespace=(s,prefix)=>s.replace(/\bid="([^"]+)"/g,(_,id)=>`id="${prefix}${id}"`).replace(/url\(#([^\)]+)\)/g,(_,id)=>`url(#${prefix}${id})`).replace(/((?:xlink:)?href=")#([^"]+)"/g,(_,a,id)=>`${a}#${prefix}${id}"`);
const get=(s,key)=>Number(new RegExp(`\\b${key}="([^"]+)"`).exec(s)?.[1]);
const set=(s,key,value)=>s.replace(new RegExp(`(\\b${key}=")[^"]*(")`),(_,a,b)=>`${a}${value}${b}`);
export function projectSvgText(svg,pairs){
 const grid=new Map();let total=0;
 for(const {source,target}of pairs){let i=0;for(const char of source.text){if(++total>200000)throw new GuardError('RENDERED_LAYOUT_ITEM_LIMIT');const x=source.x+(source.charX?.[i]??0),y=source.y+source.h*.85,key=`${Math.round(x*10)}:${Math.round(y*10)}`,g={x,y,dx:target?target.x-source.x:0,dy:target?target.y-source.y:0,visible:Boolean(target)};if(!grid.has(key))grid.set(key,[]);grid.get(key).push(g);i++;}}
 return svg.replace(/<text\b[^>]*>/g,tag=>{const x=get(tag,'x'),y=get(tag,'y'),found=[];for(let a=-3;a<=3;a++)for(let b=-3;b<=3;b++)for(const g of grid.get(`${Math.round(x*10)+a}:${Math.round(y*10)+b}`)??[])if(Math.abs(g.x-x)<.25&&Math.abs(g.y-y)<.25)found.push(g);if(!found.length||found.some(g=>g.visible!==found[0].visible||Math.abs(g.dx-found[0].dx)>.1||Math.abs(g.dy-found[0].dy)>.1))return tag;const g=found[0];return g.visible?set(set(tag,'x',x+g.dx),'y',y+g.dy):tag.replace('<text','<text visibility="hidden"');});
}
export function hideSvgTableBorders(svg,tables){
 return svg.replace(/<line\b[^>]*>/g,tag=>{
  const x1=get(tag,'x1'),x2=get(tag,'x2'),y1=get(tag,'y1'),y2=get(tag,'y2');
  const hidden=tables.some(c=>{
   const inside=[x1,x2].every(x=>x>=c.x-.5&&x<=c.x+c.w+.5)&&[y1,y2].every(y=>y>=c.y-.5&&y<=c.y+c.h+.5);
   const horizontal=Math.abs(y1-y2)<.01&&(Math.abs(y1-c.y)<.5||Math.abs(y1-c.y-c.h)<.5);
   const vertical=Math.abs(x1-x2)<.01&&(Math.abs(x1-c.x)<.5||Math.abs(x1-c.x-c.w)<.5||c.cells?.some(f=>Math.abs(x1-f.x)<.5));
   return inside&&(horizontal||vertical);
  });return hidden?tag.replace('<line','<line visibility="hidden"'):tag;
 });
}
