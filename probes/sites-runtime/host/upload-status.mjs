// This describes agent file import, not OAuth health or a production certificate.
export function uploadStatus(uploadsEnabled, fileOriginsConfigured) {
  if (!uploadsEnabled) return {
    state: 'disabled', agent_file_import_available: false, production_ready: false,
    message_ko: '연결과 저장된 시험 문서 작업은 가능하지만, 개인 HWP 파일 업로드는 아직 꺼져 있습니다.',
  };
  if (!fileOriginsConfigured) return {
    state: 'file_host_not_configured', agent_file_import_available: false, production_ready: false,
    message_ko: '업로드 설정은 켜져 있지만, 에이전트의 파일 전달 호스트가 검증·설정되지 않아 파일을 가져올 수 없습니다.',
  };
  return {
    state: 'development_enabled_unverified', agent_file_import_available: true, production_ready: false,
    message_ko: '개발용 파일 가져오기 경로가 설정되어 있습니다. 실제 클라이언트 전달·사용자 격리·운영 검증 완료를 뜻하지 않습니다.',
  };
}
