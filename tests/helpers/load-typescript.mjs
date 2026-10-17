import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const root = fileURLToPath(new URL("../../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
/** Real local modules with explicit I/O overrides, cached per isolated test. */
export function typescriptLoader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    let absolute = path.resolve(root, file);
    if (!existsSync(absolute))
      absolute += existsSync(absolute + ".ts") ? ".ts" : ".tsx";
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const evaluated = { exports: {} };
    cache.set(absolute, evaluated);
    const scope = {
      module: evaluated,
      exports: evaluated.exports,
      Error,
      TypeError,
      RangeError,
      Date,
      Intl,
      URL,
      URLSearchParams,
      Request,
      Response,
      AbortSignal,
      AbortController,
      Buffer,
      console,
      process,
      setTimeout,
      clearTimeout,
      ...globals,
      require(id) {
        if (Object.hasOwn(overrides, id)) return overrides[id];
        if (id === "server-only") return {};
        if (id.startsWith("@/")) return load(id.slice(2));
        if (id.startsWith("."))
          return load(path.resolve(path.dirname(absolute), id));
        return nativeRequire(id);
      },
    };
    const result = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
      reportDiagnostics: true,
    });
    if (
      result.diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error)
    )
      throw new Error(`Cannot transpile ${file}`);
    vm.runInNewContext(result.outputText, scope, { filename: absolute });
    return evaluated.exports;
  }
  return load;
}
