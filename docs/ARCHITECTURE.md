# VSafe: decisiones de implementación

## Límites y dependencias

Cuatro bounded contexts: Route Planning, Risk Assessment, Incident Reporting y Journey Alerts. Cada servicio tiene Domain, Application, Infrastructure e Interfaces. Domain no importa frameworks; Application depende de puertos. Infrastructure implementa los puertos; main.ts es el composition root. API Gateway no accede a bases de negocio.

Frontend organizado por features: planning, journeys, reports, history y preferences; cada feature mantiene domain, application, infrastructure y presentation según su responsabilidad. La configuración de API vive en src/shared/infrastructure/http-client.ts del repositorio WebApp. Ningún componente consulta una base de datos.

packages/platform contiene exclusivamente mecanismos técnicos; packages/contracts solo contratos de transporte. No hay entidades de dominio compartidas. Cada servicio puede construirse y ejecutarse por separado con sus dependencias técnicas previamente compiladas.

## ADD y evidencias

| Atributo                   | Táctica                                                   | Verificación                                                                 |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| QA01: consultas p95 <= 4 s | Mapbox 2 s, riesgo 1 s, circuit breaker                   | Pruebas de latencia con proveedor disponible; no es un resultado garantizado |
| QA02: alertas p95 <= 15 s  | eventos, proyección espacial y SSE                        | Reporte cercano a recorrido activo, sin alertas duplicadas                   |
| QA03: fallos aislados      | timeout, UNKNOWN y outbox                                 | detener riesgo o broker; rutas o reportes conservan respuesta controlada     |
| QA04: incertidumbre        | cobertura, modelo versionado y abstención                 | ausencia de datos no implica LOW                                             |
| QA05: privacidad           | JWT de sesión anónima en cookie HttpOnly, CSRF, propiedad | acceso cruzado denegado y purga de geometría en 5 min                        |
| QA06: integridad           | transacciones, idempotencia, outbox/inbox                 | reenviar un reporte o evento produce un solo efecto                          |
| QA09: independencia        | procesos, migraciones y roles privados                    | construir un servicio sin reconstruir los demás                              |

## Persistencia

route_planning_db, risk_assessment_db, incident_reporting_db y journey_alerts_db tienen roles propietarios diferentes. No se permiten SQL, claves foráneas ni transacciones entre bases. Una instancia PostgreSQL local aislada en el puerto 55436 reduce recursos; en Railway pueden usarse cuatro instancias o cuatro bases lógicas con permisos separados. PostGIS es obligatorio para consultas métricas.

## Tecnologías emergentes

1. Machine Learning: modelo compacto ONNX, inferencia real con onnxruntime-node. El modelo incluido aprende de datos sintéticos y solo clasifica en DATA_MODE=demo; en modo real se abstiene hasta aportar un modelo validado y evidencia suficiente. No predice la probabilidad individual de sufrir un delito.
2. Blockchain: contrato Solidity que registra compromisos criptográficos de versiones de incidentes, mediante un adaptador asíncrono de Incident Reporting. Solo se envían hashes, nunca propietarios, descripciones ni coordenadas. No verifica la veracidad del incidente. Hardhat es una red local de desarrollo reiniciable; no constituye descentralización productiva. Su fallo no bloquea reportes.

## Entorno y despliegue

Sin Dockerfiles ni Docker Compose. Node.js y servicios nativos en desarrollo. Cloudflare Pages sirve landing y SPA; una Pages Function retransmite /api para conservar sesión de mismo origen y SSE. Railway ejecuta cada backend por separado y proporciona red privada. Railway usa contenedores internamente aunque este proyecto no exige operar Docker.

La vista de mapas utiliza Leaflet y teselas OpenStreetMap con atribución; las rutas reales se obtienen mediante el adaptador de Mapbox. El modo demo usa rutas sintéticas identificadas en todas las respuestas y en la interfaz. El simulador no constituye navegación real ni evaluación de seguridad real.

Los C4 y la corrección del informe quedan pendientes por instrucción del usuario.
