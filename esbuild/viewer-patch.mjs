import vm from "node:vm";

/**
 * Take two unreachable paths out of the Vivliostyle viewer before it is
 * embedded (SPEC 5.12).
 *
 * The viewer ships as one prebuilt file, which the plugin serves to the frame
 * rather than runs itself. Two places in it build a `<script>` element:
 *
 *  1. Knockout's task scheduler, which picks between a MutationObserver, an
 *     Internet Explorer 8 trick that schedules work by appending a `<script>`
 *     and waiting for `onreadystatechange`, and a `setTimeout` fallback.
 *     Chromium has MutationObserver, so the first branch is always the one
 *     taken and the middle one has never run here.
 *
 *  2. Vivliostyle's own executor for scripts found in a publication. The
 *     plugin already turns this off, in `bookViewerUrl`, by asking the viewer
 *     for `allowScripts=false`; the function returns at its first line before
 *     reaching this code. Removing it makes the copy the plugin ships unable
 *     to run a manuscript's scripts at all, rather than merely configured not
 *     to - which is the property this plugin actually wants, and the one it
 *     already promises in `hast/sanitize.ts`.
 *
 * Neither edit changes what the viewer does here. Both remove text that says
 * otherwise to anyone - a person or a scanner - reading the bundle, and a
 * capability that cannot be re-enabled by a setting is worth more than one
 * that can.
 *
 * This is a modification of an AGPL-3.0 work, made in the open: the patch is
 * this file, the result is reproducible from `npm run build`, and NOTICE says
 * that the bundled viewer is modified.
 *
 * The patterns are matched literally and must each appear exactly once. A
 * viewer upgrade that moves them fails the build rather than passing an
 * unpatched bundle through, which is the only failure mode worth having: the
 * alternative is a silent return to shipping the code above.
 */

/** Knockout's scheduler, minus the branch written for Internet Explorer. */
const IE_SCHEDULER =
  'i&&"onreadystatechange"in i.createElement("script")?' +
  "function(e){var t=i.createElement(\"script\");t.onreadystatechange=function(){" +
  "t.onreadystatechange=null,i.documentElement.removeChild(t),t=null,e()}," +
  "i.documentElement.appendChild(t)}:";

/**
 * The tail of Vivliostyle's script executor, from the element it builds to
 * the value it returns. The `so(!0)` at the end is the module's own "done,
 * true" helper under a minified name; the replacement reports "done, false"
 * through the same helper, which is what the function already returns at its
 * first line when scripting is off.
 */
const SCRIPT_EXECUTOR =
  /let u=t\.document\.createElement\("script"\);u\.textContent=n,.*?return t\.document\.head\.appendChild\(u\),(\w+)\(!0\)/s;

/** Replace exactly one occurrence, or say which pattern went missing. */
function replaceOnce(source, pattern, replacement, what) {
  const matches = source.split(pattern).length - 1;
  if (matches !== 1) {
    throw new Error(
      `viewer patch: expected exactly one ${what} in the bundled viewer, found ${matches}. ` +
        "The viewer was probably upgraded; re-read the code the patch removes before adjusting it.",
    );
  }
  return source.replace(pattern, replacement);
}

export function hardenViewer(source) {
  let patched = replaceOnce(source, IE_SCHEDULER, "", "Internet Explorer scheduler");

  const executor = SCRIPT_EXECUTOR.exec(patched);
  if (!executor) {
    throw new Error(
      "viewer patch: the script executor was not found in the bundled viewer. " +
        "The viewer was probably upgraded; re-read the code the patch removes before adjusting it.",
    );
  }
  patched = patched.replace(SCRIPT_EXECUTOR, `return ${executor[1]}(!1)`);

  const left = patched.match(/createElement\((["'])script\1\)/g);
  if (left) {
    throw new Error(
      `viewer patch: ${left.length} script element creation(s) still in the bundled viewer.`,
    );
  }

  // Compiling is not running: this only asks V8 whether the file the patch
  // produced is still a program, which is the one thing a text edit on a
  // minified bundle can quietly get wrong.
  try {
    new vm.Script(patched, { filename: "vivliostyle-viewer.js" });
  } catch (error) {
    throw new Error(`viewer patch: the patched viewer no longer parses: ${error.message}`);
  }

  return patched;
}
