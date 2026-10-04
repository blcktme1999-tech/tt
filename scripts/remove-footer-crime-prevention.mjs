import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetDirs = ['agency-introduction-pages', 'announcements', 'wanted', 'forensics', 'public-info', 'public-services', 'sitemap', 'related-links'];
const targetFiles = ['index.html'];

function removeFooterCrimePrevention(html) {
  return html.replace(/\n?\s*<ul>\s*\n?\s*<li class=(?:"|')?title(?:"|')?><a\b[^>]*>\s*犯罪預防\s*<\/a><\/li>[\s\S]*?<\/ul>/g, '');
}

function rewriteFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const before = fs.readFileSync(filePath, 'utf8');
  const after = removeFooterCrimePrevention(before);
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

console.log(`removed footer crime-prevention blocks in ${rewritten} files`);