import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, 'dist');
let html = readFileSync(join(source, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="style\.css([?][^"]*)?">/, () => `<style>\n${readFileSync(join(source, 'style.css'), 'utf8')}\n</style>`);
for (const file of ['physics.js', 'rules.js', 'feeder.js', 'collector.js', 'haptics.js', 'audio.js', 'app.js']) {
  const scriptTag = new RegExp(`<script src="${file.replace('.', '\\.')}([?][^"]*)?"></script>`);
  html = html.replace(scriptTag, () => `<script>\n${readFileSync(join(source, file), 'utf8')}\n</script>`);
}
writeFileSync(join(root, '好运弹珠社.html'), html, 'utf8');
console.log('Created standalone HTML: 好运弹珠社.html');
