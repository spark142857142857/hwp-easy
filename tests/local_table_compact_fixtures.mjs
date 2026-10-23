import {tableReflowFixture,hostTablesFixture} from './local_table_reflow_fixtures.mjs';
import {tableTextFlowFixture} from './local_table_text_flow_fixtures.mjs';
export const compactProfiles=[
 ...[1,2,3].map(depth=>({name:`compact-depth${depth}`,depth})),
 {name:'compact-vertical',verticalMerge:true},
 {name:'compact-nested-vertical',depth:2,verticalMerge:'nested'},
 {name:'compact-horizontal',merged:true},
 {name:'compact-middle',depth:2,alignment:[1,1]},
 {name:'compact-bottom',depth:2,alignment:[2,2]},
 {name:'compact-peers',depth:2,multi:true,count:3},
 {name:'compact-body-roots',depth:1,body:true,count:2},
 {name:'compact-footer',depth:2,footer:true},
 {name:'compact-later-rows',depth:2,rows:3},
 {name:'compact-reopen',depth:2,reopen:true},
 {name:'compact-reopen-body',depth:1,body:true,count:2,reopen:true}
];
export function compactFixture(f){
 const options={depth:1,lines:65,...f};
 return f.body?tableTextFlowFixture(options):f.multi?hostTablesFixture(options):tableReflowFixture(options);
}
