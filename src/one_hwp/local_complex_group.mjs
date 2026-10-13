/** Selected group leaves: replace their image or rotate within the parent frame. */
import {fail,view,equal,equalBytes} from './local_complex_records.mjs';
import {addComplexImage} from './local_complex_picture.mjs';
import {inflateBoundedRaw} from '../../probes/sites-runtime/guard/container.mjs';
import {imageSize} from './local_image.mjs';
const compose=(a,b)=>[a[0]*b[0]+a[1]*b[3],a[0]*b[1]+a[1]*b[4],a[0]*b[2]+a[1]*b[5]+a[2],a[3]*b[0]+a[4]*b[3],a[3]*b[1]+a[4]*b[4],a[3]*b[2]+a[4]*b[5]+a[5]];
export function prepareComplexGroup(raw,records,group,op){
 const replacement=op.type==='replace_group_picture',schema=['type','target_id','expected_old','picture_index','expected_properties',replacement?'image':'props'];if(!equal(Object.keys(op).sort(),schema.sort()))fail('INVALID_OPERATION');
 const child=group.pictures[op.picture_index];if(!Number.isSafeInteger(op.picture_index)||!child)fail('GROUP_PICTURE_REQUIRED');const {record_index,picture_index,...prior}=child;
 if(!equal(op.expected_properties,prior))fail('EXPECTED_PICTURE_MISMATCH');const out=records.map(r=>({...r,payload:r.payload.slice()}));let image;
 if(replacement){
  image=addComplexImage(raw,op.image);const p=view(out[record_index].payload),oldId=p.getUint16(71,true),names=[...raw.streams.keys()].filter(n=>new RegExp(`^BinData/BIN${oldId.toString(16).padStart(4,'0')}\\.(png|jpe?g)$`,'i').test(n));if(names.length!==1)fail('GROUP_IMAGE_UNVERIFIED');let priorBytes=raw.streams.get(names[0]);try{imageSize(priorBytes);}catch{priorBytes=inflateBoundedRaw(priorBytes,1048576);}
  if(equalBytes(image.bytes,priorBytes)&&['cropLeft','cropTop','cropRight','cropBottom'].every(k=>prior[k]===0))return {unchanged:true};
  p.setUint16(71,image.binId,true);p.setInt32(44,0,true);p.setInt32(48,0,true);for(const at of [52,82])p.setUint32(at,image.pixels.width*75,true);for(const at of [56,86])p.setUint32(at,image.pixels.height*75,true);
  return {records:out,image,child,wanted:{...prior,sourceWidth:image.pixels.width*75,sourceHeight:image.pixels.height*75,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0}};
 }
 if(!op.props||!equal(Object.keys(op.props),['rotationAngle'])||!Number.isSafeInteger(op.props.rotationAngle)||Math.abs(op.props.rotationAngle)>359)fail('INVALID_PICTURE_PROPERTIES');
 if(op.props.rotationAngle===prior.rotationAngle)return {unchanged:true};
 const shape=out[record_index-1],s=view(shape.payload),count=s.byteLength>=48?s.getUint16(46,true):0;
 if(shape.tag!==76||Buffer.from(shape.payload.subarray(0,4)).toString('ascii')!=='cip$'||count!==1||s.byteLength!==192)fail('GROUP_ROTATION_PROFILE_UNSUPPORTED');
 const dimensions=[16,20,24,28].map(at=>s.getUint32(at,true));if(dimensions.some(n=>n<1||n>720000)||dimensions[0]!==dimensions[2]||dimensions[1]!==dimensions[3])fail('GROUP_ROTATION_PROFILE_UNSUPPORTED');
 const readMatrix=at=>Array.from({length:6},(_,i)=>s.getFloat64(at+i*8,true));let combined=readMatrix(48);
 for(let i=0;i<count;i++)combined=compose(compose(combined,readMatrix(144+i*96)),readMatrix(96+i*96));
 if(combined.some(n=>!Number.isFinite(n)||Math.abs(n)>720000)||Math.abs(combined[0]*combined[4]-combined[1]*combined[3])<1e-9)fail('GROUP_ROTATION_PROFILE_UNSUPPORTED');
 const [w,h]=dimensions,cx=combined[0]*w/2+combined[1]*h/2+combined[2],cy=combined[3]*w/2+combined[4]*h/2+combined[5],theta=(op.props.rotationAngle-prior.rotationAngle)*Math.PI/180,c=Math.cos(theta),sin=Math.sin(theta),delta=[c,-sin,cx-c*cx+sin*cy,sin,c,cy-sin*cx-c*cy],wantedMatrix=compose(delta,combined);
 let parent;for(let i=record_index-2;i>group.record_index;i--)if(records[i].tag===76&&records[i].level===shape.level-1&&Buffer.from(records[i].payload.subarray(0,4)).toString('ascii')==='noc$'){parent=records[i];break;}
 if(!parent||parent!==records[group.record_index+1])fail('GROUP_ROTATION_NESTING_UNSUPPORTED');const p=view(parent.payload),base=Buffer.from(parent.payload.subarray(0,8)).toString('ascii')==='noc$noc$'?8:4;
 if(p.byteLength<base+28)fail('GROUP_ROTATION_PROFILE_UNSUPPORTED');const width=p.getUint32(base+12,true),height=p.getUint32(base+16,true);
 if(!width||!height)fail('GROUP_ROTATION_PROFILE_UNSUPPORTED');for(const [x,y]of [[0,0],[w,0],[0,h],[w,h]]){const px=wantedMatrix[0]*x+wantedMatrix[1]*y+wantedMatrix[2],py=wantedMatrix[3]*x+wantedMatrix[4]*y+wantedMatrix[5];if(px<-.01||py<-.01||px>width+.01||py>height+.01)fail('GROUP_ROTATION_OUTSIDE_FRAME');}
 // Hancom uses the final pair for the leaf's own rotation. Earlier pairs
 // belong to its group chain. Conjugate the delta through that retained
 // prefix; keep T, every scale and all ancestor rotation matrices exact.
 let prefix=readMatrix(48);for(let i=0;i<count-1;i++)prefix=compose(compose(prefix,readMatrix(144+i*96)),readMatrix(96+i*96));
 const [a,b,tx,c0,d,ty]=prefix,det=a*d-b*c0;if(Math.abs(det)<1e-9||Math.abs(a*b+c0*d)>1e-6||Math.abs(a*a+c0*c0-b*b-d*d)>1e-6)fail('GROUP_ROTATION_PROFILE_UNSUPPORTED');
 const inverse=[d/det,-b/det,(b*ty-d*tx)/det,-c0/det,a/det,(c0*tx-a*ty)/det],at=144+(count-1)*96,rotation=compose(inverse,compose(delta,compose(prefix,readMatrix(at))));
 rotation.forEach((n,i)=>s.setFloat64(at+i*8,Math.abs(n)<1e-10?0:n,true));s.setInt16(36,op.props.rotationAngle,true);s.setInt32(38,Math.round(w/2),true);s.setInt32(42,Math.round(h/2),true);
 return {records:out,child,wanted:{...prior,rotationAngle:op.props.rotationAngle}};
}
