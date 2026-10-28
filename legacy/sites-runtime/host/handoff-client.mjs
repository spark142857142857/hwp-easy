// Fixed, same-origin viewer code. Explicit clipboard action only; no network or storage.
export function installHandoff({ document, navigator, setTimeout, clearTimeout }) {
  const button = document.getElementById('handoff-copy');
  const text = document.getElementById('handoff-request');
  const details = document.getElementById('handoff-details');
  const status = document.getElementById('handoff-status');
  if (!button || !text || !details || !status) return;
  button.disabled = false;
  let busy = false;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; button.disabled = true; status.textContent = '요청을 복사하고 있습니다.';
    let timer;
    try {
      if (!navigator?.clipboard?.writeText) throw Error('CLIPBOARD_UNAVAILABLE');
      const pending = navigator.clipboard.writeText(text.value);
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('CLIPBOARD_TIMEOUT')), 4000);
      });
      await Promise.race([pending, deadline]);
      status.textContent = '복사했어요. HWP Easy가 연결된 대화에 붙여넣으세요.';
    } catch {
      details.open = true;
      text.focus(); text.select();
      status.textContent = '자동 복사를 사용할 수 없습니다. 선택된 요청을 직접 복사해 주세요.';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      busy = false; button.disabled = false;
    }
  });
}
