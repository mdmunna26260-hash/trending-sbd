/* Run the repo's TypeScript helpers with node:test and the existing TypeScript
   dependency. No test transpiler dependency, database, or dev server required. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');

exports.loader = function loader(mocks = {}, env = { NODE_ENV: 'test', SESSION_SECRET: 'unit-test-only-session-secret' }) {
  const cache = new Map();
  const runtime = {};
  function load(file) {
    const absolute = path.resolve(ROOT, file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: absolute,
    }).outputText;
    const localRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      let target;
      if (id.startsWith('@/')) target = path.join(ROOT, id.slice(2));
      else if (id.startsWith('.')) target = path.resolve(path.dirname(absolute), id);
      if (target && fs.existsSync(target + '.ts')) return load(target + '.ts');
      return require(id);
    };
    const factory = vm.runInThisContext('(function(require,module,exports,process,global,globalThis){' + compiled + '\n})', { filename: absolute });
    factory(localRequire, module, module.exports, { env }, runtime, runtime);
    return module.exports;
  }
  /* Additive: modules that cache state on `global`/`globalThis` (lib/auth.ts keeps its
     rate-limit buckets there) see this object, not the real global. Exposing it lets a
     test assert on that state without reaching into the host process. Existing callers
     keep using `loader()(file)` unchanged. */
  load.runtime = runtime;
  return load;
};
