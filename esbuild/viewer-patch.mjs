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

  // Core 2.45 derives the next spine's page counter from the last page's
  // PRE-render snapshot plus a hard-coded 1. That loses any counter-reset or
  // counter-increment on that page (including a one-page cover or chapter).
  // Keep the actual change on the rendered page, separate from the start
  // snapshot used for re-layout. Reading start + delta also follows shifts
  // applied to those snapshots when a cross-document TOC grows.
  // Physical pageNumberOffset remains untouched: folios do not change sides.
  patched = replaceOnce(
    patched,
    'finishPageContainer(e,t,i){',
    'finishPageContainer(e,t,i){' +
      'const vivlioCoverVerso=e.item.vivlioAfterCover&&0===i&&!t.container.textContent.trim();' +
      'vivlioCoverVerso&&this.counterStore.forceSetPageCounter(this.counterStore.currentPageCounters.page.at(-1)-1);' +
      't.container.vivlioIsCoverVerso=vivlioCoverVerso;' +
      't.vivlioPageCounterDelta=this.counterStore.currentPageCounters.page.at(-1)-e.pageCounterStarts[i].page.at(-1);' +
      'Object.defineProperty(t.container,"vivlioPageNumber",{get:()=>e.pageCounterStarts[i].page.at(-1)+t.vivlioPageCounterDelta});' +
      'for(const e of t.container.querySelectorAll("[data-vivliostyle-page-counter]")){const t=Number(e.textContent.trim());Number.isFinite(t)&&t<=0&&(e.style.visibility="hidden")}',
    "rendered page counter snapshot",
  );
  patched = replaceOnce(
    patched,
    'if(t&&t.length)f=t[t.length-1]+1;',
    'if(t&&t.length)f=t[t.length-1]+m.pages[m.pages.length-1].vivlioPageCounterDelta;',
    "cross-document page counter offset",
  );
  // Web Publication manifests normally have no pagination extension, and Core
  // discards unknown link fields. Preserve Vivlio's numeric `startPage` on the
  // reading-order item without using Core's built-in `startPage`: that option
  // changes the physical page offset as well as the folio and makes Chromium
  // print leading sheets. Only the page counter should change here.
  patched = replaceOnce(
    patched,
    'index:b++,startPage:null,skipPagesBefore:null',
    'index:b++,startPage:null,skipPagesBefore:null,vivlioStartPage:"number"==typeof t.startPage?t.startPage:null,vivlioAfterCover:!0===t.vivlioAfterCover',
    "Web Publication startPage field",
  );
  patched = replaceOnce(
    patched,
    'this.startPage=e.startPage,this.skipPagesBefore=e.skipPagesBefore',
    'this.startPage=e.startPage,this.skipPagesBefore=e.skipPagesBefore,this.vivlioStartPage=e.vivlioStartPage,this.vivlioAfterCover=e.vivlioAfterCover',
    "Web Publication item page-counter start",
  );
  patched = replaceOnce(
    patched,
    'this.counterStore.forceSetPageCounter(f);',
    'null!=r.vivlioStartPage&&(f=r.vivlioStartPage-1),this.counterStore.forceSetPageCounter(f);',
    "Web Publication page-counter start",
  );

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
