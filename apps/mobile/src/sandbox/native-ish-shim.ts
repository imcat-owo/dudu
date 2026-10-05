/**
 * Optional native-module stub for iSH.
 *
 * backend-ish.ts does `require("./native-ish-shim")` inside a try/catch to
 * detect host-app builds that bundle the real iSH bridge. Metro resolves
 * every require() at bundle time (try/catch doesn't help), so this stub
 * exists to keep the bundle green in builds without iSH: `default` is null,
 * therefore resolveNativeISH() keeps returning null, exactly like before.
 *
 * If a host-app build ever ships a real shim, replace this file — do not
 * keep both.
 */
const shim: null = null;
export default shim;
