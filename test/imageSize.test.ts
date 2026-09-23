import assert from "node:assert/strict";
import { imageSize } from "../src/util/imageSize";

const size = (source: string) => imageSize(new TextEncoder().encode(source), "image.svg");
assert.deepEqual(size('<svg width="180" height="77" viewBox="0 0 420 180"></svg>'), { width: 180, height: 77 });
assert.deepEqual(size('<svg viewBox="0 0 420 180" width="180px" height="77px"></svg>'), { width: 180, height: 77 });
assert.deepEqual(size('<svg width="25.4mm" height="1in" viewBox="0 0 420 180"></svg>'), { width: 96, height: 96 });
assert.deepEqual(size('<svg width="72pt" height="6pc"></svg>'), { width: 96, height: 96 });
assert.deepEqual(size('<svg width="180" viewBox="0 0 420 210"></svg>'), { width: 180, height: 90 });
assert.deepEqual(size('<svg height="90" viewBox="0 0 420 210"></svg>'), { width: 180, height: 90 });
assert.deepEqual(size('<svg width="100%" height="auto" viewBox="0,0,420,180"></svg>'), { width: 420, height: 180 });
assert.deepEqual(size('<svg viewBox="0 0 420 180"><rect width="12" height="8"/></svg>'), { width: 420, height: 180 });
assert.equal(size('<svg><rect width="12" height="8"/></svg>'), null);
assert.equal(size('<svg width="100%" height="100%"></svg>'), null);
assert.equal(size('<svg viewBox="0 0 0 -1"></svg>'), null);
process.stdout.write("SVG sizes: viewport dimensions, units, aspect ratio and viewBox fallback passed\n");
