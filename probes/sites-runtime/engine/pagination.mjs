// Counts already obtained by the pinned engine's source/output inspection.
// No extra rendering, persistence or proof of the user's external HWP layout.
export function paginationDiagnostic(sourceCount, outputCount) {
  const count = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;
  const source_page_count = count(sourceCount), output_page_count = count(outputCount);
  const available = source_page_count !== null && output_page_count !== null;
  const page_count_changed = available ? source_page_count !== output_page_count : null;
  const notice = !available ? '기본 미리보기 엔진의 입력·결과 페이지 수를 비교할 수 없습니다.'
    : page_count_changed ? `기본 미리보기 엔진의 페이지 수가 ${source_page_count}쪽에서 ${output_page_count}쪽으로 바뀌었습니다.`
    : `기본 미리보기 엔진의 입력·결과 페이지 수는 모두 ${output_page_count}쪽입니다.`;
  return {
    scope: 'pinned_engine_page_count_only',
    status: !available ? 'unavailable' : page_count_changed ? 'changed' : 'unchanged',
    source_page_count, output_page_count, page_count_changed,
    message_ko: `${notice} 글꼴·줄바꿈·최종 제출 분량은 미검증입니다. 내려받은 HWP를 외부 뷰어에서도 확인하고, 문구를 임의로 줄이거나 나누지 마세요.`,
    layout_verified: false, page_limit_checked: false,
    automatic_text_shortening_allowed: false, automatic_partial_save_allowed: false,
  };
}
