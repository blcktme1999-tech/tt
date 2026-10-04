import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '資訊公開');
const outputDir = path.join(root, 'public-info');

const pages = [
  ['index.html', '資訊公開', 'https://www.cib.npa.gov.tw/ch/app/folder/49'],
  ['laws.html', '法規資訊', 'https://www.cib.npa.gov.tw/ch/app/folder/51'],
  ['business-laws.html', '本局業務相關法規', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg126&id=1983'],
  ['major-policies.html', '重大政策', 'https://www.cib.npa.gov.tw/ch/app/folder/54'],
  ['internal-control.html', '內部控制聲明書', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg127&id=2000'],
  ['policy-plans.html', '施政方針及計畫', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg145&id=2001'],
  ['government-info.html', '政府公開資訊', 'https://www.cib.npa.gov.tw/ch/app/folder/57'],
  ['research-reports.html', '研究報告', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg128&id=2009'],
  ['budget.html', '預算書', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg129&id=2015'],
  ['final-accounts.html', '決算書', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg130&id=2017'],
  ['accounting-reports.html', '會計報告', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg131&id=2020'],
  ['cost-benefit.html', '成本效益分析報告', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg132&id=2022'],
  ['publications.html', '出版品', 'https://www.cib.npa.gov.tw/ch/app/folder/60'],
  ['bimonthly.html', '刑事雙月刊', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg135&id=2049'],
  ['good-morning-images.html', '早安圖專區', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg135&id=18284'],
  ['crime-statistics.html', '刑案統計', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg136&id=2053']
];

const groups = [
  ['法規資訊', 'laws.html', [['本局業務相關法規', 'business-laws.html']]],
  ['重大政策', 'major-policies.html', [['內部控制聲明書', 'internal-control.html'], ['施政方針及計畫', 'policy-plans.html']]],
  ['政府公開資訊', 'government-info.html', [
    ['研究報告', 'research-reports.html'],
    ['預算書', 'budget.html'],
    ['決算書', 'final-accounts.html'],
    ['會計報告', 'accounting-reports.html'],
    ['成本效益分析報告', 'cost-benefit.html']
  ]],
  ['出版品', 'publications.html', [['刑事雙月刊', 'bimonthly.html'], ['早安圖專區', 'good-morning-images.html']]],
  ['刑案統計', 'crime-statistics.html', []]
];

const localByUrl = new Map(pages.map(([slug, , url]) => [url, slug === 'index.html' ? '/public-info/' : `/public-info/${slug}`]));

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

function rewritePublicInfoLinks(html) {
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
  throw new Error(`Cannot find public-info page: ${title}`);
}

function publicInfoMenuHtml() {
  return groups.map(([title, slug, children]) => {
    const childHtml = children.length
      ? `\n <ul>\n${children.map(([childTitle, childSlug]) => ` <li><a href="/public-info/${childSlug}" title="${childTitle}">${childTitle}</a></li>`).join('\n')}\n </ul>`
      : '';
    return ` <li><a href="/public-info/${slug}" title="${title}">${title}</a>${childHtml}\n </li>`;
  }).join('\n');
}

function rewriteHomePublicInfoMenu() {
  const indexPath = path.join(root, 'index.html');
  let html = rewritePublicInfoLinks(fs.readFileSync(indexPath, 'utf8'));
  const start = html.indexOf('<a href=/public-info/ title=資訊公開>');
  if (start < 0) throw new Error('Could not find public-info menu block in index.html');
  const nextMenuItem = html.indexOf('<li class=menu-dropdown-icon>', start + 1);
  if (nextMenuItem < 0) throw new Error('Could not find public-info menu block boundary in index.html');
  const end = html.lastIndexOf('</li>', nextMenuItem);
  if (end < start) throw new Error('Could not find public-info menu block closing tag in index.html');
  const replacement = `<a href=/public-info/ title=資訊公開>\n 資訊公開 </a>\n <ul class="equal-height-thumbnail cib-service-menu cib-public-info-menu sf-hidden">\n${publicInfoMenuHtml()}\n </ul>`;
  html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  fs.writeFileSync(indexPath, html, 'utf8');
}

function rewriteExistingHtmlFiles() {
  const dirs = [path.join(root, 'agency-introduction-pages'), path.join(root, 'announcements'), path.join(root, 'wanted'), path.join(root, 'forensics')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      const filePath = path.join(dir, file);
      fs.writeFileSync(filePath, rewritePublicInfoLinks(fs.readFileSync(filePath, 'utf8')), 'utf8');
    }
  }
}

fs.mkdirSync(outputDir, { recursive: true });
for (const [slug, title] of pages) {
  const sourceFile = findSourceFile(title);
  const html = rewritePublicInfoLinks(fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'));
  fs.writeFileSync(path.join(outputDir, slug), html, 'utf8');
  console.log(`${sourceFile} -> public-info/${slug}`);
}

rewriteHomePublicInfoMenu();
rewriteExistingHtmlFiles();
await import('./remove-ungrabbed-menu-items.mjs?publicInfo=' + Date.now());
await import('./rewrite-local-home-links.mjs?publicInfo=' + Date.now());
console.log('public-info links rewritten');