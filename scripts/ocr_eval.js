const fs = require('fs');
const path = require('path');
const { recognizeText } = require('../src/ocr');
const { levenshtein } = require('../src/ocr/postprocess');

function listImages(dir) {
  const exts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  return fs
    .readdirSync(dir)
    .filter((f) => exts.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(dir, f));
}

function loadGroundTruth(imagePath) {
  const txtPath = imagePath.replace(path.extname(imagePath), '.txt');
  if (!fs.existsSync(txtPath)) return null;
  return fs.readFileSync(txtPath, 'utf8');
}

async function main() {
  const dir = process.argv[2] || process.env.OCR_EVAL_DIR;
  if (!dir) {
    process.stderr.write('usage: node scripts/ocr_eval.js <dir>\n');
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    process.stderr.write(`dir not found: ${dir}\n`);
    process.exit(1);
  }

  const images = listImages(dir);
  const results = [];
  for (const img of images) {
    const buf = fs.readFileSync(img);
    const base64 = buf.toString('base64');
    const out = await recognizeText(base64);
    const truth = loadGroundTruth(img);
    const score = truth ? levenshtein(out, truth) : null;
    results.push({
      file: path.basename(img),
      ocr_length: out.length,
      levenshtein: score,
      has_truth: !!truth,
    });
    const outPath = img.replace(path.extname(img), '.ocr.txt');
    fs.writeFileSync(outPath, out, 'utf8');
  }

  const summaryPath = path.join(dir, 'ocr_eval_results.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ count: results.length, results }, null, 2));
  process.stdout.write(`wrote: ${summaryPath}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
