import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '刑事鑑定');
const outputDir = path.join(root, 'forensics');

const pages = [
  ['index.html', '刑事鑑定', 'https://www.cib.npa.gov.tw/ch/app/folder/39'],
  ['forensic-science.html', '鑑識科學', 'https://www.cib.npa.gov.tw/ch/app/folder/41'],
  ['criminal-science-journal.html', '刑事科學期刊', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg121&id=1935'],
  ['forensic-faq.html', '鑑識問答', 'https://www.cib.npa.gov.tw/ch/app/faq/list?module=faq&id=1936'],
  ['forensic-knowledge.html', '鑑識新知', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg122&id=1938'],
  ['important-news.html', '重要訊息', 'https://www.cib.npa.gov.tw/ch/app/news/list?module=news&id=18866'],
  ['dna-identification.html', 'DNA鑑定', 'https://www.cib.npa.gov.tw/ch/app/folder/44'],
  ['dna-methods.html', 'DNA鑑定方法介紹', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1452&serno=4b83570d-d278-4b0d-b3d6-f31a4a14d0d2'],
  ['dna-encyclopedia.html', 'DNA小百科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1453&serno=bcd19417-56b0-4081-aced-abb081538c2d'],
  ['dna-laws.html', 'DNA相關法令', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg123&id=1946'],
  ['dna-statistics.html', 'DNA相關統計資料', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1454&serno=6b6dd1ce-3014-4ba0-a716-03c70d1b3854'],
  ['fingerprint-science.html', '指紋科學', 'https://www.cib.npa.gov.tw/ch/app/folder/46'],
  ['fingerprint-work.html', '指紋鑑識工作', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg124&id=1954'],
  ['fingerprint-encyclopedia.html', '指紋科學小百科', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg124&id=1956'],
  ['fingerprint-methods.html', '指紋鑑識方法介紹', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg124&id=1958'],
  ['drugs.html', '常見毒品', 'https://www.cib.npa.gov.tw/ch/app/folder/48'],
  ['emerging-drugs.html', '新興毒品', 'https://www.cib.npa.gov.tw/ch/app/drup/list?module=drup&id=1963'],
  ['drug-class-1.html', '第一級毒品', 'https://www.cib.npa.gov.tw/ch/app/drup/list?module=drup&id=1966'],
  ['drug-class-2.html', '第二級毒品', 'https://www.cib.npa.gov.tw/ch/app/drup/list?module=drup&id=1970'],
  ['drug-class-3.html', '第三級毒品', 'https://www.cib.npa.gov.tw/ch/app/drup/list?module=drup&id=1972'],
  ['drug-class-4.html', '第四級毒品', 'https://www.cib.npa.gov.tw/ch/app/drup/list?module=drup&id=1973']
];

const menuGroups = [
  ['鑑識科學', 'forensic-science.html', ['criminal-science-journal.html', 'forensic-faq.html', 'forensic-knowledge.html', 'important-news.html']],
  ['DNA鑑定', 'dna-identification.html', ['dna-methods.html', 'dna-encyclopedia.html', 'dna-laws.html', 'dna-statistics.html']],
  ['指紋科學', 'fingerprint-science.html', ['fingerprint-work.html', 'fingerprint-encyclopedia.html', 'fingerprint-methods.html']],
  ['常見毒品', 'drugs.html', ['emerging-drugs.html', 'drug-class-1.html', 'drug-class-2.html', 'drug-class-3.html', 'drug-class-4.html']]
];

const pageBySlug = new Map(pages.map(([slug, title]) => [slug, title]));
const localByUrl = new Map(pages.map(([slug, , url]) => [url, slug === 'index.html' ? '/forensics/' : `/forensics/${slug}`]));

function replacementVariants(url) {
  const local = localByUrl.get(url);
  const parsed = new URL(url);
  const relative = parsed.pathname + parsed.search;
  return [url, url.replaceAll('&', '&amp;'), relative, relative.replaceAll('&', '&amp;')]
    .map((from) => [from, local]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceExactUrl(output, from, to) {
  return output.replace(new RegExp(`${escapeRegExp(from)}(?![A-Za-z0-9])`, 'g'), to);
}

function rewriteForensicsLinks(html) {
  let output = html.replaceAll('/announcements/clarifications.html6', '/forensics/important-news.html');
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
  throw new Error(`Cannot find forensic page: ${title}`);
}

function forensicsMenuHtml() {
  return menuGroups.map(([title, slug, children]) => {
    const childHtml = children
      .map((childSlug) => ` <li><a href="/forensics/${childSlug}" title="${pageBySlug.get(childSlug)}">${pageBySlug.get(childSlug)}</a></li>`)
      .join('\n');
    return ` <li><a href="/forensics/${slug}" title="${title}">${title}</a>\n <ul>\n${childHtml}\n </ul>\n </li>`;
  }).join('\n');
}

function rewriteHomeForensicsMenu() {
  const indexPath = path.join(root, 'index.html');
  let html = rewriteForensicsLinks(fs.readFileSync(indexPath, 'utf8'));
  const start = html.indexOf('<a href=/forensics/ title=刑事鑑定>');
  if (start < 0) throw new Error('Could not find forensic menu block in index.html');

  const nextMenuItem = html.indexOf('<li class=menu-dropdown-icon>', start + 1);
  if (nextMenuItem < 0) throw new Error('Could not find forensic menu block boundary in index.html');
  const end = html.lastIndexOf('</li>', nextMenuItem);
  if (end < start) throw new Error('Could not find forensic menu block closing tag in index.html');

  const replacement = `<a href=/forensics/ title=刑事鑑定>\n 刑事鑑定 </a>\n <ul class="equal-height-thumbnail cib-service-menu cib-forensics-menu sf-hidden">\n${forensicsMenuHtml()}\n </ul>`;
  html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  fs.writeFileSync(indexPath, html, 'utf8');
}

function rewriteExistingHtmlFiles() {
  const dirs = [path.join(root, 'agency-introduction-pages'), path.join(root, 'announcements'), path.join(root, 'wanted')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      const filePath = path.join(dir, file);
      fs.writeFileSync(filePath, rewriteForensicsLinks(fs.readFileSync(filePath, 'utf8')), 'utf8');
    }
  }
}

fs.mkdirSync(outputDir, { recursive: true });

for (const [slug, title] of pages) {
  const sourceFile = findSourceFile(title);
  const html = rewriteForensicsLinks(fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'));
  fs.writeFileSync(path.join(outputDir, slug), html, 'utf8');
  console.log(`${sourceFile} -> forensics/${slug}`);
}

rewriteHomeForensicsMenu();
rewriteExistingHtmlFiles();
await import('./rewrite-local-home-links.mjs?forensics=' + Date.now());
console.log('forensics links rewritten');