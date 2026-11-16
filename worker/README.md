# Buscador 3D · servidor intermedio

Servidor pequeño (Cloudflare Worker, plan gratuito) que consulta las API
oficiales de **Thingiverse** y **Cults3D** con claves guardadas en secreto y
devuelve los resultados a la página `buscador-3d/`.

MakerWorld, Printables, Thangs y GrabCAD no tienen API pública: la página
ofrece un botón que abre la búsqueda en cada sitio.

## 1. Claves (a nombre de SOLVO)

- **Thingiverse:** iniciar sesión → https://www.thingiverse.com/apps/create
  → crear una *Web App* → copiar el **App Token**.
- **Cults3D:** iniciar sesión → configuración de la cuenta → sección **API**
  → generar la clave. Se usa el nombre de usuario + esa clave.

Las claves no se comparten por chat ni se suben al repositorio.

## 2. Publicar el Worker

Requiere Node.js y una cuenta gratuita de Cloudflare.

```bash
cd worker
npx wrangler login
npx wrangler secret put THINGIVERSE_TOKEN
npx wrangler secret put CULTS_USER
npx wrangler secret put CULTS_KEY
npx wrangler deploy
```

`wrangler deploy` muestra la dirección del Worker, por ejemplo
`https://buscador-3d-api.<tu-cuenta>.workers.dev`.

## 3. Conectar la página

En `buscador-3d/index.html`, completar:

```js
const API_URL = 'https://buscador-3d-api.<tu-cuenta>.workers.dev';
```

Si `API_URL` queda vacío, la página funciona en modo demostración.

## Prueba local

```bash
npx wrangler dev        # http://localhost:8787/search?source=thingiverse&q=gear
```
