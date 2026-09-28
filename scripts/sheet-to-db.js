// Turns the "Controle Terrários" spreadsheet into a Terrarium Manager database: the same data
// Configurações → Importar planilha adds to an empty app, as a file the app opens with
// Configurações → Restaurar um backup…
//
//   npm run sheet-db -- "C:\...\Controle Terrários.xlsx" [output.db]
//
// Without an output path, it's written to dist\, named after the spreadsheet.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// node:sqlite comes from Electron's Node, the same one the app uses.
if (!process.versions.electron) {
  const { status } = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(status ?? 1);
}

const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../src/db');
const { readXlsx } = require('../src/xlsx');
const { planImport, applyImport } = require('../src/import-sheet');

function main([sheet, out]) {
  if (!sheet) throw new Error('Usage: npm run sheet-db -- "<spreadsheet.xlsx>" [output.db]');
  const target = path.resolve(out ?? path.join(__dirname, '..', 'dist', `${path.parse(sheet).name}.db`));
  // Never overwrite: the path could be a real database.
  if (fs.existsSync(target)) throw new Error(`${target} already exists. Delete it or choose another name.`);

  const plan = planImport(readXlsx(sheet));

  // Written under a temporary name, so a failed run never leaves a file that looks finished.
  const partial = `${target}.partial`;
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(partial + suffix, { force: true });
  const store = new Store(partial);
  applyImport(store, plan);
  store.close();
  // The app works in WAL mode; the copy must be one self-contained file.
  const db = new DatabaseSync(partial);
  db.exec('PRAGMA journal_mode = DELETE');
  db.close();
  fs.renameSync(partial, target);

  const s = plan.summary;
  console.log(`Wrote ${target}`);
  console.log(`  ${s.lots} jar lots (${s.jarsBought} jars, ${s.jarsInStock} in stock), ${s.buyers} buyers`);
  console.log(`  ${s.terrariums} terrariums: ${s.available} available, ${s.personal} personal, `
    + `${s.sold} sold, ${s.donated} donated, ${s.lost} lost`);
  console.log(`  Revenue: R$ ${(s.revenueCents / 100).toFixed(2).replace('.', ',')}`);
  if (plan.warnings.length) {
    console.log('\nTo review in the app (what the spreadsheet left unclear):');
    for (const warning of plan.warnings) console.log(`- ${warning}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
