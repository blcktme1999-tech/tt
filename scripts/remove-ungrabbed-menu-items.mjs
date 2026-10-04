import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetDirs = ['agency-introduction-pages', 'announcements', 'wanted', 'forensics', 'public-info'];
const targetFiles = ['index.html'];
const skippedTitles = [
  '重要緊急查緝專案',
  '詐欺車手專區',
  '檢舉外逃通緝犯及跨國犯罪',
  '全國法規資料庫連結',
  '法源法律網',
  '移民署法規查詢',
  '訴願案件進度查詢',
  '採購案決標公告',
  '辦理政策宣導之廣告',
  '支付或接受之補助',
  '中長程個案計畫「112年至115年警察科技偵查躍升方案」',
  '影音專區',
  '性別主流化專區'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeSkippedListItems(html) {
  let output = html;
  for (const title of skippedTitles) {
    const escaped = escapeRegExp(title);
    output = output.replace(new RegExp(`\\n?\\s*<li[^>]*>\\s*<a\\b[^>]*>\\s*${escaped}\\s*</a>\\s*</li>`, 'g'), '');
    output = output.replace(new RegExp(`\\n?\\s*<li[^>]*>\\s*<a\\b[^>]*>\\s*${escaped}\\s*</a>\\s*\\n\\s*</li>`, 'g'), '');
  }
  return output
    .replaceAll('https://www.thcw.moj.gov.tw/wanted/criminal-wanted-platform.html', '/wanted/criminal-wanted-platform.html')
    .replaceAll('https://nservice.moj.gov.tw/wanted/criminal-wanted-platform.html', '/wanted/criminal-wanted-platform.html');
}

function rewriteFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const before = fs.readFileSync(filePath, 'utf8');
  const after = removeSkippedListItems(before);
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

console.log(`removed ungrabbed menu items in ${rewritten} files`);