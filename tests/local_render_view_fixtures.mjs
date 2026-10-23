/** Canonical flowing-table floats. No personal HWP or external application. */
import {HwpDocument} from '@rhwp/core';
import {tableFloatingFixture} from './local_table_floating_fixtures.mjs';
import {inspectLocalComplex} from '../src/one_hwp/local_complex.mjs';
import {tableReflowContexts,reflowTableLocal} from '../src/one_hwp/local_table_reflow.mjs';
import {digest} from '../src/one_hwp/local_file.mjs';
export const renderViewProfiles=[
 {name:'render-picture',depth:1,lines:8,objects:['picture']},
 {name:'render-box',depth:1,lines:8,objects:['box']},
 {name:'render-both',depth:1,lines:8,objects:['picture','box']},
 {name:'render-nested',depth:2,lines:8,footer:true,objects:['picture','box']},
 {name:'render-deep',depth:3,lines:8,footer:true,objects:['box','picture']},
 {name:'render-paged',depth:2,lines:65,footer:true,objects:['picture','box']}
];
export function renderViewFixture(options={}){
 const bytes=tableFloatingFixture({depth:2,lines:8,...options}),version=digest(bytes),state=inspectLocalComplex(HwpDocument,bytes,{includeDocumentInfo:false,verifyCharacterModel:false}),context=tableReflowContexts(state,version)[0];
 return reflowTableLocal(HwpDocument,bytes,version,{type:'reflow_table',target_id:context.target_id,expected_old:context.expected_old,expected_tables:context.expected_tables}).bytes;
}
