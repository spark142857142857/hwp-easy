// Developer-only numeric call timing. Never retain arguments, return values or
// arbitrary method names from document data; production uses the original class.
import { performance } from 'node:perf_hooks';

export function profileSyntheticEngine(Type) {
  let phase = 'unassigned';
  const phases = new Map();
  const mutations = new Set(['replaceText', 'setCharShapeId', 'deleteTextInCell', 'insertTextInCell', 'setCharShapeIdInCell']);
  const timed = (category, action) => {
    const start = performance.now();
    try { return action(); }
    finally {
      // "constructor" must be an own numeric row, not Object.prototype's
      // inherited constructor function.
      if (!phases.has(phase)) phases.set(phase, Object.create(null));
      const row = phases.get(phase)[category] ??= { calls: 0, duration_ms: 0 };
      row.calls++; row.duration_ms += performance.now() - start;
    }
  };
  const Document = new Proxy(Type, { construct(Target, args) {
    const document = timed('constructor', () => Reflect.construct(Target, args, Target));
    const methods = new Map();
    return new Proxy(document, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!methods.has(key)) {
        const category = key === 'exportHwpWithReport' ? 'export' : key === 'free' ? 'free'
          : mutations.has(key) ? key : 'inspection_queries';
        methods.set(key, (...args) => timed(category, () => Reflect.apply(value, target, args)));
      }
      return methods.get(key);
    } });
  } });
  return { Document, setPhase(name) { phase = name; }, report() {
    return structuredClone(Object.fromEntries(phases));
  } };
}
