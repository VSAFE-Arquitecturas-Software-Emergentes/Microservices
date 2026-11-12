# Contratos HTTP v1

URL local del gateway: `http://localhost:3100/api/v1`. Swagger: `http://localhost:3100/docs`. Cada backend expone su propia documentación en `/docs` y `/openapi.json`.

## Sesión

GET `/sessions` crea o recupera una sesión anónima y devuelve `csrfToken`, `ownerRef` y `demo`. La credencial JWT queda en cookie HttpOnly. El frontend envía esa cookie automáticamente. Toda escritura posterior incluye `x-csrf-token`. Los recursos se autorizan por propietario dentro del microservicio, además del control del gateway.

## Operaciones públicas

| Método y ruta                                     | Cuerpo / requisitos                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| POST `/routes/search`                             | `{origin:{lat,lng},destination:{lat,lng}}`. Área inicial habilitada de Lima, hasta tres alternativas.                     |
| POST `/journeys`                                  | `{alternativeId}` e `Idempotency-Key` de 8-100 caracteres. La alternativa pertenece a la sesión y vence a los 15 minutos. |
| GET `/journeys/{id}`                              | Estado del recorrido propio.                                                                                              |
| PATCH `/journeys/{id}/route`                      | `{expectedVersion,alternativeId}`. Conflicto si la versión cambió.                                                        |
| PATCH `/journeys/{id}/progress`                   | `{routeVersion,segmentIndex,fractionAlong,observedAt}`. Muestra actual, sin trayectoria histórica.                        |
| DELETE `/journeys/{id}`                           | Cierre idempotente; eliminación local inmediata de geometría y evento para otras proyecciones.                            |
| POST `/incident-reports`                          | `{category,location:{lat,lng},observedAt,description}` e Idempotency-Key.                                                 |
| GET `/incident-reports`                           | Hasta 100 reportes de la sesión.                                                                                          |
| GET `/incident-reports/{id}`                      | Estado, explicación y contenido del reporte propio.                                                                       |
| GET `/incident-reports/{id}/audit`                | Evidencias de versiones del incidente público: PENDING, VERIFIED, MISMATCH, NETWORK_RESET o UNAVAILABLE.                  |
| GET `/incidents?bbox=minLng,minLat,maxLng,maxLat` | Hasta 500 incidentes publicables vigentes, sin identidad del reportante. Bbox opcional.                                   |
| GET `/journeys/{id}/alerts/stream`                | SSE; cookie de sesión, Last-Event-ID opcional. Eventos `alert`, `suspended` y comentarios heartbeat.                      |
| POST `/journeys/{id}/alerts/{alertId}/ack`        | Acuse idempotente de visualización de una alerta propia.                                                                  |

Categorías: THEFT, ASSAULT, HARASSMENT y OBSTRUCTION. Fecha observedAt en ISO 8601 con zona horaria; se admiten observaciones dentro de 24 h que todavía estén vigentes para su categoría. Descripción opcional hasta 500 caracteres. Coordenadas de reporte aproximadas a cuatro decimales. La publicación solo confirma procesabilidad, no el hecho.

Una misma Idempotency-Key con contenido diferente produce 409 IDEMPOTENCY_CONFLICT. Un reporte equivalente por categoría, proximidad y momento se vincula como DUPLICATE y no genera un segundo incidente publicable.

## Contratos internos

- POST `/internal/v1/risk-assessments`: solo Route Planning. `{routes:[{id,geometry}]}`; devuelve evaluaciones por ID.
- GET `/internal/v1/journeys/{id}/active`: solo Journey Alerts. Devuelve versión, tramo restante, propietario, vigencia y fecha del progreso. Recorrido cerrado responde 410.
- GET `/internal/v1/incidents/snapshot`: solo Risk Assessment y Journey Alerts. Snapshot completo consistente con watermark. El MVP lo obtiene en una transacción repeatable read; no está paginado. Datasets grandes requieren medir memoria y tiempo de transferencia antes de ampliar el piloto.

Las llamadas internas utilizan x-vsafe-token, JWT HS256 de 60 segundos con audiencia, emisor, rol y sujeto. El navegador no genera esa identidad y el gateway sustituye cualquier identidad externa.

## Eventos y errores

IncidentPublished, IncidentExpired e IncidentWatermark se producen en Incident Reporting. JourneyStarted, JourneyRouteChanged y JourneyClosed se producen en Route Planning. Los sobres incluyen eventId, schemaVersion, aggregateId, aggregateVersion, occurredAt, correlationId, source y sequence.

Outbox se escribe con el cambio de negocio, publica con publisher confirms y se marca después. Inbox y efecto local se confirman juntos antes del ACK. Los fallos de consumo se reintentan con espera y terminan en la cola de errores del consumidor tras cuatro intentos. Los eventos de recorridos no llevan coordenadas.

Formato de error: `{code:string}` o VALIDATION_FAILED con `issues:[{path,message}]`. Códigos relevantes: OUTSIDE_COVERAGE, IDENTICAL_LOCATIONS, PROVIDER_UNAVAILABLE, MAPBOX_NOT_CONFIGURED, ROUTE_OPTION_EXPIRED, JOURNEY_NOT_FOUND, JOURNEY_NOT_ACTIVE, JOURNEY_VERSION_CONFLICT, INVALID_PROGRESS, CSRF_FAILED, SESSION_REQUIRED e IDEMPOTENCY_CONFLICT. Un fallo solo de Risk Assessment conserva la cartografía con nivel UNKNOWN y causa RISK_SERVICE_UNAVAILABLE.
