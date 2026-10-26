import fs from 'node:fs';
const d = 'h3src450/';
const bc = fs.readFileSync(d + 'baseCells.c', 'utf8');
const fj = fs.readFileSync(d + 'faceijk.c', 'utf8');
const al = fs.readFileSync(d + 'algos.c', 'utf8');
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
function block(src, startRe) {
  const m = src.match(startRe); if (!m) throw new Error('no ' + startRe);
  let i = src.indexOf('{', m.index + m[0].length - 1); // '=' then '{'
  let depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
  return strip(src.slice(i, j + 1));
}
const nums = (s) => (s.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) || []).map(Number);
const out = {};
out.neighbors = nums(block(bc, /baseCellNeighbors\[NUM_BASE_CELLS\]\[7\]\s*=\s*/).replace(/INVALID_BASE_CELL/g, '127'));
out.neighborRots = nums(block(bc, /baseCellNeighbor60CCWRots\[NUM_BASE_CELLS\]\[7\]\s*=\s*/));
out.fijk = nums(block(bc, /faceIjkBaseCells\[NUM_ICOSA_FACES\]\[3\]\[3\]\[3\]\s*=\s*/));
const bcd = nums(block(bc, /baseCellData\[NUM_BASE_CELLS\]\s*=\s*/));
out.faceCenter = nums(block(fj, /faceCenterPoint\[NUM_ICOSA_FACES\]\s*=\s*/).replace(/(\d)e/g, '$1e'));
const az = nums(block(fj, /faceAxesAzRadsCII\[NUM_ICOSA_FACES\]\[3\]\s*=\s*/));
out.az0 = az.filter((_, i) => i % 3 === 0);
const D = { CENTER_DIGIT: 0, K_AXES_DIGIT: 1, J_AXES_DIGIT: 2, JK_AXES_DIGIT: 3, I_AXES_DIGIT: 4, IK_AXES_DIGIT: 5, IJ_AXES_DIGIT: 6 };
const dig = (re) => (block(al, re).match(/[A-Z_]+_DIGIT/g) || []).map((n) => D[n]);
out.newDigitII = dig(/NEW_DIGIT_II\[7\]\[7\]\s*=\s*/);
out.newAdjII = dig(/NEW_ADJUSTMENT_II\[7\]\[7\]\s*=\s*/);
out.newDigitIII = dig(/NEW_DIGIT_III\[7\]\[7\]\s*=\s*/);
out.newAdjIII = dig(/NEW_ADJUSTMENT_III\[7\]\[7\]\s*=\s*/);
// baseCellData entries: face,i,j,k,isPent,cw0,cw1
const home = [], pent = [], cw = [];
for (let i = 0; i < bcd.length; i += 7) { home.push(bcd[i]); pent.push(bcd[i + 4]); cw.push(bcd[i + 5], bcd[i + 6]); }
out.homeFace = home; out.isPent = pent; out.cwOffset = cw;
const chk = { neighbors: 854, neighborRots: 854, fijk: 20*27*2, faceCenter: 60, az0: 20, newDigitII: 49, newAdjII: 49, newDigitIII: 49, newAdjIII: 49, homeFace: 122, isPent: 122, cwOffset: 244 };
for (const [k, v] of Object.entries(chk)) if (out[k].length !== v) throw new Error(`${k}: ${out[k].length} != ${v}`);
out.pentList = pent.map((p, i) => p ? i : -1).filter((x) => x >= 0);
fs.writeFileSync('tables.json', JSON.stringify(out));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), out.pentList.join(','));
