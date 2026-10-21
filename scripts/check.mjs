import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const file of await readdir('src')) {
  if(!file.endsWith('.js')) continue;
  const result=spawnSync(process.execPath,['--check',`src/${file}`],{stdio:'inherit'});
  if(result.status) process.exit(result.status);
}
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.name!=='sautilink-pilot' || config.d1_databases?.[0]?.binding!=='DB' || config.durable_objects?.bindings?.[0]?.name!=='GROUPS') throw new Error('Worker bindings are inconsistent.');
console.log('Worker JavaScript syntax and binding configuration verified.');
