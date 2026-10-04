import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, '便民服務');
const outputDir = path.join(root, 'public-services');

const pages = [
  ['index.html', '便民服務', 'https://www.cib.npa.gov.tw/ch/app/folder/66', '便民服務-'],
  ['chief-mailbox.html', '局長信箱', 'https://www.cib.npa.gov.tw/ch/app/folder/2058', '局長信箱-內政部'],
  ['chief-feedback.html', '反映意見', 'https://www.cib.npa.gov.tw/ch/mailbox/mailchief/mailchief?module=mailchief&id=7450', '局長信箱 (2026_10_4 下午4：39：34)'],
  ['chief-query.html', '案件查詢', 'https://www.cib.npa.gov.tw/ch/mailbox/mailchief/mailchiefquery?module=mailchief&id=7451', '局長信箱-案件查詢'],
  ['online-report-mailbox.html', '線上檢舉信箱', 'https://www.cib.npa.gov.tw/ch/app/folder/2065', '線上檢舉信箱-'],
  ['online-report-feedback.html', '反映意見', 'https://www.cib.npa.gov.tw/ch/mailbox/mailvio/mailviosns?module=mailvio&id=19154', '一般檢舉信箱(mail box) ('],
  ['online-report-query.html', '案件查詢', 'https://www.cib.npa.gov.tw/ch/mailbox/mailvio/mailvioquery?module=mailvio&id=7453', '一般檢舉信箱(mail box)-案件查詢'],
  ['amber-alert.html', '安珀警報-兒童綁架預警系統', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg137&id=2069', '安珀警報-兒童綁架預警系統'],
  ['applications.html', '申辦事項及電子表單', 'https://www.cib.npa.gov.tw/ch/app/folder/68', '申辦事項及電子表單'],
  ['application-inquiry.html', '申請與查詢', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg138&id=2075', '申請與查詢'],
  ['traffic.html', '交通類', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg138&id=2080', '交通類'],
  ['fraud-account.html', '疑涉詐欺境外金融帳戶查詢', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg138&id=18382', '疑涉詐欺境外金融帳戶查詢'],
  ['integrity.html', '廉政專區', 'https://www.cib.npa.gov.tw/ch/app/folder/73', '廉政專區'],
  ['integrity-news.html', '最新消息', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg140&id=2112', '最新消息-內政部警政署刑事警察局全球資訊網 (2026_10_4 下午4：48'],
  ['integrity-awareness.html', '廉政宣導', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg140&id=2115', '廉政宣導'],
  ['integrity-laws.html', '廉政法規', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg140&id=2117', '廉政法規'],
  ['conflict-disclosure.html', '公職人員利益衝突迴避身分揭露專區', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg140&id=18192', '公職人員利益衝突迴避身分揭露專區'],
  ['retired.html', '退休公務人員專區', 'https://www.cib.npa.gov.tw/ch/app/folder/74', '退休公務人員專區'],
  ['retired-news.html', '最新消息', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg141&id=2122', '最新消息-內政部警政署刑事警察局全球資訊網 (2026_10_4 下午4：50'],
  ['retired-laws.html', '法規宣導', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg141&id=2124', '法規宣導'],
  ['retired-forms.html', '表單下載', 'https://www.cib.npa.gov.tw/ch/app/data/list?module=wg141&id=2129', '表單下載']
];

const specialLocalByUrl = new Map([
  ['https://www.cib.npa.gov.tw/ch/app/data/list?module=wg138&id=2077', '/service'],
  ['https://www.cib.npa.gov.tw/ch/app/data/list?module=wg138&amp;id=2077', '/service'],
  ['/ch/app/data/list?module=wg138&id=2077', '/service'],
  ['/ch/app/data/list?module=wg138&amp;id=2077', '/service'],
  ['/public/service', '/service']
]);

const groups = [
  ['局長信箱', 'chief-mailbox.html', [['反映意見', 'chief-feedback.html'], ['案件查詢', 'chief-query.html']]],
  ['線上檢舉信箱', 'online-report-mailbox.html', [['反映意見', 'online-report-feedback.html'], ['案件查詢', 'online-report-query.html']]],
  ['安珀警報-兒童綁架預警系統', 'amber-alert.html', []],
  ['申辦事項及電子表單', 'applications.html', [['申請與查詢', 'application-inquiry.html'], ['報案及申訴', '/service'], ['交通類', 'traffic.html'], ['疑涉詐欺境外金融帳戶查詢', 'fraud-account.html']]],
  ['廉政專區', 'integrity.html', [['最新消息', 'integrity-news.html'], ['廉政宣導', 'integrity-awareness.html'], ['廉政法規', 'integrity-laws.html'], ['公職人員利益衝突迴避身分揭露專區', 'conflict-disclosure.html']]],
  ['退休公務人員專區', 'retired.html', [['最新消息', 'retired-news.html'], ['法規宣導', 'retired-laws.html'], ['表單下載', 'retired-forms.html']]]
];

const localByUrl = new Map(pages.map(([slug, , url]) => [url, slug === 'index.html' ? '/public-services/' : `/public-services/${slug}`]));

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

function rewritePublicServiceLinks(html) {
  let output = html;
  for (const url of localByUrl.keys()) {
    for (const [from, to] of replacementVariants(url)) output = replaceExactUrl(output, from, to);
  }
  for (const [from, to] of specialLocalByUrl) output = replaceExactUrl(output, from, to);
  return output;
}

function titleOf(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match?.[1] || '').trim();
}

function findSourceFile(title, url, fileHint) {
  const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.html'));
  const byHint = fileHint ? files.find((file) => file.startsWith(fileHint)) : null;
  if (byHint) return byHint;
  const matchingUrl = files.find((file) => fs.readFileSync(path.join(sourceDir, file), 'utf8').includes(url.replaceAll('&amp;', '&')));
  if (matchingUrl) return matchingUrl;
  const exact = files.find((file) => file.startsWith(`${title}-`) || file.startsWith(`${title} (`));
  if (exact) return exact;
  const byTitle = files.find((file) => titleOf(fs.readFileSync(path.join(sourceDir, file), 'utf8')).startsWith(title));
  if (byTitle) return byTitle;
  throw new Error(`Cannot find public-service page: ${title}`);
}

function publicServiceMenuHtml() {
  return groups.map(([title, slug, children]) => {
    const childHtml = children.length
      ? `\n <ul>\n${children.map(([childTitle, childSlug]) => {
        const href = childSlug.startsWith('/') ? childSlug : `/public-services/${childSlug}`;
        return ` <li><a href="${href}" title="${childTitle}">${childTitle}</a></li>`;
      }).join('\n')}\n </ul>`
      : '';
    return ` <li><a href="/public-services/${slug}" title="${title}">${title}</a>${childHtml}\n </li>`;
  }).join('\n');
}

function rewriteHomePublicServiceMenu() {
  const indexPath = path.join(root, 'index.html');
  let html = rewritePublicServiceLinks(fs.readFileSync(indexPath, 'utf8'));
  const start = html.indexOf('<a href=/public-services/ title=便民服務>');
  if (start < 0) throw new Error('Could not find public-services menu block in index.html');
  const nextMenuItem = html.indexOf('<li class=menu-dropdown-icon>', start + 1);
  if (nextMenuItem < 0) throw new Error('Could not find public-services menu block boundary in index.html');
  const end = html.lastIndexOf('</li>', nextMenuItem);
  if (end < start) throw new Error('Could not find public-services menu block closing tag in index.html');
  const replacement = `<a href=/public-services/ title=便民服務>\n 便民服務 </a>\n <ul class="equal-height-thumbnail cib-service-menu cib-public-services-menu sf-hidden">\n${publicServiceMenuHtml()}\n </ul>`;
  html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  fs.writeFileSync(indexPath, html, 'utf8');
}

function rewriteExistingHtmlFiles() {
  const dirs = [path.join(root, 'agency-introduction-pages'), path.join(root, 'announcements'), path.join(root, 'wanted'), path.join(root, 'forensics'), path.join(root, 'public-info')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      const filePath = path.join(dir, file);
      fs.writeFileSync(filePath, rewritePublicServiceLinks(fs.readFileSync(filePath, 'utf8')), 'utf8');
    }
  }
}

fs.mkdirSync(outputDir, { recursive: true });
for (const [slug, title, url, fileHint] of pages) {
  const sourceFile = findSourceFile(title, url, fileHint);
  const html = rewritePublicServiceLinks(fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'));
  fs.writeFileSync(path.join(outputDir, slug), html, 'utf8');
  console.log(`${sourceFile} -> public-services/${slug}`);
}

rewriteHomePublicServiceMenu();
rewriteExistingHtmlFiles();
await import('./remove-ungrabbed-menu-items.mjs?publicServices=' + Date.now());
await import('./rewrite-local-home-links.mjs?publicServices=' + Date.now());
console.log('public-services links rewritten');