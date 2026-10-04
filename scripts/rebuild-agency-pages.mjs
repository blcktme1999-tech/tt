import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const agencyDir = path.join(root, 'agency-introduction-pages');

const pages = [
  ['index.html', '機關簡介', 'https://www.cib.npa.gov.tw/ch/app/folder/17'],
  ['director.html', '局長介紹', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1384&serno=f2a4b5d5-f9f6-4a62-9f20-6c4dfcebdaeb'],
  ['history.html', '本局沿革', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1386&serno=44c5d9ff-2b50-4c56-9ddb-dc858d6bd1d2'],
  ['organization-overview.html', '組織概況', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1387&serno=c8c098f4-1c6f-4d0b-9f1f-b07d0da4b57c'],
  ['organization-duties.html', '組織職掌', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1389&serno=49d63e23-3719-4e04-904e-bc5a6029dd2e'],
  ['unit-duties.html', '單位職掌', 'https://www.cib.npa.gov.tw/ch/app/folder/22'],
  ['police-heroes.html', '警英列傳', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1446&serno=501d9b9d-4ae2-4e95-aea0-bb0009770f9a'],
  ['former-directors.html', '歷任局長', 'https://www.cib.npa.gov.tw/ch/app/commissioner/list?module=commissioner&id=1882'],
  ['contact.html', '聯繫我們', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1447&serno=762b4585-1bea-41a0-ae0b-d8496ea480e5'],
  ['prevention-division.html', '預防科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1391&serno=bb0ea11b-7c81-4e43-a88e-4f1923a079c8'],
  ['investigation-division.html', '偵查科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1393&serno=bb9e0641-655d-4f7d-9fae-6a569dc50500'],
  ['anti-gang-division.html', '反黑科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1394&serno=2b6d672c-9dca-4190-8191-8e099f4348b0'],
  ['judicial-division.html', '司法科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=4509&serno=dd3792a7-92fe-4e33-b7e6-9001e7ed8fff'],
  ['forensic-chemistry-division.html', '理化科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1396&serno=e0c3146d-1049-4950-b4c3-a628cf648c7b'],
  ['fingerprint-division.html', '指紋科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1398&serno=e26d6a6a-34ba-443f-9fd3-b86bae0b3848'],
  ['biology-division.html', '生物科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1400&serno=bba8446a-3aba-41d9-8f31-0304158c038f'],
  ['records-division.html', '紀錄科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1402&serno=6f99ae46-dcfa-4e90-af62-38f637b0cfd0'],
  ['international-criminal-police-division.html', '國際刑警科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1425&serno=55a53ba8-10ba-4204-ab7c-78c540649bc1'],
  ['logistics-division.html', '後勤科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1427&serno=e315dda1-1b71-48ad-82d3-fae49202ff8e'],
  ['secretariat.html', '秘書室', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1429&serno=8a68727c-402b-4dd6-9a7f-1f4bd3596d93'],
  ['inspection-training-division.html', '督訓科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1431&serno=57fcfb6d-075d-402d-9ae0-df7f36654ed7'],
  ['technology-research-division.html', '科技研發科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1432&serno=7b7b86b0-99e7-4b01-8425-57fe61576852'],
  ['criminal-information-division.html', '刑事資訊科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1433&serno=f85e8e3d-2a2d-4daf-847a-42d6968d1fe7'],
  ['public-relations-office.html', '公共關係室', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1434&serno=689267b0-5a19-4275-87bd-c87cec6809ce'],
  ['crime-investigation-command-center.html', '偵防犯罪指揮中心', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1435&serno=fc1c6a62-0510-4685-b435-21cfb85c21f4'],
  ['communications-surveillance-division.html', '通訊監察科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1436&serno=3caa4bf3-dd99-4989-a5ec-f295f81ea01c'],
  ['personnel-office.html', '人事室', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1437&serno=7ea0bb75-37af-4509-b799-d1cb6524b5ba'],
  ['accounting-office.html', '主計室', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1438&serno=194da312-5241-434d-bf6c-b8a8ac47915e'],
  ['investigation-brigades.html', '偵查第一至第九大隊、電信偵查大隊及智慧財產權偵查大隊', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1439&serno=ec073054-69f8-4431-9f45-cc5c2e821ff1'],
  ['fraud-prevention-center.html', '詐欺犯罪防制中心', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1440&serno=36a8ae65-127b-4fb2-baa9-66590979a1c3'],
  ['cross-strait-division.html', '兩岸科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1441&serno=9ff97927-559d-46b0-922f-bfdfab540e00'],
  ['economic-crime-division.html', '經濟科', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1442&serno=7d1be4c9-c441-41f9-8be9-a2df215d3732'],
  ['ethics-office.html', '政風室', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1443&serno=9f569cab-35f6-4cb7-9e06-b463de7c8415'],
  ['narcotics-investigation-center.html', '毒品查緝中心', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=1444&serno=4c984091-205f-4dfe-8fdb-e63f6a9648f8'],
  ['cybercrime-prevention-center.html', '科技犯罪防制中心', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=18806&serno=1fcb5a0a-6735-49a4-aeff-b0ecc3248a5e'],
  ['forensic-science-center.html', '刑事鑑識中心', 'https://www.cib.npa.gov.tw/ch/app/artwebsite/view?module=artwebsite&id=18807&serno=ba78c570-0daf-49ca-b657-718f091b1be1'],
];

const localByUrl = new Map(
  pages.map(([slug, , url]) => [url, slug === 'index.html' ? '/agency/' : `/agency/${slug}`])
);

function replacementVariants(url) {
  const local = localByUrl.get(url);
  const parsed = new URL(url);
  const relative = parsed.pathname + parsed.search;
  return [url, url.replaceAll('&', '&amp;'), relative, relative.replaceAll('&', '&amp;')]
    .map((from) => [from, local]);
}

function rewriteAgencyLinks(html) {
  let output = html;
  for (const [, , url] of pages) {
    for (const [from, to] of replacementVariants(url)) {
      output = output.split(from).join(to);
    }
  }

  output = output.replace(
    /(href|src)="\/(?!agency\/|service\/|public\/|uploads\/|api\/)([^"#][^"]*)"/g,
    '$1="https://www.cib.npa.gov.tw/$2"'
  );
  output = output.replace(
    /(href|src)=\/(?!agency\/|service\/|public\/|uploads\/|api\/)([^\s>"#]+)/g,
    '$1=https://www.cib.npa.gov.tw/$2'
  );
  return output;
}

function agencyMenuHtml() {
  const mainPages = pages.slice(1, 9);
  const unitPages = pages.slice(9);

  return mainPages
    .map(([slug, title]) => {
      const item = ` <li><a href="/agency/${slug}" title="${title}">${title}</a>`;
      if (slug !== 'unit-duties.html') return `${item}</li>`;

      const children = unitPages
        .map(([childSlug, childTitle]) => ` <li><a href="/agency/${childSlug}" title="${childTitle}">${childTitle}</a></li>`)
        .join('\n');
      return `${item}\n <ul>\n${children}\n </ul>\n </li>`;
    })
    .join('\n');
}

async function rebuildPages() {
  fs.mkdirSync(agencyDir, { recursive: true });

  for (const [slug, title, url] of pages) {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`${response.status} ${url}`);

    const html = rewriteAgencyLinks(await response.text());
    fs.writeFileSync(path.join(agencyDir, slug), html, 'utf8');
    console.log(`${response.status} ${slug} ${title}`);
  }
}

function rewriteHomeMenu() {
  const indexPath = path.join(root, 'index.html');
  let html = rewriteAgencyLinks(fs.readFileSync(indexPath, 'utf8'));
  const start = html.indexOf('<a href=/agency/ title=機關簡介>');
  const replacement = `<a href=/agency/ title=機關簡介>\n 機關簡介 </a>\n <ul class="equal-height-thumbnail cib-service-menu cib-agency-menu sf-hidden">\n${agencyMenuHtml()}\n </ul>`;

  if (start < 0) {
    throw new Error('Could not find agency menu block in index.html');
  }

  const end = html.indexOf('\n </li>\n <li class=menu-dropdown-icon>', start);
  if (end < 0) {
    throw new Error('Could not find agency menu block boundary in index.html');
  }

  html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
  fs.writeFileSync(indexPath, html, 'utf8');
}

await rebuildPages();
rewriteHomeMenu();
await import('./rewrite-local-home-links.mjs?agency=' + Date.now());
