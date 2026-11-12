# VSafe Microservices

API Gateway y cuatro microservicios NestJS/TypeScript con DDD, Clean Architecture y decisiones ADD. Cada servicio tiene su base PostgreSQL/PostGIS y rol exclusivo. Sin Docker local.

Repositorios relacionados: [WebApp](https://github.com/VSAFE-Arquitecturas-Software-Emergentes/WebApp) y [landing-page](https://github.com/VSAFE-Arquitecturas-Software-Emergentes/landing-page).

## Desarrollo local

Node.js 24 y PostgreSQL 18 instalado. En Windows, setup prepara binarios portables de PostGIS, RabbitMQ y Erlang en .local, cuatro bases nuevas en PostgreSQL 55436 y una red Hardhat 8545. No utiliza PostgreSQL 5432 ni copia credenciales existentes. Si ya ejecutas otra copia local de VSafe en estos puertos, detén primero esa copia; no compartas sus carpetas .local entre checkouts.

```powershell
npm ci
npm run setup
npm run build
npm run db:seed
npm run dev
```

Gateway: http://localhost:3100/docs. Route Planning 3101, Risk Assessment 3102, Incident Reporting 3103 y Journey Alerts 3104. Los frontend se ejecutan desde sus propios repositorios en 5173 y 5174.

## Bases independientes

| Servicio           | Base privada          |
| ------------------ | --------------------- |
| Route Planning     | route_planning_db     |
| Risk Assessment    | risk_assessment_db    |
| Incident Reporting | incident_reporting_db |
| Journey Alerts     | journey_alerts_db     |

Los servicios no consultan tablas de otros contextos. Las llamadas internas usan identidad firmada; eventos por RabbitMQ con outbox/inbox, confirmaciones, reintentos y reconciliación. El gateway no tiene base de negocio.

## Tecnologías emergentes y alcance

IA/ML: inferencia real de un modelo ONNX entrenado con datos sintéticos, utilizable solo en demo. En modo real devuelve UNKNOWN hasta incorporar un modelo y evidencia validados. Blockchain: contrato Solidity para compromisos de versiones del incidente público, integrado asíncronamente. Verifica integridad del registro, no veracidad del hecho. Hardhat es una red local reiniciable.

DATA_MODE=demo identifica rutas e incidentes sintéticos. Para rutas reales configura DATA_MODE=real y MAPBOX_ACCESS_TOKEN. No se garantiza seguridad de recorridos. C4 e informe permanecen pendientes por instrucción del equipo.

## Verificación

```powershell
npm run build
npm run typecheck
npm test
# Con APIs y dependencias nativas ejecutándose:
npm run test:integration
npm run test:load
```

Pruebas backend: 15 de dominio/capas; integración local cubre CSRF, propietarios, idempotencia, PostgreSQL, RabbitMQ, ONNX, SSE y Solidity. Las pruebas no validan desempeño de Mapbox ni el piloto completo de 100000 incidentes.

Construcción independiente: `node scripts/build-service.mjs incident-reporting`. Migración independiente: `node scripts/migrate.mjs incident-reporting`. Arranque: `npm run start -w @vsafe/incident-reporting`.

[Contratos API](docs/API.md) · [Arquitectura](docs/ARCHITECTURE.md) · [Despliegue](docs/DEPLOYMENT.md). Nunca publiques .env, .local, claves ni datos de ejecución.
