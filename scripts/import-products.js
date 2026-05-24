/**
 * scripts/import-products.js — Importación masiva de productos desde CSV
 *
 * Uso:
 *   node scripts/import-products.js --slug=boutique-ana --file=productos.csv
 *   node scripts/import-products.js --slug=boutique-ana --file=productos.csv --replace
 *
 * --replace: borra todos los productos existentes del tenant antes de insertar.
 *            Sin este flag, los nuevos productos se agregan a los existentes.
 *
 * Formato del CSV (primera fila = encabezados, se ignora):
 *   nombre,descripcion,precio,tallas,imagen_url,emoji,categoria,atributos
 *
 * Columnas:
 *   nombre       (obligatorio) — nombre del producto
 *   descripcion  (opcional)    — descripción breve
 *   precio       (obligatorio) — número entero en COP, sin puntos ni signos
 *   tallas       (opcional)    — separadas por | dentro de la celda: S|M|L|XL
 *                                dejar vacío si no aplica (calzado sin talla, accesorios)
 *   imagen_url   (opcional)    — URL pública de la imagen
 *   emoji        (opcional)    — emoji representativo (default: 🛍️)
 *   categoria    (opcional)    — categoría del producto
 *   atributos    (opcional)    — JSON con atributos específicos del tipo de tienda
 *                                Ropa:    {"talla":"M","color":"azul"}
 *                                Zapatos: {"numero":42,"material":"cuero"}
 *                                Joyas:   {"metal":"oro 18k","piedra":"esmeralda"}
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import platformData from '../packages/platform-data/index.js';

dotenv.config();

// ── Parser CSV sin dependencias externas ─────────────────────────────────────
// Maneja campos entre comillas, comillas escapadas ("") y campos vacíos.
function parseCSVLine(line) {
  const fields = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { // comilla escapada: ""
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');

  if (lines.length < 2) throw new Error('El archivo CSV está vacío o solo tiene encabezados.');

  // Ignorar la primera fila (encabezados)
  return lines.slice(1).map((line, idx) => {
    const [nombre, descripcion, precio, tallas, imagen_url, emoji, categoria, atributos] =
      parseCSVLine(line);
    return { _row: idx + 2, nombre, descripcion, precio, tallas, imagen_url, emoji, categoria, atributos };
  });
}

// ── Validar y transformar una fila al formato de la DB ───────────────────────
function validateRow(row) {
  const errors = [];

  if (!row.nombre) errors.push('nombre vacío');

  const price = parseInt(row.precio, 10);
  if (!row.precio || isNaN(price) || price <= 0)
    errors.push(`precio inválido ("${row.precio}") — debe ser un entero positivo en COP`);

  if (errors.length > 0) return { ok: false, errors };

  // Tallas: separadas por | en la plantilla para no colisionar con la coma del CSV
  const sizes = row.tallas
    ? row.tallas.split('|').map((s) => s.trim()).filter(Boolean)
    : [];

  // Parsear columna atributos (JSON opcional)
  let attributes = {};
  if (row.atributos && row.atributos.trim()) {
    try {
      attributes = JSON.parse(row.atributos.trim());
    } catch {
      errors.push(`atributos no es JSON válido ("${row.atributos}") — usar formato {"clave":"valor"}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    product: {
      name:        row.nombre,
      description: row.descripcion || '',
      price,
      sizes,
      attributes,
      image_url:   row.imagen_url  || '',
      emoji:       row.emoji       || '🛍️',
      category:    row.categoria   || '',
    },
  };
}

// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--replace') { args.replace = true; continue; }
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    args[key] = rest.join('=');
  }
  return {
    slug:    args.slug    || process.env.SLUG,
    file:    args.file    || process.env.FILE,
    replace: Boolean(args.replace),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function localizeProductImages(slug, tenant, products) {
  const config = platformData.media.normalizeMediaStorageConfig(tenant.bot_config || tenant.botConfig || {});
  if (!config.enabled || !config.importProductsEnabled) return products;

  const adapter = platformData.media.createLocalVpsStorageAdapter();
  const maxBytes = config.maxImageUploadMb * 1024 * 1024;
  const localized = [];

  for (const product of products) {
    if (!product.image_url || !/^https?:\/\//i.test(product.image_url)) {
      localized.push(product);
      continue;
    }

    const res = await fetch(product.image_url);
    if (!res.ok) throw new Error(`No se pudo descargar imagen de ${product.name}`);
    const declaredSize = Number(res.headers.get('content-length') || 0);
    if (declaredSize > maxBytes) {
      throw new Error(`Imagen de ${product.name} supera el limite configurado`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Imagen de ${product.name} supera el limite configurado`);
    }

    const saved = await adapter.saveImage({ tenantSlug: slug, scope: 'products', buffer, config });
    localized.push({ ...product, image_url: saved.url });
  }

  return localized;
}

async function main() {
  const { slug, file, replace } = parseArgs();

  if (!slug || !file) {
    console.error('Uso: node scripts/import-products.js --slug=<slug> --file=<ruta.csv> [--replace]');
    process.exit(1);
  }

  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  if (!process.env.PLATFORM_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error('Falta PLATFORM_DATABASE_URL para resolver el tenant.');
  }

  try {
    // Verificar que el tenant existe
    const tenant = await platformData.tenantResolver.resolveTenantBySlug(slug);
    if (!tenant) {
      console.error(`❌ No existe ningún tenant con slug "${slug}"`);
      process.exit(1);
    }
    const { tenantId, name: tenantName } = tenant;
    console.log(`\n🏪 Tenant: ${tenantName} (${slug})`);

    // Parsear CSV
    const csvText = fs.readFileSync(filePath, 'utf-8');
    const rows    = parseCSV(csvText);
    console.log(`📄 Filas encontradas: ${rows.length}`);

    // Validar todas las filas antes de insertar cualquiera
    let valid   = [];
    const invalid = [];

    for (const row of rows) {
      const result = validateRow(row);
      if (result.ok) {
        valid.push(result.product);
      } else {
        invalid.push({ fila: row._row, errores: result.errors });
      }
    }

    if (invalid.length > 0) {
      console.error('\n⚠️  Filas con errores (no se insertará nada hasta corregirlas):');
      for (const { fila, errores } of invalid) {
        console.error(`   Fila ${fila}: ${errores.join(' | ')}`);
      }
      process.exit(1);
    }

    // Ejecutar en una transacción
    valid = await localizeProductImages(slug, tenant, valid);

    const pool = await platformData.tenantDb.getPoolForTenant(tenant);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (replace) {
        const { rowCount } = await client.query(
          'DELETE FROM products WHERE tenant_id = $1',
          [tenantId]
        );
        console.log(`🗑️  Eliminados ${rowCount} productos existentes (--replace)`);
      }

      // Bulk insert con un único query parametrizado
      let inserted = 0;
      for (const p of valid) {
        await client.query(
          `INSERT INTO products
             (tenant_id, name, description, price, sizes, attributes, image_url, emoji, category)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [tenantId, p.name, p.description, p.price, p.sizes, JSON.stringify(p.attributes), p.image_url, p.emoji, p.category]
        );
        inserted++;
      }

      await client.query('COMMIT');
      console.log(`\n✅ ${inserted} productos importados exitosamente para "${tenantName}"`);

      // Mostrar resumen
      const { rows: summary } = await client.query(
        'SELECT name, price, array_length(sizes,1) AS num_tallas FROM products WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5',
        [tenantId]
      );
      console.log('\nÚltimos productos insertados:');
      for (const p of summary) {
        const tallas = p.num_tallas ? `${p.num_tallas} tallas` : 'sin tallas';
        console.log(`   • ${p.name} — $${p.price.toLocaleString('es-CO')} COP (${tallas})`);
      }

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } finally {
    await platformData.connectionManager.closeTenantPools();
    await platformData.db.closePool();
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
