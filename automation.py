#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
automation.py
=============
Automatización de fechas/eventos de Manu Pavez a partir de una hoja de
cálculo de Google Sheets expuesta como Web App de Google Apps Script.

Dos responsabilidades:
  1. SoundCloud: publica las filas marcadas como "PENDIENTE" en la columna
     'Estado_SoundCloud'.
  2. eventos.json: genera un archivo JSON limpio con los eventos FUTUROS para
     que el sitio (manupavez.com) los consuma con fetch() y renderice las
     fechas dinámicamente.

ARQUITECTURA (simplificada):
  Ya NO usamos gspread ni una Service Account (google_credentials.json).
  En su lugar, la planilla se publica como Web App (ver apps_script/Codigo.gs)
  y este script la lee con un simple requests.get() a WEB_APP_URL.

  Esto significa que la lectura es de SOLO LECTURA: ya no podemos escribir
  "PROCESADO" de vuelta en la planilla. Ver nota en procesar_soundcloud().

NOTA: Songkick fue descartado (API cerrada). No se hace ninguna llamada a Songkick.

Uso:
    pip install -r requirements.txt
    python automation.py          → SoundCloud + genera eventos.json (flujo completo)
    python automation.py json     → SOLO genera eventos.json
    python automation.py test     → SOLO prueba la conexión con la Web App
"""

import os
import sys
import json
from datetime import datetime, date

import requests
from dotenv import load_dotenv


# ============================================================
#  CONFIGURACIÓN GLOBAL
# ============================================================

# Archivo de salida que consumirá el frontend.
OUTPUT_JSON = "eventos.json"

# Nombres EXACTOS de las columnas en la planilla (cabecera de la fila 1).
# Deben coincidir con las cabeceras reales de tu hoja (son case-sensitive).
COL_ID = "ID"
COL_FECHA = "FECHA"
COL_LUGAR = "LUGAR"
COL_CIUDAD = "CIUDAD"
COL_LINK_TICKETS = "Link_Tickets"
COL_ESTADO_SOUNDCLOUD = "Estado_Soundcloud"

# Valores de estado usados en las celdas.
ESTADO_PENDIENTE = "PENDIENTE"
ESTADO_PROCESADO = "PROCESADO"

# Endpoint de SoundCloud (revisá la doc oficial para el formato definitivo).
SOUNDCLOUD_API_URL = "https://api.soundcloud.com/tracks"

# Formatos de fecha aceptados al leer la columna 'Fecha'.
FORMATOS_FECHA = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%y"]


# ============================================================
#  CARGA DE ENTORNO
# ============================================================

def cargar_entorno():
    """Carga el .env y devuelve un diccionario con las variables necesarias.

    Corta la ejecución si falta alguna variable obligatoria.
    """
    load_dotenv()  # Lee el archivo .env del directorio actual.

    config = {
        "web_app_url": os.getenv("WEB_APP_URL"),
        "web_app_api_key": os.getenv("WEB_APP_API_KEY"),
        "soundcloud_client_id": os.getenv("SOUNDCLOUD_CLIENT_ID"),
        "soundcloud_oauth_token": os.getenv("SOUNDCLOUD_OAUTH_TOKEN"),
    }

    # Validación mínima: sin la URL de la Web App no podemos leer la planilla.
    if not config["web_app_url"]:
        sys.exit("❌ Falta WEB_APP_URL en el archivo .env. "
                 "Pegá ahí la URL de tu Web App de Apps Script. Abortando.")

    return config


# ============================================================
#  LECTURA DE LA PLANILLA (vía Web App / JSON)
# ============================================================

def obtener_filas(config):
    """Lee la planilla desde la Web App de Apps Script.

    Hace un GET a WEB_APP_URL y espera un JSON: una lista de objetos donde
    cada objeto es una fila con clave = nombre de columna (igual que lo que
    devolvía gspread.get_all_records()).

    Returns:
        list[dict] | None: las filas, o None si la petición/parseo falla.
    """
    try:
        respuesta = requests.get(config["web_app_url"], timeout=30)
        respuesta.raise_for_status()
        filas = respuesta.json()

        if not isinstance(filas, list):
            print("❌ La Web App no devolvió una lista de filas. "
                  f"Recibido: {type(filas).__name__}.")
            return None

        print(f"✅ Planilla leída desde la Web App: {len(filas)} fila(s).")
        return filas

    except requests.exceptions.RequestException as error:
        print(f"❌ Error al leer la Web App: {error}")
    except ValueError:
        # respuesta.json() falla si el cuerpo no es JSON válido.
        print("❌ La Web App no devolvió JSON válido. "
              "¿Publicaste la implementación correcta y con acceso público?")

    return None


# ============================================================
#  PUBLICACIÓN EN SOUNDCLOUD (MODULAR)
# ============================================================

def publicar_en_soundcloud(fila, config):
    """Envía una publicación a la API de SoundCloud.

    Args:
        fila (dict): datos de la fila (clave = nombre de columna).
        config (dict): variables de entorno cargadas.

    Returns:
        bool: True si la API respondió 200/201, False en caso contrario.
    """
    try:
        # SoundCloud usa OAuth: el token va en la cabecera Authorization.
        headers = {
            "Authorization": f"OAuth {config['soundcloud_oauth_token']}",
        }

        # Parámetros de ejemplo: adaptalos a los campos reales de tu planilla.
        payload = {
            "client_id": config["soundcloud_client_id"],
            "title": fila.get(COL_LUGAR, ""),
            "description": f"{fila.get(COL_CIUDAD, '')} — {fila.get(COL_FECHA, '')}",
        }

        respuesta = requests.post(
            SOUNDCLOUD_API_URL, headers=headers, data=payload, timeout=15
        )

        if respuesta.status_code in (200, 201):
            print(f"   🔊 SoundCloud OK ({respuesta.status_code}) → {payload['title']}")
            return True

        print(f"   ⚠️ SoundCloud respondió {respuesta.status_code}: {respuesta.text[:120]}")
        return False

    except requests.exceptions.RequestException as error:
        print(f"   ❌ Error de conexión con SoundCloud: {error}")
        return False


def marcar_como_procesado(fila, config):
    """Avisa a la Web App que una fila ya se publicó (write-back).

    Hace un POST a WEB_APP_URL con el ID de la fila y la API key de validación;
    el Apps Script (doPost) cambia Estado_Soundcloud a 'PROCESADO'.

    Args:
        fila (dict): datos de la fila (debe incluir la columna ID).
        config (dict): variables de entorno cargadas.

    Returns:
        bool: True si la planilla confirmó la actualización, False si no.
    """
    id_fila = str(fila.get(COL_ID, "")).strip()
    if not id_fila:
        print("   ⚠️ La fila no tiene ID; no se puede marcar como PROCESADO.")
        return False

    if not config.get("web_app_api_key"):
        print("   ⚠️ Falta WEB_APP_API_KEY en el .env; se omite el write-back.")
        return False

    try:
        respuesta = requests.post(
            config["web_app_url"],
            json={"apiKey": config["web_app_api_key"], "id": id_fila},
            timeout=30,
        )
        respuesta.raise_for_status()
        data = respuesta.json()

        if data.get("ok"):
            print(f"   📝 Fila ID {id_fila}: {COL_ESTADO_SOUNDCLOUD} → {ESTADO_PROCESADO}")
            return True

        print(f"   ⚠️ La Web App no marcó la fila ID {id_fila}: {data.get('error')}")
        return False

    except requests.exceptions.RequestException as error:
        print(f"   ❌ Error al marcar como PROCESADO (ID {id_fila}): {error}")
        return False
    except ValueError:
        print(f"   ❌ La Web App no devolvió JSON al marcar la fila ID {id_fila}.")
        return False


def procesar_soundcloud(filas, config):
    """Recorre las filas, publica en SoundCloud las PENDIENTE y marca PROCESADO.

    Tras una publicación exitosa, hace write-back a la planilla vía la Web App
    (doPost) para evitar reenvíos duplicados en futuras corridas.
    """
    if not filas:
        print("ℹ️ La planilla no tiene filas de datos. Nada que publicar.")
        return

    total = 0
    for indice, fila in enumerate(filas):
        # +2: índice 0 = primera fila de datos = fila 2 (la fila 1 son cabeceras).
        num_fila = indice + 2

        estado = str(fila.get(COL_ESTADO_SOUNDCLOUD, "")).strip().upper()
        if estado == ESTADO_PENDIENTE:
            print(f"▶️ Fila {num_fila}: publicando en SoundCloud...")
            if publicar_en_soundcloud(fila, config):
                marcar_como_procesado(fila, config)
                total += 1

    print(f"✅ SoundCloud: publicaciones procesadas: {total}.")


# ============================================================
#  GENERACIÓN DE eventos.json (PARA EL FRONTEND)
# ============================================================

def parsear_fecha(valor):
    """Intenta convertir el texto de la celda 'Fecha' en un date.

    Returns:
        date | None: la fecha parseada, o None si el formato no se reconoce.
    """
    valor = str(valor).strip()
    if not valor:
        return None
    for formato in FORMATOS_FECHA:
        try:
            return datetime.strptime(valor, formato).date()
        except ValueError:
            continue
    return None


def generar_eventos_json(filas):
    """Genera eventos.json con los eventos FUTUROS, ordenados por fecha.

    Estructura de cada evento:
        {"fecha": "...", "lugar": "...", "ciudad": "...", "tickets": "..." | null}

    - Filtra los eventos cuya fecha ya pasó (si la fecha se pudo interpretar).
    - Si 'Link_Tickets' está vacío, 'tickets' queda en null.
    - Las filas con fecha ilegible se incluyen igual (para no perder data) y se avisa.

    Returns:
        int: cantidad de eventos escritos en el archivo.
    """
    hoy = date.today()
    eventos = []

    for indice, fila in enumerate(filas):
        num_fila = indice + 2
        fecha_raw = str(fila.get(COL_FECHA, "")).strip()
        fecha_dt = parsear_fecha(fecha_raw)

        # Filtrar eventos pasados (solo si pudimos interpretar la fecha).
        if fecha_dt is not None and fecha_dt < hoy:
            continue
        if fecha_dt is None and fecha_raw:
            print(f"   ⚠️ Fila {num_fila}: fecha '{fecha_raw}' no reconocida; se incluye igual.")

        # Tickets: null si está vacío.
        tickets = str(fila.get(COL_LINK_TICKETS, "")).strip()

        eventos.append({
            "fecha": fecha_raw,
            "lugar": str(fila.get(COL_LUGAR, "")).strip(),
            "ciudad": str(fila.get(COL_CIUDAD, "")).strip(),
            "tickets": tickets if tickets else None,
            # Clave temporal solo para ordenar (se elimina antes de guardar).
            "_orden": fecha_dt or date.max,
        })

    # Ordenar por fecha ascendente (lo más próximo primero).
    eventos.sort(key=lambda e: e["_orden"])
    for evento in eventos:
        evento.pop("_orden", None)

    # Escribir el JSON (UTF-8, legible, con acentos reales).
    with open(OUTPUT_JSON, "w", encoding="utf-8") as archivo:
        json.dump(eventos, archivo, ensure_ascii=False, indent=2)

    print(f"✅ Generado '{OUTPUT_JSON}' con {len(eventos)} evento(s) futuro(s).")
    return len(eventos)


# ============================================================
#  PRUEBA DE CONEXIÓN
# ============================================================

def probar_conexion(config):
    """Prueba de conexión básica: lee la Web App e informa cuántas filas trajo."""
    print("🔌 Probando conexión con la Web App...\n")
    filas = obtener_filas(config)
    if filas is None:
        return False
    print(f"📑 Filas recibidas: {len(filas)}.")
    if filas:
        print(f"📋 Columnas detectadas: {', '.join(filas[0].keys())}")
    return True


# ============================================================
#  PUNTO DE ENTRADA
# ============================================================

def main():
    """Punto de entrada del script."""
    config = cargar_entorno()
    modo = sys.argv[1].lower() if len(sys.argv) > 1 else "full"

    # --- Modo prueba de conexión ---
    if modo == "test":
        sys.exit(0 if probar_conexion(config) else 1)

    # Para los demás modos necesitamos las filas de la planilla.
    filas = obtener_filas(config)
    if filas is None:
        sys.exit("❌ No se pudo leer la planilla. Revisá WEB_APP_URL y la publicación de la Web App.")

    # --- Modo: solo generar JSON ---
    if modo == "json":
        generar_eventos_json(filas)
        return

    # --- Modo completo: SoundCloud + JSON ---
    print("🚀 Iniciando automatización de fechas...\n")
    procesar_soundcloud(filas, config)
    print()
    generar_eventos_json(filas)


if __name__ == "__main__":
    main()
