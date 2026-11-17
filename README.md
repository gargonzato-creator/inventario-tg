# Inventario TG

Web app (PWA) para que el personal haga **conteos de inventario a ciegas** y registre **usos internos**.
No escribe nada en Bims: los datos quedan en Firestore (proyecto TG Apps) para que el encargado de inventario los revise.

- Conteos: `inventario/{agro|carnes|itakua}/conteos/{conteoId}` + `items/{productoId}`
- Usos internos: `inventario/{agro|carnes|itakua}/usos_internos/{auto}` (estado `pendiente`)
- Catálogo: `catalogo.json` (sin cantidades de stock)
