import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { extname, join } from 'path';

const sourceDir = join(process.cwd(), 'src', 'renderer');
const targetDir = join(process.cwd(), 'dist', 'renderer');
const extensions = new Set(['.html', '.css']);

mkdirSync(targetDir, { recursive: true });

for (const file of readdirSync(sourceDir)) {
  if (extensions.has(extname(file))) {
    copyFileSync(join(sourceDir, file), join(targetDir, file));
  }
}
