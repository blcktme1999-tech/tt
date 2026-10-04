import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '相關連結');
const outputDir = path.join(root, 'related-links');

const pages = [
  ['index.html', '相關連結', 'https://www.cib.npa.gov.tw/ch/app/folder/75'],
  ['civil-service-learning.html', '公務學習園地', 'https://www.cib.npa.gov.tw/ch/app/webLink/list?module=webLink&id=2148']
];

const localByUrl = new Map(pages.map(([slug, , url]) => [url, slug === 'index.html' ? '/related-links/' : `/related-links/${slug}`]));

function replacementVariants(url) {
  const local = localByUrl.get(url);
  const parsed = new URL(url);
  const relative = parsed.pathname + parsed.search;
  return [url, url.replaceAll('&', '&amp;'), relative, relative.replaceAll('&', '&amp;')].map((from) => [from, local]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceExactUrl(output, from, to) {
  return output.replace(new RegExp(`${escapeRegExp(from)}(?![A-Za-z0-9])`, 'g'), to);
}

function rewriteRelatedLinks(html) {
  let output = html;
  for (const url of localByUrl.keys()) {
    for (const [from, to] of replacementVariants(url)) output = replaceExactUrl(output, from, to);
  }
  return output;
}

function titleOf(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match?.[1] || '').trim();
}

function findSourceFile(title) {
  const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.html'));
  const exact = files.find((file) => file.startsWith(`${title}-`) || file.startsWith(`${title} (`));
  if (exact) return exact;
  const byTitle = files.find((file) => titleOf(fs.readFileSync(path.join(sourceDir, file), 'utf8')).startsWith(title));
  if (byTitle) return byTitle;
  throw new Error(`Cannot find related-links page: ${title}`);
}

function relatedLinksMenuHtml() {
  return ' <li><a href="/related-links/civil-service-learning.html" title="公務學習園地">公務學習園地</a></li>';
}

function rewriteHomeRelatedLinksMenu() {
  const indexPath = path.join(root, 'index.html');
  let html = rewriteRelatedLinks(fs.readFileSync(indexPath, 'utf8'));
  const start = html.indexOf('<a href=/related-links/ title=相關連結>');
  if (start < 0) throw new Error('Could not find related-links menu block in index.html');
  const nextMenuItem = html.indexOf('<div class="banner', start + 1);
  const nextTopMenuItem = html.indexOf('<li class=menu-dropdown-icon>', start + 1);
  const boundary = nextTopMenuItem >= 0 ? nextTopMenuItem : nextMenuItem;
  if (boundary < 0) throw new Error('Could not find related-links menu block boundary in index.html');
  const end = html.lastIndexOf('</li>', boundary);
  if (end < start) throw new Error('Could not find related-links menu block closing tag in index.html');
  const replacement = `<a href=/related-links/ title=相關連結>\n 相關連結 </a>\n <ul class="equal-height-thumbnail cib-service-menu cib-related-links-menu sf-hidden">\n${relatedLinksMenuHtml()}\n </ul>`;
  html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  fs.writeFileSync(indexPath, html, 'utf8');
}

function rewriteExistingHtmlFiles() {
  const dirs = [path.join(root, 'agency-introduction-pages'), path.join(root, 'announcements'), path.join(root, 'wanted'), path.join(root, 'forensics'), path.join(root, 'public-info'), path.join(root, 'public-services'), path.join(root, 'sitemap')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      const filePath = path.join(dir, file);
      fs.writeFileSync(filePath, rewriteRelatedLinks(fs.readFileSync(filePath, 'utf8')), 'utf8');
    }
  }
}

fs.mkdirSync(outputDir, { recursive: true });
for (const [slug, title] of pages) {
  const sourceFile = findSourceFile(title);
  const html = rewriteRelatedLinks(fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'));
  fs.writeFileSync(path.join(outputDir, slug), html, 'utf8');
  console.log(`${sourceFile} -> related-links/${slug}`);
}

rewriteHomeRelatedLinksMenu();
rewriteExistingHtmlFiles();
await import('./remove-ungrabbed-menu-items.mjs?relatedLinks=' + Date.now());
await import('./rewrite-local-home-links.mjs?relatedLinks=' + Date.now());
await import('./rewrite-global-nav-links.mjs?relatedLinks=' + Date.now());
console.log('related-links rewritten');