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

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

CREDENTIALS_FILE = "google_credentials.json"
OUTPUT_JSON = "eventos.json"

# Nombres EXACTOS de las columnas en la planilla (cabecera de la fila 1).
COL_FECHA = "Fecha"
COL_LUGAR = "Lugar"
COL_CIUDAD = "Ciudad"
COL_LINK_TICKETS = "Link_Tickets"
COL_ESTADO_SOUNDCLOUD = "Estado_SoundCloud"

ESTADO_PENDIENTE = "PENDIENTE"
ESTADO_PROCESADO = "PROCESADO"

SOUNDCLOUD_API_URL = "https://api.soundcloud.com/tracks"

# Formatos aceptados al leer la columna 'Fecha'.
FORMATOS_FECHA = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%y"]


# ============================================================
#  ENTORNO Y AUTENTICACIÓN
# ============================================================

def cargar_entorno():
    """Carga el .env y devuelve un dict con las variables."""
    load_dotenv()
    config = {
        "spreadsheet_id": os.getenv("SPREADSHEET_ID"),
        "soundcloud_client_id": os.getenv("SOUNDCLOUD_CLIENT_ID"),
        "soundcloud_oauth_token": os.getenv("SOUNDCLOUD_OAUTH_TOKEN"),
        "worksheet_name": os.getenv("WORKSHEET_NAME"),
    }
    if not config["spreadsheet_id"]:
        sys.exit("❌ Falta SPREADSHEET_ID en el archivo .env. Abortando.")
    return config


def conectar_google_sheets(config):
    """Autentica con la Service Account y devuelve el worksheet (o None)."""
    try:
        credenciales = Credentials.from_service_account_file(
            CREDENTIALS_FILE, scopes=SCOPES
        )
        cliente = gspread.authorize(credenciales)
        planilla = cliente.open_by_key(config["spreadsheet_id"])
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
    except Exception as error:
        print(f"❌ Error al conectar con Google Sheets: {error}")
    return None


# ============================================================
#  PUBLICACIÓN EN SOUNDCLOUD
# ============================================================

def publicar_en_soundcloud(fila, config):
    """Envía una publicación a SoundCloud. True si la API respondió 200/201."""
    try:
        headers = {"Authorization": f"OAuth {config['soundcloud_oauth_token']}"}
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
    """Actualiza una celda a 'PROCESADO' para evitar reenvíos duplicados."""
    try:
        col_index = cabeceras.index(nombre_columna) + 1
        worksheet.update_cell(num_fila, col_index, ESTADO_PROCESADO)
        print(f"   📝 Fila {num_fila}: '{nombre_columna}' → {ESTADO_PROCESADO}")
    except ValueError:
        print(f"   ❌ La columna '{nombre_columna}' no existe en la planilla.")
    except Exception as error:
        print(f"   ❌ No se pudo actualizar la celda (fila {num_fila}): {error}")


def procesar_soundcloud(worksheet, config):
    """Recorre filas y publica en SoundCloud las que estén en PENDIENTE."""
    cabeceras = worksheet.row_values(1)
    filas = worksheet.get_all_records()
    if not filas:
        print("ℹ️ La planilla no tiene filas de datos. Nada que publicar.")
        return
    total = 0
    for indice, fila in enumerate(filas):
        num_fila = indice + 2  # fila 1 = cabeceras
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
    """Intenta convertir el texto de la celda 'Fecha' en un date. None si falla."""
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

    Estructura: {"fecha": "...", "lugar": "...", "ciudad": "...", "tickets": "..."|null}
    - Filtra eventos pasados (si la fecha se pudo interpretar).
    - Si 'Link_Tickets' está vacío → tickets: null.
    """
    filas = worksheet.get_all_records()
    hoy = date.today()
    eventos = []

    for indice, fila in enumerate(filas):
        num_fila = indice + 2
        fecha_raw = str(fila.get(COL_FECHA, "")).strip()
        fecha_dt = parsear_fecha(fecha_raw)

        if fecha_dt is not None and fecha_dt < hoy:
            continue
        if fecha_dt is None and fecha_raw:
            print(f"   ⚠️ Fila {num_fila}: fecha '{fecha_raw}' no reconocida; se incluye igual.")

        tickets = str(fila.get(COL_LINK_TICKETS, "")).strip()

        eventos.append({
            "fecha": fecha_raw,
            "lugar": str(fila.get(COL_LUGAR, "")).strip(),
            "ciudad": str(fila.get(COL_CIUDAD, "")).strip(),
            "tickets": tickets if tickets else None,
            "_orden": fecha_dt or date.max,
        })

    eventos.sort(key=lambda e: e["_orden"])
    for evento in eventos:
        evento.pop("_orden", None)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as archivo:
        json.dump(eventos, archivo, ensure_ascii=False, indent=2)

    print(f"✅ Generado '{OUTPUT_JSON}' con {len(eventos)} evento(s) futuro(s).")
    return len(eventos)


# ============================================================
#  PRUEBA DE CONEXIÓN
# ============================================================

def probar_conexion(config):
    """Abre la planilla y lista las pestañas."""
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
    config = cargar_entorno()
    modo = sys.argv[1].lower() if len(sys.argv) > 1 else "full"

    if modo == "test":
        sys.exit(0 if probar_conexion(config) else 1)

    worksheet = conectar_google_sheets(config)
    if worksheet is None:
        sys.exit("❌ No se pudo conectar a la planilla. Revisá credenciales y permisos.")

    if modo == "json":
        generar_eventos_json(worksheet)
        return

    print("🚀 Iniciando automatización de fechas...\n")
    procesar_soundcloud(worksheet, config)
    print()
    generar_eventos_json(worksheet)


if __name__ == "__main__":
    main()
