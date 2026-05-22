# Runbook — rotar secrets del VPS (META_APP_SECRET y futuros)

Cómo cambiar un secret sensible (`META_APP_SECRET`, `ENCRYPTION_KEY`, etc.) sin
SSH manual al VPS, con histórico/rollback y sin que el value quede en logs.

## Flujo estándar (rotación)

```bash
# 1) Actualizar el valor del secret en GitHub Actions.
echo "NUEVO_VALOR_AQUI" | gh secret set META_APP_SECRET

# 2) Disparar el workflow ad-hoc que lo aplica al .env del VPS y reinicia
#    SOLO el contenedor afectado (sin tocar el resto del stack).
gh workflow run apply-secret.yml \
  -f var_name=META_APP_SECRET \
  -f restart_service=whatsapp

# 3) Verificar que el contenedor llegó a healthy.
gh run list --workflow=apply-secret.yml --limit 1
gh run watch $(gh run list --workflow=apply-secret.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

## Qué hace el workflow internamente

1. Lee el secret de GH Actions (encriptado en reposo, masked en logs).
2. SSH al VPS usando `DEPLOY_KEY` (ya configurada).
3. Hace **backup defensivo** del `.env` actual → `.env.bak.YYYYMMDDTHHMMSSZ`.
4. Reemplaza/añade la línea correspondiente en `.env`.
5. `docker compose up -d --no-deps <servicio>` — recoge el nuevo `.env`.
6. Espera healthcheck del contenedor; si no llega a healthy en ~30s, sale con
   error y deja el log del contenedor en el output del job.

## Servicios soportados

El workflow acepta como `restart_service`: `whatsapp`, `api`, `worker`,
`dashboard`. Cada uno mapea a su contenedor:

| Servicio | Contenedor |
|---|---|
| whatsapp | `whatsapp-saas-whatsapp` (lee `META_APP_SECRET`) |
| api | `whatsapp-saas-api` |
| worker | `whatsapp-saas-worker` |
| dashboard | `jestsolution-dashboard` (lee `ENCRYPTION_KEY`, `AUTH_SECRET`) |

## Añadir un secret nuevo al flujo

Por seguridad, los `var_name` aceptados están declarados en una `choice` del
input del workflow (`.github/workflows/apply-secret.yml`). Esto evita que
alguien con permiso de disparar workflows exfiltre cualquier secret arbitrario
del repo. Para añadir uno nuevo:

1. `gh secret set MI_NUEVO_SECRET` con el valor.
2. Editar `apply-secret.yml` → añadir `MI_NUEVO_SECRET` a las `options` del
   input `var_name`.
3. Si requiere otro contenedor, añadirlo a las `options` de `restart_service`
   y al `case` de mapeo nombre→contenedor.
4. Commit + push.

## Rollback rápido del `.env`

Si después de aplicar un secret algo se rompe y el rollback automático del
healthcheck no fue suficiente, los `.env.bak.*` quedan en el VPS:

```bash
# En el VPS:
cd $DEPLOY_PATH
ls -lt .env.bak.* | head -5            # ver los últimos backups
cp .env.bak.20260522T194201Z .env      # restaurar uno concreto
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml \
  --profile dashboard up -d --no-deps whatsapp
```

## Limpieza periódica de backups

Los `.env.bak.*` se acumulan. Limpieza recomendada cada N semanas:

```bash
# Conservar los 10 más recientes, borrar el resto.
ls -t $DEPLOY_PATH/.env.bak.* | tail -n +11 | xargs -r rm
```

## Reglas duras

- **NUNCA** poner el value en un commit, comentario, issue, mensaje de Slack o
  archivo del repo. GH Actions lo enmascara en su log; cualquier otro lugar lo
  expone en texto plano.
- **NUNCA** regenerar `ENCRYPTION_KEY` si la DB tiene tenants con tokens
  cifrados — los tokens Meta serían irrecuperables (ver
  `~/.claude/.../memory/project_encryption_key_critical.md`).
- Si sospechás que un secret quedó comprometido (lo viste en un screenshot,
  en un transcript público, etc.):
  1. Rotalo en su panel de origen (Meta Developer → Settings → Reset App Secret).
  2. Ejecutá el flujo de rotación de arriba con el valor nuevo.
  3. Borrá el secret viejo del repo si fue committeado por error
     (`git filter-repo` o crear repo nuevo).
