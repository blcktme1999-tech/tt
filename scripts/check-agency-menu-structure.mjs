import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('<a href=/agency/ title=機關簡介>');
if (start < 0) throw new Error('Agency menu start not found');

const end = html.indexOf('<li class=menu-dropdown-icon>', start + 1);
const block = html.slice(start, end);
const unitStart = block.indexOf('/agency/unit-duties.html');
const unitEnd = block.indexOf('<li><a href="/agency/police-heroes.html"', unitStart);
const unitBlock = block.slice(unitStart, unitEnd);
const flatDivisionBeforeUnit = block.slice(0, unitStart).includes('/agency/prevention-division.html');
const expectedMainItems = [
	'/agency/director.html',
	'/agency/history.html',
	'/agency/organization-overview.html',
	'/agency/organization-duties.html',
	'/agency/unit-duties.html',
	'/agency/police-heroes.html',
	'/agency/former-directors.html',
	'/agency/contact.html'
];

const hasAgencyMenuClass = block.includes('cib-service-menu cib-agency-menu');
const hasAllMainItems = expectedMainItems.every((href) => block.includes(href));
console.log(`has agency menu class: ${hasAgencyMenuClass}`);
console.log(`has all main agency items: ${hasAllMainItems}`);
console.log(`unit duties has nested list: ${unitBlock.includes('<ul>')}`);
console.log(`division links nested under unit duties: ${unitBlock.includes('/agency/prevention-division.html')}`);
console.log(`division links before unit duties: ${flatDivisionBeforeUnit}`);

if (!hasAgencyMenuClass) throw new Error('Agency menu is missing nested menu styling class');
if (!hasAllMainItems) throw new Error('Agency menu is missing one or more main items');
if (!unitBlock.includes('<ul>')) throw new Error('Unit duties is missing a nested list');
if (!unitBlock.includes('/agency/prevention-division.html')) throw new Error('Division links are not nested under unit duties');
if (flatDivisionBeforeUnit) throw new Error('Division links are still present before unit duties');
