import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '公告訊息');
const outputDir = path.join(root, 'announcements');

const pages = [
  ['index.html', '公告訊息', 'https://www.cib.npa.gov.tw/ch/app/folder/27'],
  ['breaking-news.html', '破案快訊', 'https://www.cib.npa.gov.tw/ch/app/news/list?module=news&id=1885'],
  ['clarifications.html', '即時新聞澄清', 'https://www.cib.npa.gov.tw/ch/app/news/list?module=news&id=1886'],
  ['notices.html', '公告事項', 'https://www.cib.npa.gov.tw/ch/app/news/list?module=news&id=1887'],
  ['open-data-policy.html', '政府網站資料開放宣告', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1448&serno=4a4f6936-a1ab-45d2-afe5-c5018f726b10'],
  ['privacy-security-policy.html', '隱私權及網站安全政策', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1449&serno=869b22e6-b34d-4795-aca1-224cddd2f634'],
  ['faq.html', '常見問答', 'https://www.cib.npa.gov.tw/ch/app/faq/list?module=faq&id=18233'],
  ['bilingual.html', '雙語詞彙', 'https://www.cib.npa.gov.tw/ch/app/folder/18240']
];

const documents = [
  ['personal-data.pdf', '保有及管理個人資料', 'https://www.cib.npa.gov.tw/menuDoc/3121']
];

const localByUrl = new Map([
  ...pages.map(([slug, , url]) => [url, slug === 'index.html' ? '/announcements/' : `/announcements/${slug}`]),
  ...documents.map(([slug, , url]) => [url, `/announcements/${slug}`])
]);

function replacementVariants(url) {
  const local = localByUrl.get(url);
  const parsed = new URL(url);
  const relative = parsed.pathname + parsed.search;
  return [url, url.replaceAll('&', '&amp;'), relative, relative.replaceAll('&', '&amp;')]
    .map((from) => [from, local]);
}

function rewriteAnnouncementLinks(html) {
  let output = html;
  for (const url of localByUrl.keys()) {
    for (const [from, to] of replacementVariants(url)) {
      output = output.split(from).join(to);
    }
  }
  return output;
}

function titleOf(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match?.[1] || '').trim();
}

function findSourceFile(title) {
  const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.html'));
  const exact = files.find((file) => file.startsWith(`${title}-`));
  if (exact) return exact;
  const byTitle = files.find((file) => titleOf(fs.readFileSync(path.join(sourceDir, file), 'utf8')).startsWith(`${title}-`));
  if (byTitle) return byTitle;
  throw new Error(`Cannot find announcement page: ${title}`);
}

function announcementMenuHtml() {
  const htmlItems = pages.slice(1).map(([slug, title]) => ` <li><a href="/announcements/${slug}" title="${title}">${title}</a></li>`);
  const documentItems = documents.map(([slug, title]) => ` <li><a href="/announcements/${slug}" title="下載(pdf)">${title}</a></li>`);
  return [...htmlItems.slice(0, 5), ...documentItems, ...htmlItems.slice(5)].join('\n');
}

function rewriteHomeAnnouncementMenu() {
  const indexPath = path.join(root, 'index.html');
  let html = rewriteAnnouncementLinks(fs.readFileSync(indexPath, 'utf8'));
  const start = html.indexOf('<a href=/announcements/ title=公告訊息>');
  if (start < 0) throw new Error('Could not find announcement menu block in index.html');

  const nextMenuItem = html.indexOf('<li class=menu-dropdown-icon>', start + 1);
  if (nextMenuItem < 0) throw new Error('Could not find announcement menu block boundary in index.html');
  const end = html.lastIndexOf('</li>', nextMenuItem);
  if (end < start) throw new Error('Could not find announcement menu block closing tag in index.html');

  const replacement = `<a href=/announcements/ title=公告訊息>\n 公告訊息 </a>\n <ul class="equal-height-thumbnail cib-service-menu cib-news-menu sf-hidden">\n${announcementMenuHtml()}\n </ul>`;
  html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  fs.writeFileSync(indexPath, html, 'utf8');
}

function rewriteExistingHtmlFiles() {
  const dirs = [path.join(root, 'agency-introduction-pages')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      const filePath = path.join(dir, file);
      fs.writeFileSync(filePath, rewriteAnnouncementLinks(fs.readFileSync(filePath, 'utf8')), 'utf8');
    }
  }
}

fs.mkdirSync(outputDir, { recursive: true });

for (const [slug, title] of pages) {
  const sourceFile = findSourceFile(title);
  const html = rewriteAnnouncementLinks(fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'));
  fs.writeFileSync(path.join(outputDir, slug), html, 'utf8');
  console.log(`${sourceFile} -> announcements/${slug}`);
}

const pdfSource = path.join(sourceDir, '1542369585750085632.pdf');
if (!fs.existsSync(pdfSource)) throw new Error('Cannot find personal data PDF');
fs.copyFileSync(pdfSource, path.join(outputDir, 'personal-data.pdf'));
console.log('1542369585750085632.pdf -> announcements/personal-data.pdf');

rewriteHomeAnnouncementMenu();
rewriteExistingHtmlFiles();
console.log('announcement links rewritten');