# Frequency Beat — cómo cargar samples, géneros y textos

Nada de esto es código: son archivos que la página lee al abrirse.
Después de cambiar algo, commit + push como siempre.

## 1. Samples (lo único que tenés que hacer)

Soltá los MP3 en la carpeta del género, con estos nombres exactos:

```
beat/samples/house/
beat/samples/tech-house/
beat/samples/progressive-house/
beat/samples/techno/

  kick.mp3  clap.mp3  hat.mp3  shaker.mp3  perc.mp3  bass.mp3  synth.mp3
```

- El bass y el synth, en C.
- Mientras falte un archivo, esa fila suena con un sonido sintetizado de reemplazo.
  Apenas subís el MP3, la web usa el tuyo. No hay que tocar nada más.
- Reemplazar un sample = pisar el archivo con el mismo nombre.
- El silencio que el MP3 agrega al principio se recorta solo (para que no suene corrido).
- One-shots cortos y normalizados. 128–192 kbps alcanza.

## 2. Ajustes por género — `beat/generos/<genero>.json`

- `bpm`: tempo con el que arranca ese género (el alumno después lo mueve).
- `volumen`: balance de cada fila, de 0 a 1 (si un sample suena muy fuerte, bajalo acá).
- `patron`: lo que carga el botón "VER EL PATRÓN". `x` = suena, `.` = silencio, 16 pasos.
- `sample`: nombre del archivo, si alguna vez querés usar otro.

## 3. Agregar un género

1. Copiá `beat/generos/techno.json` como `beat/generos/<nuevo>.json` y cambiá `nombre`, `bpm` y patrones.
2. Creá la carpeta `beat/samples/<nuevo>/` con sus MP3.
3. Sumá `"<nuevo>"` a la lista de `beat/generos.json` (ese orden es el del selector).

## 4. Textos — `beat/textos/`

Un archivo por fila (`kick.md`, `clap.md`, …):

```
---
corta: La línea que aparece al tocar un paso.
---
El texto completo que aparece al tocar el nombre de la fila.

Dejá una línea en blanco entre párrafos. *cursiva* y **negrita** funcionan.
```

- Texto distinto para un solo género: creá `beat/textos/<genero>/<fila>.md`
  (ej. `beat/textos/techno/hat.md`). Pisa al general solo en ese género.
- `_bienvenida.md`: la frase de la pantalla de inicio.
- Si un texto está vacío, la web simplemente no muestra nada para esa fila.
