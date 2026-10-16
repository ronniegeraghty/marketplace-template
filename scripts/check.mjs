import { inventory, projectRoot } from './inventory.mjs';
import { readEvals, checkCoverage } from './coverage.mjs';

const { catalog, assets } = await inventory();
const specs = await readEvals(projectRoot);
await checkCoverage(assets, specs);
console.log(`Validated ${catalog.plugins.length} workflow plugins, ${assets.length} assets, and ${specs.length} eval specs.`);
for (const asset of assets) console.log(`  ${asset.id}`);
