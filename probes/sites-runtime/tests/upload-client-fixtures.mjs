export function uploadClientHarness(fetcher) {
  const events = new Map(), attributes = new Map(), navigations = [];
  const element = (name) => ({ disabled: false, textContent: '', files: [],
    addEventListener(type, action) { events.set(`${name}:${type}`, action); },
    setAttribute(key, value) { attributes.set(key, value); },
  });
  const elements = new Map(['upload-form', 'hwp-file', 'upload-button', 'upload-status', 'upload-recovery'].map((id) => [id, element(id)]));
  elements.get('upload-recovery').hidden = true;
  elements.get('upload-button').disabled = true;
  return { elements, attributes, navigations,
    context: { document: { getElementById: (id) => elements.get(id) }, fetch: fetcher, crypto,
      location: { assign(url) { navigations.push(url); } }, AbortController, setTimeout, clearTimeout },
    select(file) { elements.get('hwp-file').files = file ? [file] : []; events.get('hwp-file:change')(); },
    submit() { return events.get('upload-form:submit')({ preventDefault() {} }); },
  };
}
