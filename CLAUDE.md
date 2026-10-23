@AGENTS.md

# Comentarios

Si no es documentación, no va. Se permiten solo:

- `/** */` justo encima de una declaración (función, componente, constante, tipo, interfaz o campo). Ahí va también cualquier restricción que no se ve en el código (un workaround, un límite de una plataforma, un código de error numérico).
- En `firestore.rules` y CSS: el comentario justo encima de una `function`, un `match` o un bloque, que lo describe.
- Directivas para herramientas: `eslint-disable…`, `@ts-expect-error`, `/// <reference …>`.

Nada de comentarios `//` o `/* */` adentro de funciones, componentes u objetos, al final de una línea, separadores de sección, `{/* */}` en JSX ni código comentado.

# Pull requests

- **PR template:** `.github/pull_request_template.md`. Cada descripción de PR sigue sus secciones, en el mismo orden. Las secciones que no aplican se dejan con su casilla "sin cambios" marcada; no se borran.
- **Default base branch:** `develop`. A `main` sólo llegan los releases.
- Con `gh pr create`, pasar la descripción completa con `--body-file`, armada sobre el template.
