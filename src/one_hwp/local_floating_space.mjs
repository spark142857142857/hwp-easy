/** Bounded rectangle search shared by column and cell placement. */
import {contains,intersects} from './local_rendered_layout.mjs';
export const padded=(r,p)=>({x:r.x-p.l,y:r.y-p.top,w:r.w+p.l+p.r,h:r.h+p.top+p.bottom});
export const placementFree=(rect,body,others,gap)=>contains({x:body.x+gap,y:body.y+gap,w:body.w-gap*2,h:body.h-gap*2},rect)&&!others.some(o=>intersects(rect,o,gap));
export function placementCandidates(original,frames,others,gap){
 const axis=(values,from,lo,hi)=>[...new Set(values.filter(Number.isFinite).map(v=>Math.max(lo,Math.min(hi,v))))].sort((a,b)=>Math.abs(a-from)-Math.abs(b-from)).slice(0,24);
 return frames.flatMap((frame,column)=>{
  if(original.w+2*gap>frame.w||original.h+2*gap>frame.h)return [];
  const xs=axis([original.x,frame.x+gap,frame.x+frame.w-original.w-gap,...others.flatMap(o=>[o.x+o.w+gap,o.x-original.w-gap])],original.x,frame.x+gap,frame.x+frame.w-original.w-gap),ys=axis([original.y,frame.y+gap,frame.y+frame.h-original.h-gap,...others.flatMap(o=>[o.y+o.h+gap,o.y-original.h-gap])],original.y,frame.y+gap,frame.y+frame.h-original.h-gap);
  return xs.flatMap(x=>ys.map(y=>({...original,x,y,column}))).filter(r=>placementFree(r,frame,others,gap));
 }).sort((a,b)=>Math.hypot(a.x-original.x,a.y-original.y)-Math.hypot(b.x-original.x,b.y-original.y));
}
