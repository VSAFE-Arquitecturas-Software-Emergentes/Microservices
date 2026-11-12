# Railway y repositorios separados

Crear cinco servicios desde este repositorio con Root Directory / y el archivo /services/NOMBRE/railway.json correspondiente. Cada uno construye solo su backend y ejecuta sus propias migraciones. Solo el gateway necesita dominio público.

Provisionar PostgreSQL con PostGIS y cuatro bases privadas/roles, o cuatro instancias. Instalar PostGIS en cada base antes de migrar. DATABASE_URL debe ser exclusiva de cada microservicio; gateway no recibe esa variable. RabbitMQ necesita volumen persistente y red privada.

Configurar NODE_ENV=production, INTERNAL_SECRET aleatorio de al menos 32 caracteres y AMQP_URL. En gateway añadir SESSION_SECRET y FRONTEND_ORIGINS con el origen exacto de WebApp. Las variables ROUTE_PLANNING_URL, RISK_ASSESSMENT_URL, INCIDENT_REPORTING_URL y JOURNEY_ALERTS_URL deben apuntar a los dominios privados y puertos de Railway. PORT es configurable; el proceso escucha en IPv6.

Para demo: DATA_MODE=demo. Para datos reales: DATA_MODE=real, token Mapbox en Route Planning y modelo validado en Risk Assessment. Para blockchain remota: RPC, contrato y clave de una cuenta de prueba en Incident Reporting. Hardhat no es un servicio productivo persistente. No se suben claves ni se realizan transacciones con dinero real.

WebApp se publica desde [su repositorio](https://github.com/VSAFE-Arquitecturas-Software-Emergentes/WebApp) en Cloudflare Pages, raíz /, build npm run build y salida dist. Configurar API_ORIGIN para Pages Functions con el origen HTTPS del gateway y VITE_API_BASE_URL=/api/v1. El proxy conserva cookies y retransmite SSE sin caché. La landing se publica desde [su repositorio](https://github.com/VSAFE-Arquitecturas-Software-Emergentes/landing-page), raíz /, build npm run build, salida dist y VITE_APP_URL de WebApp.

Los repositorios están preparados para configurar estos servicios; esta publicación del código no despliega recursos en Railway ni Cloudflare. Railway usa contenedores internamente aunque el proyecto no requiere Docker local ni Dockerfiles.

[Documentación PostgreSQL Railway](https://docs.railway.com/databases/postgresql) · [Red privada](https://docs.railway.com/networking/private-networking)
