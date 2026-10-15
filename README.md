# JKAnime — plugin de Kino

Plugin de [Kino](https://kinotvapp.github.io/) para **jkanime.net** (y espejo jkanime.bz).

**Versión 1.1.0**

## Qué hace

- **search** — Usa el endpoint AJAX `/ajax/ajax_search/` y, si falla, la página `/buscar/`. Ranking por coincidencia exacta/prefijo.
- **home** — Filas: Últimos episodios, En emisión, Animes, Películas.
- **browse** — “Ver más” con paginación.
- **episodes** — Lista vía `/ajax/pagination_episodes/{id}/{pag}/` (como CloudStream).
- **resolve** — Extrae `var servers = [{ remote: base64 }]` y otros embeds; ofrece **alternativas** para elegir servidor a mano.

## Ajustes

| Ajuste | Descripción |
|--------|-------------|
| **Dominio** | `jkanime.net` o espejo `jkanime.bz` |
| **Servidor preferido** | Automático, StreamWish, VOE, MixDrop, etc. |

## Instalación

```
yumehotaru41-rgb/kino-plugin-jkanime
```

En Kino: **Ajustes → Plugins → Agregar**.

Añade el topic `kino-plugin` en el repositorio de GitHub.

## Cloudflare

El sitio usa Cloudflare. El plugin declara `"browser": "pages"` para abrir páginas en el navegador oculto cuando el fetch normal recibe el challenge. En el dispositivo real suele funcionar mejor que desde un servidor.

Si no carga nada:

1. Cambia el **Dominio** a `jkanime.bz` en Configurar.
2. Actualiza el plugin (sube esta versión 1.1.0 al repo).
3. Reinstala o fuerza actualización en Kino.

## Archivos

```
kino-plugin.json
plugin.js
icon.png
README.md
```
