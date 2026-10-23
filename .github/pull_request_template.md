<!--
Base: `develop`. A `main` sólo llegan los releases.
Título: estilo Conventional Commits, por ejemplo `fix(km): ...` o `feat(pending): ...`.
-->

Cierra #

## Qué cambia y por qué

<!-- El problema que ve el usuario (o el riesgo) y cómo lo resuelve este PR. -->

## Cambios

<!-- Un punto por cambio, con el archivo principal en `código`. -->

-

## Firestore

- [ ] **Sin cambios en Firestore**: no hay campos ni colecciones nuevas.
- [ ] **Hay campos o colecciones nuevas**: actualicé `firestore.rules` (la lista de campos permitidos) y hay que **publicar las reglas a mano** antes de mergear.

## Release

- [ ] No cambia la versión.
- [ ] Sube la versión a **x.y.z**: `package.json`, `package-lock.json` y `CHANGELOG.md`.
- [ ] Hay cambios que ve el usuario: agregué la versión en `lib/novedades.ts`, con la fecha real del release.

## Verificación

- [ ] `npm run typecheck` pasa.
- [ ] `npm test` pasa. Tests nuevos o cambiados: <!-- archivos, o "ninguno" -->
- [ ] Probé la UI en el navegador (celular y escritorio, si aplica).

**Para probar:**

1.

## Antes de mergear

- [ ] Sin comentarios en línea: sólo comentarios `/** */` y directivas de herramientas.
- [ ] Sin secretos ni archivos locales (`.env.local`, `service-account.json`).
- [ ] Pasos manuales pendientes (reglas, variables de entorno en Vercel, etc.): <!-- cuáles, o "ninguno" -->
