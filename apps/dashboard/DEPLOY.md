# Deploy — Dashboard

El dashboard forma parte del stack unificado `whatsapp-saas`.
**El deploy se hace desde la raíz del repo**, no desde este directorio.

```bash
cd /opt/jestsolution
docker compose -f docker-compose.yml -f infra/compose/docker-compose.prod.yml up -d --build
```

Ver guía completa en [`/DEPLOY.md`](../../DEPLOY.md).
