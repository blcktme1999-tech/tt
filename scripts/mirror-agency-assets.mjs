import fs from 'node:fs';
import path from 'node:path';

const origin = 'https://www.cib.npa.gov.tw';
const root = process.cwd();
const agencyDir = path.join(root, 'agency-introduction-pages');
const assetExtensions = new Set([
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.map'
]);
const mirroredPrefixes = ['/static/', '/assets/', '/js/', '/css/', '/images/', '/image/', '/upload/', '/uploads/'];

function isMirrorable(url) {
  if (url.origin !== origin) return false;
  if (mirroredPrefixes.some((prefix) => url.pathname.startsWith(prefix))) return true;
  return assetExtensions.has(path.extname(url.pathname).toLowerCase());
}

function localPathFor(url) {
  const safePath = url.pathname.split('/').map((part) => decodeURIComponent(part)).join('/');
  return path.join(agencyDir, safePath);
}

function localUrlFor(url) {
  return `/agency${url.pathname}${url.search || ''}`;
}

function collectUrlsFromText(text) {
  const urls = new Map();
  const absolutePattern = /https:\/\/www\.cib\.npa\.gov\.tw\/[^\"'\)\s>]+/g;
  const rootRelativePattern = /(?:href|src)=(["']?)(\/[^\s>"']+)\1/g;
  const cssUrlPattern = /url\((["']?)(\/[^\)"']+)\1\)/g;

  for (const match of text.matchAll(absolutePattern)) {
    try {
      const url = new URL(match[0].replaceAll('&amp;', '&'));
      if (isMirrorable(url)) urls.set(url.href, url);
    } catch {
      // Ignore malformed captures.
    }
  }

  for (const pattern of [rootRelativePattern, cssUrlPattern]) {
    for (const match of text.matchAll(pattern)) {
      try {
        const url = new URL(match[2].replaceAll('&amp;', '&'), origin);
        if (isMirrorable(url)) urls.set(url.href, url);
      } catch {
        // Ignore malformed captures.
      }
    }
  }

  return [...urls.values()];
}

function rewriteAssetUrls(text) {
  let output = text.replace(/https:\/\/www\.cib\.npa\.gov\.tw\/[^\"'\)\s>]+/g, (value) => {
    try {
      const url = new URL(value.replaceAll('&amp;', '&'));
      return isMirrorable(url) ? localUrlFor(url) : value;
    } catch {
      return value;
    }
  });

  for (const prefix of mirroredPrefixes) {
    output = output.replaceAll(`href="${prefix}`, `href="/agency${prefix}`);
    output = output.replaceAll(`src="${prefix}`, `src="/agency${prefix}`);
    output = output.replaceAll(`url(${prefix}`, `url(/agency${prefix}`);
    output = output.replaceAll(`url('${prefix}`, `url('/agency${prefix}`);
    output = output.replaceAll(`url("${prefix}`, `url("/agency${prefix}`);
  }

  return output;
}

async function downloadAsset(url) {
  const outputPath = localPathFor(url);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return fs.readFileSync(outputPath, 'utf8');

  const response = await fetch(url.href, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`${response.status} ${url.href}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  const ext = path.extname(url.pathname).toLowerCase();
  if (ext === '.css' || response.headers.get('content-type')?.includes('text/css')) {
    return buffer.toString('utf8');
  }
  return '';
}

const htmlFiles = fs.readdirSync(agencyDir)
  .filter((file) => file.endsWith('.html') && !file.startsWith('_'))
  .map((file) => path.join(agencyDir, file));

const queue = new Map();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  for (const url of collectUrlsFromText(html)) queue.set(url.href, url);
  fs.writeFileSync(file, rewriteAssetUrls(html), 'utf8');
}

let downloaded = 0;
for (const [href, url] of queue) {
  const css = await downloadAsset(url);
  downloaded += 1;
  if (css) {
    const cssUrls = collectUrlsFromText(css);
    let rewrittenCss = rewriteAssetUrls(css);
    for (const nestedUrl of cssUrls) {
      if (!queue.has(nestedUrl.href)) queue.set(nestedUrl.href, nestedUrl);
    }
    fs.writeFileSync(localPathFor(url), rewrittenCss, 'utf8');
  }
  if (downloaded % 50 === 0) console.log(`downloaded ${downloaded}/${queue.size}`);
}

console.log(`mirrored ${downloaded} assets`);
