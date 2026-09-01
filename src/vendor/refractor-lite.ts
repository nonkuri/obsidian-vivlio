/**
 * refractor with a curated language set.
 *
 * `refractor` (v3) registers ~270 Prism grammars on import, which adds several
 * megabytes to the bundle. VFM only ever calls `registered()` / `highlight()`,
 * so aliasing the package to this module (see esbuild.config.mjs) keeps code
 * highlighting working for the languages people actually put in notes.
 *
 * Unregistered languages fall back to an unhighlighted <code> block, which is
 * what VFM already does for `plaintext`.
 */
// @ts-nocheck
import refractor from "refractor/core.js";

import markup from "refractor/lang/markup.js";
import css from "refractor/lang/css.js";
import clike from "refractor/lang/clike.js";
import javascript from "refractor/lang/javascript.js";
import typescript from "refractor/lang/typescript.js";
import jsx from "refractor/lang/jsx.js";
import tsx from "refractor/lang/tsx.js";
import json from "refractor/lang/json.js";
import yaml from "refractor/lang/yaml.js";
import toml from "refractor/lang/toml.js";
import ini from "refractor/lang/ini.js";
import bash from "refractor/lang/bash.js";
import diff from "refractor/lang/diff.js";
import markdown from "refractor/lang/markdown.js";
import python from "refractor/lang/python.js";
import ruby from "refractor/lang/ruby.js";
import go from "refractor/lang/go.js";
import rust from "refractor/lang/rust.js";
import c from "refractor/lang/c.js";
import cpp from "refractor/lang/cpp.js";
import csharp from "refractor/lang/csharp.js";
import java from "refractor/lang/java.js";
import kotlin from "refractor/lang/kotlin.js";
import swift from "refractor/lang/swift.js";
import php from "refractor/lang/php.js";
import sql from "refractor/lang/sql.js";
import docker from "refractor/lang/docker.js";
import regex from "refractor/lang/regex.js";

for (const lang of [
  markup, css, clike, javascript, typescript, jsx, tsx, json, yaml, toml, ini,
  bash, diff, markdown, python, ruby, go, rust, c, cpp, csharp, java, kotlin,
  swift, php, sql, docker, regex,
]) {
  refractor.register(lang);
}

export default refractor;
