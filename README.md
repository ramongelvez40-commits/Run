# run — aplicación de recompensas

Proyecto nuevo desde cero para la aplicación **run**. Incluye una base de datos SQLite, registro por correo, panel de administración, cinco espacios de plataformas, saldo de monedas, solicitudes de canje, inventario de PINs y estructura para recibir confirmaciones de muros de ofertas.

## Lo que ya está preparado

- Registro e inicio de sesión.
- Usuario identificado por el mismo correo que se usa para la recompensa.
- Cinco plataformas configurables desde el panel.
- Enlace y nombre editable por plataforma.
- Monedas y registro de movimientos.
- Regla inicial: 1.000 monedas = 1 dólar; meta inicial 5.000 monedas.
- Panel con usuarios ordenados, monedas generadas, valor calculado, recompensas y saldo restante.
- Solicitud de PIN desde el perfil del usuario.
- Inventario de PINs en la base de datos.
- Envío por correo preparado con SMTP, sin exponer claves en el navegador.
- Endpoint protegido para recibir conversiones confirmadas de un muro de ofertas.

## Instalar y ejecutar

Requiere Node.js 18+ en el servidor:

```bash
npm install
npm start
```

La primera vez que abras la aplicación aparecerá un formulario de configuración con tres campos: correo de administrador, contraseña y confirmación de contraseña. Ese acceso se guarda en la base de datos y el formulario de primera configuración desaparece. Después entrarás normalmente con correo y contraseña.

Las variables `ADMIN_EMAIL` y `ADMIN_PASSWORD` del `.env` siguen disponibles como método alternativo de configuración inicial en un servidor, pero no es necesario usarlas si completas el formulario de primera entrada.

## Antes de producción

1. Cambia `SESSION_SECRET` y `ADMIN_PASSWORD`.
2. Configura un servidor HTTPS y copias de seguridad de `run.db`.
3. Configura SMTP para que el botón de envío mande correos reales.
4. Reemplaza el webhook de ejemplo por el callback oficial de cada muro de ofertas y valida su firma.
5. Carga solo PINs oficiales y transferibles, de la plataforma y región correcta.
6. Añade verificación de correo, límites antifraude, términos, privacidad y revisión de contracargos antes de abrirlo al público.

El valor que aparece en el panel es un cálculo interno basado en la regla configurada. El ingreso real debe conciliarse con las confirmaciones y pagos del muro de ofertas.
