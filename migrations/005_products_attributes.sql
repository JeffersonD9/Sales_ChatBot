-- Migration 005: Catálogo genérico — atributos variables por tipo de tienda
--
-- Agrega attributes JSONB para soportar cualquier categoría de producto:
--   Ropa:    {"talla": "M",  "color": "azul"}
--   Zapatos: {"numero": 42,  "material": "cuero"}
--   Joyas:   {"metal": "oro 18k", "piedra": "esmeralda", "peso_gramos": 3.2}
--
-- sizes TEXT[] se conserva para backward compat con datos existentes.
-- A largo plazo se puede deprecar cuando todos los tenants migren a attributes.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}';

-- Índice GIN para búsquedas eficientes dentro del JSONB
CREATE INDEX IF NOT EXISTS idx_products_attributes ON products USING GIN (attributes);

-- Migrar datos existentes: copiar sizes al nuevo campo para tenants de ropa
-- Solo actualiza filas que tienen sizes pero attributes vacío
UPDATE products
SET attributes = jsonb_build_object('tallas', sizes)
WHERE array_length(sizes, 1) > 0
  AND attributes = '{}';
