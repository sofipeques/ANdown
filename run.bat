@echo off
setlocal enabledelayedexpansion
title YouTube Downloader
color 0B

REM ============================================================
REM  CONFIGURACIÓN
REM ============================================================
set "FFMPEG_URL=https://github.com/GyanD/codexffmpeg/releases/download/8.1/ffmpeg-8.1-essentials_build.zip"
set "VENV_PYTHON=venv\Scripts\python.exe"
set "VENV_ACTIVATE=venv\Scripts\activate.bat"

REM ============================================================
REM  1. VERIFICACION DEL PATH DE PYTHON
REM ============================================================
python --version >nul 2>&1 || (
    color 0C
    echo [ERROR] Python no encontrado en el PATH.
    pause & exit /b 1
)

REM ============================================================
REM  2. VENV  (solo se crea/reinstala si falta o está roto)
REM ============================================================
set "VENV_OK=0"
if exist "%VENV_PYTHON%" (
    "%VENV_PYTHON%" -c "import yt_dlp" >nul 2>&1 && set "VENV_OK=1"
)

if "!VENV_OK!"=="0" (
    echo [*] Preparando entorno virtual...
    if exist venv rmdir /s /q venv

    python -m venv venv || (echo [ERROR] No se pudo crear el venv. & pause & exit /b 1)

    echo [*] Instalando dependencias...
    "%VENV_PYTHON%" -m pip install --upgrade pip --quiet
    if exist requirements.txt (
        "%VENV_PYTHON%" -m pip install -r requirements.txt --quiet || (
            echo [ERROR] Fallo la instalacion de dependencias.
            pause & exit /b 1
        )
    ) else (
        echo [!] No se encontro requirements.txt
    )
    echo [OK] Entorno listo.
)

REM ============================================================
REM  3. FFMPEG  (solo descarga si falta alguno de los dos)
REM ============================================================
if not exist ffmpeg.exe goto :GET_FFMPEG
if not exist ffprobe.exe goto :GET_FFMPEG
goto :LAUNCH

:GET_FFMPEG
echo [*] Descargando FFmpeg...
curl -L --silent --show-error -o ffmpeg_temp.zip "%FFMPEG_URL%" || (
    echo [ERROR] Fallo la descarga de FFmpeg.
    pause & exit /b 1
)

powershell -NoProfile -Command "Expand-Archive -Path 'ffmpeg_temp.zip' -DestinationPath 'ffmpeg_tmp' -Force" || (
    echo [ERROR] Fallo la extraccion.
    del /q ffmpeg_temp.zip & pause & exit /b 1
)

for /r ffmpeg_tmp %%f in (ffmpeg.exe ffprobe.exe) do copy /y "%%f" "." >nul

del /f /q ffmpeg_temp.zip >nul 2>&1
rmdir /s /q ffmpeg_tmp  >nul 2>&1

if not exist ffmpeg.exe  ( echo [ERROR] ffmpeg.exe no encontrado.  & pause & exit /b 1 )
if not exist ffprobe.exe ( echo [ERROR] ffprobe.exe no encontrado. & pause & exit /b 1 )
echo [OK] FFmpeg listo.

REM ============================================================
REM  4. INICAR
REM ============================================================
:LAUNCH
echo.
echo  Sistema listo. Iniciando...
echo.
"%VENV_PYTHON%" app.py
if !errorlevel! neq 0 echo [ERROR] La aplicacion termino con errores.
pause