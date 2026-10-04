import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetDirs = ['agency-introduction-pages', 'announcements', 'wanted', 'forensics', 'public-info', 'public-services', 'sitemap', 'related-links'];
const targetFiles = ['index.html'];

function rewriteHomeLinks(html) {
  return html
    .replaceAll('href="https://www.cib.npa.gov.tw/ch/index"', 'href="/"')
    .replaceAll('href=https://www.cib.npa.gov.tw/ch/index', 'href=/')
    .replaceAll('href="/ch/index"', 'href="/"')
    .replaceAll('href=/ch/index', 'href=/');
}

let rewritten = 0;
for (const file of targetFiles) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) continue;
  const before = fs.readFileSync(filePath, 'utf8');
  const after = rewriteHomeLinks(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    rewritten += 1;
  }
}

for (const dirName of targetDirs) {
  const dir = path.join(root, dirName);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.html')) continue;
    const filePath = path.join(dir, file);
    const before = fs.readFileSync(filePath, 'utf8');
    const after = rewriteHomeLinks(before);
    if (after !== before) {
      fs.writeFileSync(filePath, after, 'utf8');
      rewritten += 1;
    }
  }
}

console.log(`rewrote home links in ${rewritten} files`);