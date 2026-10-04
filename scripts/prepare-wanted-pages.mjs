import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '通緝專區');
const outputDir = path.join(root, 'wanted');

const localPages = [
  ['index.html', '通緝專區', 'https://www.cib.npa.gov.tw/ch/app/folder/33'],
  ['report-protection.html', '檢舉及保護措施', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1450&serno=e878fdc5-82f5-4751-99fa-729aee3cced1'],
  ['lost-items.html', '失物查尋專刊', 'https://www.cib.npa.gov.tw/ch/app/lose/list?module=lose&id=1891'],
  ['criminal-wanted-platform.html', '通緝犯資料查詢(公告)平台', 'https://nservice.moj.gov.tw/CriminalWanted/default.html']
];

const menuItems = [
  ['檢舉及保護措施', '/wanted/report-protection.html'],
  ['重要緊急查緝專案', 'https://www.cib.npa.gov.tw/ch/app/wanted/list?module=wanted&id=1889'],
  ['詐欺車手專區', 'https://www.cib.npa.gov.tw/ch/app/frauddriver/list?module=frauddriver&id=1890'],
  ['失物查尋專刊', '/wanted/lost-items.html'],
  ['檢舉外逃通緝犯及跨國犯罪', 'https://www.cib.npa.gov.tw/ch/app/globalcase/list?module=globalcase&id=1892'],
  ['通緝犯資料查詢(公告)平臺', '/wanted/criminal-wanted-platform.html']
];

const localByUrl = new Map(localPages.map(([slug, , url]) => [url, slug === 'index.html' ? '/wanted/' : `/wanted/${slug}`]));
localByUrl.set('https://www.thcw.moj.gov.tw/CriminalWanted/default.html', '/wanted/criminal-wanted-platform.html');

function replacementVariants(url) {
  const local = localByUrl.get(url);
  const parsed = new URL(url);
  const relative = parsed.pathname + parsed.search;
  return [url, url.replaceAll('&', '&amp;'), relative, relative.replaceAll('&', '&amp;')]
    .map((from) => [from, local]);
}

function rewriteWantedLinks(html) {
  let output = html;
  for (const url of localByUrl.keys()) {
    for (const [from, to] of replacementVariants(url)) output = output.split(from).join(to);
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
  throw new Error(`Cannot find wanted page: ${title}`);
}

function wantedMenuHtml() {
  return menuItems
    .map(([title, href]) => ` <li><a href="${href.replaceAll('&', '&amp;')}" title="${title}">${title}</a></li>`)
    .join('\n');
}

function rewriteHomeWantedMenu() {
  const indexPath = path.join(root, 'index.html');
  let html = rewriteWantedLinks(fs.readFileSync(indexPath, 'utf8'));
  const start = html.indexOf('<a href=/wanted/ title=通緝專區>');
  if (start < 0) throw new Error('Could not find wanted menu block in index.html');

  const nextMenuItem = html.indexOf('<li class=menu-dropdown-icon>', start + 1);
  if (nextMenuItem < 0) throw new Error('Could not find wanted menu block boundary in index.html');
  const end = html.lastIndexOf('</li>', nextMenuItem);
  if (end < start) throw new Error('Could not find wanted menu block closing tag in index.html');

  const replacement = `<a href=/wanted/ title=通緝專區>\n 通緝專區 </a>\n <ul class="equal-height-thumbnail cib-service-menu cib-wanted-menu sf-hidden">\n${wantedMenuHtml()}\n </ul>`;
  html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  fs.writeFileSync(indexPath, html, 'utf8');
}

function rewriteExistingHtmlFiles() {
  const dirs = [path.join(root, 'agency-introduction-pages'), path.join(root, 'announcements')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      const filePath = path.join(dir, file);
      fs.writeFileSync(filePath, rewriteWantedLinks(fs.readFileSync(filePath, 'utf8')), 'utf8');
    }
  }
}

fs.mkdirSync(outputDir, { recursive: true });

for (const [slug, title] of localPages) {
  const sourceFile = findSourceFile(title);
  const html = rewriteWantedLinks(fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'));
  fs.writeFileSync(path.join(outputDir, slug), html, 'utf8');
  console.log(`${sourceFile} -> wanted/${slug}`);
}

rewriteHomeWantedMenu();
rewriteExistingHtmlFiles();
console.log('wanted links rewritten');