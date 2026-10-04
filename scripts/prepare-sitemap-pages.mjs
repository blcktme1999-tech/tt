import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '網站導覽');
const outputDir = path.join(root, 'sitemap');

function findSourceFile() {
  const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.html'));
  const source = files.find((file) => file.startsWith('網站導覽')) || files[0];
  if (!source) throw new Error('Cannot find sitemap page');
  return source;
}

fs.mkdirSync(outputDir, { recursive: true });
const sourceFile = findSourceFile();
fs.writeFileSync(path.join(outputDir, 'index.html'), fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'), 'utf8');
console.log(`${sourceFile} -> sitemap/index.html`);

await import('./rewrite-local-home-links.mjs?sitemap=' + Date.now());
await import('./rewrite-global-nav-links.mjs?sitemap=' + Date.now());
await import('./remove-ungrabbed-menu-items.mjs?sitemap=' + Date.now());
console.log('sitemap links rewritten');