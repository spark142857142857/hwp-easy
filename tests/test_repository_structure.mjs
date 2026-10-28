import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('..',import.meta.url));

test('local runtime bundles from shared source without legacy or developer tooling',async()=>{
 const result=await build({absWorkingDir:root,entryPoints:['src/one_hwp/local_runner.mjs'],
  bundle:true,write:false,metafile:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});
 const inputs=Object.keys(result.metafile.inputs).map(name=>path.relative(root,path.resolve(root,name)).split(path.sep).join('/'));
 assert.ok(inputs.includes('src/one_hwp/guard/container.mjs'));
 assert.ok(inputs.includes('src/one_hwp/engine/document.mjs'));
 for(const name of inputs)assert.ok(name.startsWith('src/one_hwp/')||name.startsWith('node_modules/'),`Unexpected runtime dependency: ${name}`);
 assert.equal(result.outputFiles.length,1);
});
