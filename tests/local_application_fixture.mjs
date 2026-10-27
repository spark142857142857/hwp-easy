/** Reproducible Korean application form. Every identity and answer is fictional. */
import assert from 'node:assert/strict';
import {HwpDocument} from '@rhwp/core';
import {checkedExport} from './local_complex_fixtures.mjs';

export const applicationQuestions = [
 '1. 지원 동기와 직무를 선택한 이유를 작성해 주세요.',
 '2. 협업 과정에서 의견 차이를 해결한 경험을 작성해 주세요.',
 '3. 문제를 발견하고 개선한 경험을 작성해 주세요.',
 '4. 입사 후 실행할 계획과 성장 목표를 작성해 주세요.',
];
export const applicationAnswers = [
 ['사용자가 문서를 작성하다 멈추는 순간을 줄이는 일을 하고 싶어 지원했습니다. 대학 프로젝트에서 신청서를 취합하며 같은 내용을 여러 칸에 반복해서 옮기는 작업을 맡았습니다. 작은 오타 하나로 확인 과정이 길어지는 모습을 보고, 기능의 수보다 실제 작업을 끝낼 수 있는지가 중요하다고 느꼈습니다.',
 '이후 간단한 입력 도구를 만들면서 먼저 원본 보존과 오류 확인 절차를 설계했습니다. 작업 전후 내용을 비교하고 문제가 있으면 이전 상태로 돌아갈 수 있도록 했습니다. 팀원이 직접 사용한 뒤 남긴 의견을 바탕으로 안내 문구와 입력 순서를 바꿨고, 정리 시간이 줄어드는 것을 확인했습니다.',
 '지원한 직무에서도 사용자의 작업 흐름을 관찰하고 작은 불편을 구체적인 개선으로 연결하겠습니다. 빠르게 만드는 데서 끝내지 않고, 다른 사람이 안심하고 반복해서 사용할 수 있도록 검증 근거를 남기겠습니다.'],
 ['팀 과제에서 발표 자료의 구성을 두고 의견이 갈렸습니다. 한쪽은 분석 방법을 자세히 설명하자고 했고, 다른 쪽은 결과와 제안을 먼저 보여 주자고 했습니다. 저는 각 주장의 이유를 적어 공통 목표가 청중의 이해라는 점을 확인했습니다.',
 '같은 분량의 두 가지 초안을 만든 뒤 프로젝트를 모르는 동료에게 설명해 보았습니다. 결과를 먼저 본 동료가 핵심을 더 정확히 이해했고, 방법 설명은 질문에 답하는 자료로 남기는 편이 효과적이었습니다. 이를 근거로 본문과 부록의 역할을 나누었습니다.',
 '이 과정에서 상대를 설득하기 전에 서로의 우려를 검증 가능한 질문으로 바꾸는 법을 배웠습니다. 이후에는 결정한 이유와 담당 범위를 짧게 기록하여 같은 논의를 반복하지 않도록 했습니다.'],
 ['행사 신청 명단을 정리할 때 동일한 사람이 서로 다른 표기로 중복 등록되는 문제가 있었습니다. 처음에는 눈으로 찾아 지웠지만, 신청자가 늘면서 누락과 잘못된 삭제가 생길 수 있었습니다. 저는 원본을 남긴 상태에서 중복 후보만 따로 표시하는 방식을 제안했습니다.',
 '공백과 대소문자처럼 의미를 바꾸지 않는 차이만 정리하고, 이름이 같더라도 다른 정보가 다르면 자동으로 합치지 않았습니다. 정상 사례와 경계 사례를 나누어 확인한 후 담당자가 최종 판단하도록 했습니다. 오류가 발견되면 변경 전 자료로 되돌릴 수 있게 작업 기록도 남겼습니다.',
 '그 결과 확인 대상이 명확해졌고 다음 담당자도 같은 절차를 사용할 수 있었습니다. 이 경험을 통해 자동화의 가치는 모든 판단을 대신하는 것이 아니라, 사람이 정확하게 결정할 수 있는 조건을 만드는 데 있다는 점을 배웠습니다.'],
 ['입사 초기에는 제품과 고객의 실제 업무를 이해하는 데 집중하겠습니다. 문의 기록과 반복 작업을 살펴보고, 팀의 기존 기준을 익힌 뒤 작은 개선 과제를 맡겠습니다. 변경 전 상태와 성공 기준을 먼저 정하고 결과를 동료와 함께 확인하겠습니다.',
 '세 달 안에는 하나의 개선을 기획부터 검증까지 책임지고 마무리하는 것이 목표입니다. 기능이 동작하는지뿐 아니라 잘못된 입력, 긴 내용, 저장 실패 같은 상황에서도 사용자가 작업을 이어 갈 수 있는지 살피겠습니다.',
 '장기적으로는 구현과 문서화 사이의 간격을 줄이는 동료가 되고 싶습니다. 확인한 범위와 아직 모르는 범위를 분명히 기록하고, 반복되는 문제를 재현 가능한 검사로 바꾸어 팀이 안정적으로 제품을 발전시키는 데 기여하겠습니다.'],
].map(p=>p.join('\n'));
export const applicationIdentity = ['가상지원자', '제품개발', '문서공학', 'sample@example.invalid'];
export const applicationPlaceholder = '내용을 입력하세요.';

export function applicationFixture(){
 const d=HwpDocument.createEmpty();
 const ok=value=>{const r=JSON.parse(value);assert.notEqual(r.ok,false,JSON.stringify(r));return r;};
 try{
  d.createBlankDocument();d.insertText(0,0,0,'자기소개서 · 합성 검증용');
  d.splitParagraph(0,0,d.getParagraphLength(0,0));
  d.insertText(0,1,0,'가상 기업 지원서 / 실제 지원·개인정보가 없는 테스트 자료');
  d.splitParagraph(0,1,d.getParagraphLength(0,1));
  d.splitParagraph(0,2,0);d.insertText(0,3,0,'작성 확인: 위 내용은 편집 검증을 위한 가상 사례입니다.');
  const t=ok(d.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:2,charOffset:0,rowCount:10,colCount:4,colWidths:[6000,15000,6000,15000],treatAsChar:false})));
  const cells=[['성명','[성명]','지원 직무','[직무]'],['전공','[전공]','이메일','[이메일]'],...applicationQuestions.flatMap(q=>[[q,'','',''],[applicationPlaceholder,'','','']])];
  for(let r=0;r<10;r++)for(let c=0;c<4;c++){
   if(cells[r][c])d.insertTextInCell(0,t.paraIdx,t.controlIdx,r*4+c,0,0,cells[r][c]);
   d.applyCharFormatInCell(0,t.paraIdx,t.controlIdx,r*4+c,0,0,[...cells[r][c]].length,JSON.stringify({fontSize:1000,fontFamily:'함초롬바탕',bold:r>=2&&r%2===0}));
  }
  for(let r=9;r>=2;r--)ok(d.mergeTableCells(0,t.paraIdx,t.controlIdx,r,0,r,3));
  ok(d.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify({width:42000,horzOffset:0,vertOffset:0})));
  d.createHeaderFooter(0,false,0);d.insertTextInHeaderFooter(0,false,0,0,0,'합성 양식 · 실제 지원서가 아닙니다.');
  ok(d.applyCharFormat(0,0,0,d.getParagraphLength(0,0),JSON.stringify({fontSize:1800,bold:true})));
  ok(d.applyParaFormat(0,0,JSON.stringify({alignment:'center'})));
  return checkedExport(d);
 }finally{d.free();}
}
