/** Developer entrypoint for the same skill installer shipped through npm. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectSkill,installSkill,updateSkill} from '../../packages/hwp-easy/lib/agent-skill.mjs';
export {inspectSkill,installSkill,updateSkill};

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const args=process.argv.slice(2),values={};
  if(args.length%2)throw Error('Use --client <claude-code|cursor> --package <skill-folder> [--skills-root <folder>] [--mode <install|update>]');
  for(let i=0;i<args.length;i+=2){if(!['--client','--package','--skills-root','--mode'].includes(args[i])||Object.hasOwn(values,args[i]))throw Error('Invalid arguments');values[args[i]]=args[i+1];}
  if(!values['--package']||!values['--client'])throw Error('A package and client are required');
  if(values['--mode']&&!['install','update'].includes(values['--mode']))throw Error('Invalid install mode');
  console.log(JSON.stringify(await (values['--mode']==='update'?updateSkill:installSkill)(values['--package'],values['--client'],values['--skills-root'])));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
