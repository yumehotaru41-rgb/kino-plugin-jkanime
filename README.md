# JKAnime — plugin de Kino

Plugin de [Kino](https://kinotvapp.github.io/) para **jkanime.net**.

## Qué hace

- **search** — Búsqueda precisa: prioriza coincidencias exactas y por prefijo.
- **home** — Filas: En emisión, Animes recientes, Películas, Directorio.
- **browse** — “Ver más” de cada fila con paginación.
- **episodes** — Lista de episodios de un anime (o película como un solo episodio).
- **resolve** — Obtiene el stream y ofrece **selección manual de servidor** mediante alternativas.

## Ajustes (Configurar)

| Ajuste | Opciones |
|--------|----------|
| **Servidor preferido** | Automático · StreamWish · VOE · MixDrop · Mp4Upload · Filemoon · Streamtape |
| **Calidad preferida** | Automática · HD · SD |

Al reproducir, Kino muestra los otros servidores como alternativas para que elijas a mano.

## Instalación en Kino

1. Publica este repositorio en GitHub como **público**.
2. Añade el topic `kino-plugin` (About → Topics).
3. En Kino: **Ajustes → Plugins → Agregar** y escribe `tu-usuario/kino-plugin-jkanime`.

También puedes pegar la URL del `kino-plugin.json`.

## Archivos

```
kino-plugin.json   manifiesto
plugin.js          código
icon.png           ícono 128×128
README.md          este archivo
```

## Notas

- jkanime.net usa Cloudflare; en algunos aparatos `kino.fetch` puede fallar y entonces se usa el navegador oculto (`browser: true`) solo en `resolve`.
- Los hosts de los embeds (StreamWish, VOE, etc.) están declarados; si aparece un CDN nuevo, Kino preguntará permiso una vez o se usa `streamHosts: "any"`.
- Contenido en español. No requiere cuenta.

## Licencia

Código del plugin: uso libre para la comunidad de Kino.
El contenido pertenece a jkanime.net.
