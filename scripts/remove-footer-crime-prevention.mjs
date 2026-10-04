import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetDirs = ['agency-introduction-pages', 'announcements', 'wanted', 'forensics', 'public-info', 'public-services', 'sitemap', 'related-links'];
const targetFiles = ['index.html'];

function findMatchingUlEnd(html, start) {
  const tag = /<\/?ul\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tag.exec(html))) {
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return tag.lastIndex;
  }
  return -1;
}

function findMatchingLiEnd(html, start) {
  const tag = /<\/?li\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tag.exec(html))) {
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return tag.lastIndex;
  }
  return -1;
}

function removeTopCrimePrevention(html) {
  let output = html;
  let anchor = 0;
  const crimeLink = /<a\b[^>]*title=(?:"犯罪預防"|'犯罪預防'|犯罪預防(?:\s|>))[^>]*>/i;
  while (anchor < output.length) {
    const rest = output.slice(anchor);
    const match = rest.match(crimeLink);
    if (!match) break;
    const linkIndex = anchor + match.index;
    const start = output.lastIndexOf('<li', linkIndex);
    if (start < 0) {
      anchor = linkIndex + match[0].length;
      continue;
    }
    const startTagEnd = output.indexOf('>', start);
    const startTag = startTagEnd >= 0 ? output.slice(start, startTagEnd + 1) : '';
    if (/class=(?:"|')?title(?:"|')?/i.test(startTag)) {
      anchor = linkIndex + match[0].length;
      continue;
    }
    const end = findMatchingLiEnd(output, start);
    if (end < 0) {
      anchor = linkIndex + match[0].length;
      continue;
    }
    output = `${output.slice(0, start)}${output.slice(end)}`;
    anchor = start;
  }
  return output;
}

function removeFooterCrimePrevention(html) {
  let output = html;
  let anchor = 0;
  const titleLink = /<li class=(?:"|')?title(?:"|')?><a\b[^>]*>\s*犯罪預防\s*<\/a><\/li>/i;
  while (anchor < output.length) {
    const rest = output.slice(anchor);
    const match = rest.match(titleLink);
    if (!match) break;
    const titleIndex = anchor + match.index;
    const start = output.lastIndexOf('<ul', titleIndex);
    const end = start >= 0 ? findMatchingUlEnd(output, start) : -1;
    if (start < 0 || end < 0) {
      anchor = titleIndex + match[0].length;
      continue;
    }
    output = `${output.slice(0, start)}${output.slice(end)}`;
    anchor = start;
  }
  return output;
}

function rewriteFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const before = fs.readFileSync(filePath, 'utf8');
  const after = removeTopCrimePrevention(removeFooterCrimePrevention(before));
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

console.log(`removed footer crime-prevention blocks in ${rewritten} files`);