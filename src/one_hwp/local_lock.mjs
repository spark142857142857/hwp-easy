/** A live owner keeps a nonempty directory; only proven dead owners are reaped. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {GuardError} from './guard/records.mjs';
const busy=()=>{throw new GuardError('DOCUMENT_BUSY');};
const host=createHash('sha256').update(os.hostname()).digest('hex').slice(0,24);
const ownerPattern=/^([a-f0-9]{24})-([1-9][0-9]*)-([a-f0-9-]{36})\.owner$/;
const gone=e=>['ENOENT','ENOTEMPTY','EEXIST','EPERM','EACCES'].includes(e.code);
function emptyRemove(folder){try{fs.rmdirSync(folder);}catch(e){if(!gone(e))throw e;}}
function dead(pid){try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}}
function reap(folder){
  const s=fs.lstatSync(folder);if(!s.isDirectory()||s.isSymbolicLink())busy();
  const handle=fs.opendirSync(folder);let entries;
  try{entries=[handle.readSync(),handle.readSync()].filter(Boolean);}finally{handle.closeSync();}
  if(!entries.length){emptyRemove(folder);return;}
  if(entries.length!==1)busy();
  const [name]=entries,m=ownerPattern.exec(name.name),pid=Number(m?.[2]);
  if(!m||m[1]!==host||!Number.isSafeInteger(pid)||pid>0x7fffffff||!name.isFile()||!dead(pid))busy();
  const file=path.join(folder,name.name),fileStat=fs.lstatSync(file);
  if(!fileStat.isFile()||fileStat.isSymbolicLink()||fileStat.nlink!==1)busy();
  // The unique owner's name is never reused. rmdir cannot remove a ready owner.
  try{fs.unlinkSync(file);}catch(e){if(['EPERM','EACCES'].includes(e.code))busy();throw e;}emptyRemove(folder);
}
function acquireOwnerDirectory(folder){
  const name=`${host}-${process.pid}-${randomUUID()}.owner`,staging=`${folder}.claim-${randomUUID()}`;
  fs.mkdirSync(staging,{mode:0o700});let fd,moved=false,recovered=false;
  try{
    fd=fs.openSync(path.join(staging,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
    fs.writeFileSync(fd,JSON.stringify({format:1,pid:process.pid,created_utc:new Date().toISOString()}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    // Publish an already nonempty directory. There is no empty initialization
    // window in which two claimants can accidentally share the same directory.
    for(let attempt=0;attempt<12;attempt++){
      // Another dead-owner reaper can remove the directory before this stat.
      // An absent path is eligible for the same atomic rename below.
      try{const s=fs.lstatSync(folder);if(!s.isDirectory()||s.isSymbolicLink())busy();}catch(e){if(e.code!=='ENOENT')throw e;}
      try{fs.renameSync(staging,folder);moved=true;return {recovered,release(){try{fs.unlinkSync(path.join(folder,name));}catch(e){if(e.code!=='ENOENT')throw e;}emptyRemove(folder);}};}
      catch(e){
        if(!['EEXIST','ENOTEMPTY','EPERM','EACCES','ENOTDIR','EISDIR'].includes(e.code))throw e;
        try{reap(folder);recovered=true;}catch(e){if(e.code!=='ENOENT')throw e;}
      }
    }
    busy();
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
    if(!moved){try{fs.unlinkSync(path.join(staging,name));}catch(e){if(e.code!=='ENOENT')throw e;}emptyRemove(staging);}
  }
}
function guardRead(file){
  const before=fs.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||![1,2].includes(before.nlink)||before.size>4096)busy();
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
  try{const opened=fs.fstatSync(fd);if(opened.dev!==before.dev||opened.ino!==before.ino||opened.nlink!==before.nlink||opened.size!==before.size||opened.mtimeMs!==before.mtimeMs)busy();bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
  const after=fs.lstatSync(file);if(before.dev!==after.dev||before.ino!==after.ino||before.nlink!==after.nlink||before.size!==after.size||before.mtimeMs!==after.mtimeMs)busy();
  let value;try{value=JSON.parse(bytes);}catch{busy();}
  if(value?.format!=='hwp-easy-lock-v1'||value.host!==host||!Number.isSafeInteger(value.pid)||value.pid<1||value.pid>0x7fffffff||typeof value.nonce!=='string'||!/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/.test(value.nonce)||value.nonce.length!==36)busy();
  if(before.nlink===2){
    if(!dead(value.pid))busy();const alias=file+'.guard-'+value.nonce,s=fs.lstatSync(alias);
    if(!s.isFile()||s.isSymbolicLink()||s.dev!==before.dev||s.ino!==before.ino||s.nlink!==2)busy();
    fs.unlinkSync(alias);if(fs.lstatSync(file).nlink!==1)busy();
  }
  return value;
}
export function acquireLocalLock(file){
  const owner=acquireOwnerDirectory(file+'.owner');let fd,owned=false;
  const nonce=randomUUID(),staging=file+'.guard-'+nonce;
  try{
    // Keep the original exclusive file as a guard for pre-upgrade runners.
    // Our owner directory serializes recovery of this versioned guard file.
    if(fs.existsSync(file)){const prior=guardRead(file);if(!dead(prior.pid))busy();fs.unlinkSync(file);owner.recovered=true;}
    fd=fs.openSync(staging,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
    fs.writeFileSync(fd,JSON.stringify({format:'hwp-easy-lock-v1',host,pid:process.pid,nonce}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    try{fs.linkSync(staging,file);owned=true;}catch(e){if(e.code==='EEXIST')busy();throw e;}
    fs.unlinkSync(staging);
    return {recovered:owner.recovered,release(){try{if(guardRead(file).nonce===nonce)fs.unlinkSync(file);}finally{owner.release();}}};
  }catch(e){
    if(fd!==undefined)fs.closeSync(fd);
    if(owned)fs.unlinkSync(file);
    try{fs.unlinkSync(staging);}catch(cleanup){if(cleanup.code!=='ENOENT')throw cleanup;}
    owner.release();throw e;
  }
}
