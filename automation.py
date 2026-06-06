#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
automation.py
=============
Automatización de fechas/eventos de Manu Pavez a partir de una hoja de
cálculo de Google Sheets.

Dos responsabilidades:
  1. SoundCloud: publica las filas marcadas como "PENDIENTE" en la columna
     'Estado_SoundCloud' y, si la API responde OK, las marca como "PROCESADO".
  2. eventos.json: genera un archivo JSON limpio con los eventos FUTUROS para
     que el sitio (manupavez.com) los consuma con fetch() y renderice las
     fechas dinámicamente.

NOTA: Songkick fue descartado (API cerrada). No se hace ninguna llamada a Songkick.

Uso:
    pip install -r requirements.txt
    python automation.py          → SoundCloud + genera eventos.json (flujo completo)
    python automation.py json     → SOLO genera eventos.json
    python automation.py test     → SOLO prueba la conexión con la planilla
"""

import os
import sys
import json
from datetime import datetime, date

import requests
import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv


# ============================================================
#  CONFIGURACIÓN GLOBAL
# ============================================================

# Permisos (scopes) que necesita la Service Account para leer/escribir la planilla.
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Ruta al archivo de credenciales de Google (Service Account).
CREDENTIALS_FILE = "google_credentials.json"

# Archivo de salida que consumirá el frontend.
OUTPUT_JSON = "eventos.json"

# Nombres EXACTOS de las columnas en la planilla (cabecera de la fila 1).
# Ajustá estos valores si tus columnas se llaman distinto.
COL_FECHA = "Fecha"
COL_LUGAR = "Lugar"
COL_CIUDAD = "Ciudad"
COL_LINK_TICKETS = "Link_Tickets"
COL_ESTADO_SOUNDCLOUD = "Estado_SoundCloud"

# Valores de estado usados en las celdas.
ESTADO_PENDIENTE = "PENDIENTE"
ESTADO_PROCESADO = "PROCESADO"

# Endpoint de SoundCloud (revisá la doc oficial para el formato definitivo).
SOUNDCLOUD_API_URL = "https://api.soundcloud.com/tracks"

# Formatos de fecha aceptados al leer la columna 'Fecha'.
FORMATOS_FECHA = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%y"]


# ============================================================
#  CARGA DE ENTORNO Y AUTENTICACIÓN
# ============================================================

def cargar_entorno():
    """Carga el .env y devuelve un diccionario con las variables necesarias.

    Corta la ejecución si falta alguna variable obligatoria.
    """
    load_dotenv()  # Lee el archivo .env del directorio actual.

    config = {
        "spreadsheet_id": os.getenv("SPREADSHEET_ID"),
        "soundcloud_client_id": os.getenv("SOUNDCLOUD_CLIENT_ID"),
        "soundcloud_oauth_token": os.getenv("SOUNDCLOUD_OAUTH_TOKEN"),
        "worksheet_name": os.getenv("WORKSHEET_NAME"),  # Opcional.
    }

    # Validación mínima: sin el ID de la planilla no podemos hacer nada.
    if not config["spreadsheet_id"]:
        sys.exit("❌ Falta SPREADSHEET_ID en el archivo .env. Abortando.")

    return config


def conectar_google_sheets(config):
    """Autentica con la Service Account y devuelve el objeto worksheet.

    Devuelve None si algo falla (archivo de credenciales faltante, sin permisos, etc.).
    """
    try:
        # 1) Construir credenciales a partir del JSON de la Service Account.
        credenciales = Credentials.from_service_account_file(
            CREDENTIALS_FILE, scopes=SCOPES
        )

        # 2) Autorizar el cliente de gspread.
        cliente = gspread.authorize(credenciales)

        # 3) Abrir la planilla por su ID.
        planilla = cliente.open_by_key(config["spreadsheet_id"])

        # 4) Elegir la pestaña: la indicada en WORKSHEET_NAME o la primera.
        if config["worksheet_name"]:
            worksheet = planilla.worksheet(config["worksheet_name"])
        else:
            worksheet = planilla.sheet1

        print(f"✅ Conexión establecida con la planilla: '{planilla.title}'")
        return worksheet

    except FileNotFoundError:
        print(f"❌ No se encontró el archivo de credenciales '{CREDENTIALS_FILE}'.")
    except gspread.exceptions.SpreadsheetNotFound:
        print("❌ SpreadsheetNotFound: la planilla no existe o la Service Account no "
              "tiene acceso. Verificá el SPREADSHEET_ID y que hayas compartido la hoja "
              "con el client_email del google_credentials.json.")
    except Exception as error:  # Captura cualquier otro fallo de conexión/auth.
        print(f"❌ Error al conectar con Google Sheets: {error}")

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


# ============================================================
#  ACTUALIZACIÓN DE LA PLANILLA
# ============================================================

def marcar_como_procesado(worksheet, num_fila, nombre_columna, cabeceras):
    """Actualiza una celda a 'PROCESADO' para evitar reenvíos duplicados.

    Args:
        worksheet: objeto worksheet de gspread.
        num_fila (int): número de fila en la planilla (1-indexado, con cabecera en la 1).
        nombre_columna (str): nombre de la columna a actualizar.
        cabeceras (list): lista de cabeceras para ubicar el índice de la columna.
    """
    try:
        # gspread usa columnas 1-indexadas; +1 porque la lista empieza en 0.
        col_index = cabeceras.index(nombre_columna) + 1
        worksheet.update_cell(num_fila, col_index, ESTADO_PROCESADO)
        print(f"   📝 Fila {num_fila}: '{nombre_columna}' → {ESTADO_PROCESADO}")
    except ValueError:
        print(f"   ❌ La columna '{nombre_columna}' no existe en la planilla.")
    except Exception as error:
        print(f"   ❌ No se pudo actualizar la celda (fila {num_fila}): {error}")


def procesar_soundcloud(worksheet, config):
    """Recorre las filas y publica en SoundCloud las que estén en PENDIENTE."""
    cabeceras = worksheet.row_values(1)
    filas = worksheet.get_all_records()

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
                marcar_como_procesado(worksheet, num_fila, COL_ESTADO_SOUNDCLOUD, cabeceras)
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


def generar_eventos_json(worksheet):
    """Genera eventos.json con los eventos FUTUROS, ordenados por fecha.

    Estructura de cada evento:
        {"fecha": "...", "lugar": "...", "ciudad": "...", "tickets": "..." | null}

    - Filtra los eventos cuya fecha ya pasó (si la fecha se pudo interpretar).
    - Si 'Link_Tickets' está vacío, 'tickets' queda en null.
    - Las filas con fecha ilegible se incluyen igual (para no perder data) y se avisa.

    Returns:
        int: cantidad de eventos escritos en el archivo.
    """
    filas = worksheet.get_all_records()
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
    """Prueba de conexión básica: abre la planilla y lista las pestañas."""
    print("🔌 Probando conexión con Google Sheets...\n")
    worksheet = conectar_google_sheets(config)
    if worksheet is None:
        return False
    planilla = worksheet.spreadsheet
    pestanas = [hoja.title for hoja in planilla.worksheets()]
    print(f"📑 Pestañas encontradas ({len(pestanas)}): {', '.join(pestanas)}")
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

    # Para los demás modos necesitamos la planilla.
    worksheet = conectar_google_sheets(config)
    if worksheet is None:
        sys.exit("❌ No se pudo conectar a la planilla. Revisá credenciales y permisos.")

    # --- Modo: solo generar JSON ---
    if modo == "json":
        generar_eventos_json(worksheet)
        return

    # --- Modo completo: SoundCloud + JSON ---
    print("🚀 Iniciando automatización de fechas...\n")
    procesar_soundcloud(worksheet, config)
    print()
    generar_eventos_json(worksheet)


if __name__ == "__main__":
    main()
