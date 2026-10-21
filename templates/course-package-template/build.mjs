import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCoursePackage } from '../course-render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv[2] || path.join(__dirname, 'example.json');
const output = process.argv[3] || path.join(__dirname, 'out.html');
const doc = JSON.parse(fs.readFileSync(input, 'utf8'));
const html = renderCoursePackage({ title: doc.title, subtitle: doc.subtitle, date: doc.date }, doc);
fs.writeFileSync(output, html, 'utf8');
console.log('built', output, html.length + ' bytes');
