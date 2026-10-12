@echo off
title WhatsApp Blast Indonesia
echo ========================================================
echo         MEMULAI APLIKASI WHATSAPP BLAST INDONESIA
echo ========================================================
echo.
echo Membuka browser ke http://localhost:3000 ...
timeout /t 2 >nul
start http://localhost:3000
node server.js
pause
