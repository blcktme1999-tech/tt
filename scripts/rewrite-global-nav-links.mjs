import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetDirs = [
  'agency-introduction-pages',
  'announcements',
  'wanted',
  'forensics',
  'public-info',
  'public-services',
  'sitemap',
  'related-links'
];
const targetFiles = ['index.html'];

function removeAnchorByText(html, text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let output = html;
  output = output.replace(new RegExp(`\\s*\\|\\s*<a\\b[^>]*>\\s*${escaped}\\s*</a>`, 'g'), '');
  output = output.replace(new RegExp(`<a\\b[^>]*>\\s*${escaped}\\s*</a>\\s*\\|\\s*`, 'g'), '');
  output = output.replace(new RegExp(`\\n?\\s*<li[^>]*>\\s*<a\\b[^>]*>\\s*${escaped}\\s*</a>\\s*</li>`, 'g'), '');
  output = output.replace(new RegExp(`\\n?\\s*<li[^>]*>\\s*<a\\b[^>]*>\\s*${escaped}\\s*</a>\\s*\\n\\s*</li>`, 'g'), '');
  output = output.replace(new RegExp(`<a\\b[^>]*>\\s*${escaped}\\s*</a>`, 'g'), '');
  return output;
}

function rewriteGlobalNavLinks(html) {
  let output = html
    .replaceAll('href="https://www.cib.npa.gov.tw/ch/sitemap"', 'href="/sitemap/"')
    .replaceAll('href=https://www.cib.npa.gov.tw/ch/sitemap', 'href=/sitemap/')
    .replaceAll('href="/ch/sitemap"', 'href="/sitemap/"')
    .replaceAll('href=/ch/sitemap', 'href=/sitemap/');
  output = removeAnchorByText(output, 'English');
  output = removeAnchorByText(output, '雙語詞彙');
  return output;
}

function rewriteFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const before = fs.readFileSync(filePath, 'utf8');
  const after = rewriteGlobalNavLinks(before);
  if (after === before) return false;
  fs.writeFileSync(filePath, after, 'utf8');
  return true;
}

let rewritten = 0;
for (const file of targetFiles) if (rewriteFile(path.join(root, file))) rewritten += 1;
for (const dirName of targetDirs) {
  const dir = path.join(root, dirName);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.html') && rewriteFile(path.join(dir, file))) rewritten += 1;
  }
}

console.log(`rewrote global nav links in ${rewritten} files`);