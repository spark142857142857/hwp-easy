/** Content-fit rows are explicit: stored heights carry no authoring provenance. */
export function contentFitRows(count,constraints){
 const ends=Array.from({length:count+1},()=>[]),positions=Array(count+1).fill(0);
 for(const c of constraints)ends[c.row+c.span].push(c);
 // Every constraint is a forward edge on cumulative row boundaries. The
 // longest path satisfies all overlapping merged spans with minimum total
 // height; a 100-HWPUNIT floor avoids zero/vanishing row tracks.
 for(let end=1;end<=count;end++)positions[end]=Math.max(positions[end-1]+100,...ends[end].map(c=>positions[c.row]+c.needed));
 return positions.slice(1).map((n,i)=>n-positions[i]);
}
