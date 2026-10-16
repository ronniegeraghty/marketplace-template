import { inventory, projectRoot } from './inventory.mjs';
import { readEvals, checkCoverage } from './coverage.mjs';

const { assets, localPlugins, remotePlugins } = await inventory();
const specs = await readEvals(projectRoot);
await checkCoverage(assets, specs);
console.log(`Validated ${localPlugins.length} local workflow plugins, ${assets.length} local assets, and ${specs.length} eval specs.`);
console.log(`Validated ${remotePlugins.length} remote GitHub references (metadata only; not fetched or executed).`);
for (const asset of assets) console.log(`  ${asset.id}`);
