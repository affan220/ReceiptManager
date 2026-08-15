const fs = require('fs');
const migrationPath = process.argv[2];
const migrationName = process.argv[3];
const outputPath = process.argv[4] || '/home/ubuntu/receipt-manager-git/.ledger-migration-input.json';
if (!migrationPath || !migrationName) {
  throw new Error('Usage: node build-ledger-migration-input.cjs <migration-path> <migration-name> [output-path]');
}
const query = fs.readFileSync(migrationPath, 'utf8');
fs.writeFileSync(outputPath, JSON.stringify({
  project_id: 'hfhitzyfgzvtfpckazcv',
  name: migrationName,
  query,
}));
console.log(outputPath);
