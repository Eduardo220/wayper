const fs = require("node:fs");
const babel = require("@babel/core");

// Shallow execution of actual JSX and handlers; native rendering is validated on Android.
module.exports = function componentHarness(filename, dependencies) {
  const values = [], effects = [], memo = [], cleanups = [];
  let cursor = 0;
  const effect = (fn, deps) => {
    const index = cursor++;
    if (!memo[index] || deps.some((v, i) => v !== memo[index][i])) {
      memo[index] = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = fn(); });
    }
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    Fragment: "Fragment",
    useState: (initial) => {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useRef: (initial) => {
      const index = cursor++;
      if (!(index in values)) values[index] = { current: dependencies.capture || initial };
      return values[index];
    },
    useEffect: effect,
    useCallback: (fn, deps) => {
      const index = cursor++;
      if (!memo[index] || deps.some((v, i) => v !== memo[index].deps[i])) memo[index] = { fn, deps };
      return memo[index].fn;
    },
  };
  const code = babel.transformSync(fs.readFileSync(filename, "utf8"), { babelrc: false, configFile: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  const imports = {
    react: { __esModule: true, default: react, ...react },
    "@react-navigation/native": { useFocusEffect: (fn) => effect(fn, [fn]) },
    ...dependencies,
  };
  new Function("require", "module", "exports", code)((name) => {
    if (!(name in imports)) throw new Error(`Missing shallow dependency: ${name}`);
    return imports[name];
  }, module, module.exports);
  return { exports: module.exports, render(props, name = "default") { cursor = 0; return module.exports[name](props); },
    async flush() { effects.splice(0).forEach((fn) => fn()); for (let i = 0; i < 6; i++) await Promise.resolve(); },
    unmount() { cleanups.forEach((fn) => fn?.()); }, values };
};
module.exports.nodes = function nodes(tree) {
  return tree && typeof tree === "object" ? [tree, ...(tree.props?.children || []).flatMap(module.exports.nodes)] : [];
};
