// Reemplaza el dominio y la marca provisionales en todo el sitio.
//   node tools/personalizar.mjs https://www.tuempresa.com "Nombre de marca" [SIGLA]
import fs from 'node:fs'; import path from 'node:path';
const [dominio, marca, sigla] = process.argv.slice(2);
if (!dominio || !marca) { console.log('Uso: node tools/personalizar.mjs https://www.tudominio.com "Tu Marca" [SIGLA]'); process.exit(1); }
const d = dominio.replace(/\/$/, ''), RAIZ = path.resolve(import.meta.dirname, '..', 'public');
let n = 0;
(function rec(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) rec(p);
    else if (/\.(html|xml|txt|webmanifest|svg|js)$/.test(f.name)) {
      let s = fs.readFileSync(p, 'utf8'); const o = s;
      s = s.replaceAll('https://www.example.com', d).replaceAll('TOPO Robotics', marca);
      if (sigla) s = s.replaceAll('>TOPO<', '>' + sigla + '<').replaceAll('"TOPO"', '"' + sigla + '"');
      if (s !== o) { fs.writeFileSync(p, s); n++; }
    }
  }
})(RAIZ);
console.log(`Listo: ${n} archivos actualizados. Revisa los textos legales y los nombres de producto.`);
