import fs from 'node:fs';
import path from 'node:path';

const agencyDir = path.join(process.cwd(), 'agency-introduction-pages');
const files = fs.readdirSync(agencyDir)
  .filter((file) => file.endsWith('.html') && !file.startsWith('_'))
  .map((file) => path.join(agencyDir, file));

const agencyTargets = [
  '/ch/app/folder/17',
  '/ch/app/folder/22',
  '/ch/app/commissioner/list?module=commissioner'
];
const agencyIds = [
  '1384', '1386', '1387', '1389', '1391', '1393', '1394', '4509', '1396', '1398',
  '1400', '1402', '1425', '1427', '1429', '1431', '1432', '1433', '1434', '1435',
  '1436', '1437', '1438', '1439', '1440', '1441', '1442', '1443', '1444', '1446',
  '1447', '18806', '18807'
];

const titleOf = (html) => {
  const start = html.indexOf('<title>');
  const end = html.indexOf('</title>');
  return start >= 0 && end > start ? html.slice(start + 7, end) : '';
};

const problems = [];
let officialAssetRefs = 0;
for (const file of ['index.html', ...files]) {
  const html = fs.readFileSync(file, 'utf8');
  for (const target of agencyTargets) {
    if (html.includes(target)) problems.push(`${file} still contains ${target}`);
  }
  for (const id of agencyIds) {
    if (html.includes(`id=${id}`) || html.includes(`id=${id.replace('&', '&amp;')}`)) {
      problems.push(`${file} still contains id=${id}`);
    }
  }
  officialAssetRefs += [...html.matchAll(/https:\/\/www\.cib\.npa\.gov\.tw\/(static|assets|js|css|images|image|upload|uploads|userfiles)\//g)].length;
}

console.log(`agency html files: ${files.length}`);
console.log(`agency index title: ${titleOf(fs.readFileSync(path.join(agencyDir, 'index.html'), 'utf8'))}`);
console.log(`director title: ${titleOf(fs.readFileSync(path.join(agencyDir, 'director.html'), 'utf8'))}`);
console.log(`official asset refs: ${officialAssetRefs}`);
console.log(problems.length ? problems.join('\n') : 'no agency official links remain');
