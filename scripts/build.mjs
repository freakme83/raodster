import {cp,mkdir,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const file of ['index.html','icon.svg','src'])await cp(file,`dist/${file}`,{recursive:true});
console.log('AIRSHIFT built to dist/ — no runtime dependencies.');
