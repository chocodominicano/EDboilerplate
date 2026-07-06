# 💠 Centro Financiero

Aplicación web de **finanzas personales para República Dominicana**: controla en qué gastas tu
dinero, tus fuentes de ingreso, tus tarjetas de crédito y todas tus deudas — 100% local y privada,
sin conexión a bancos.

## Características

- 📊 **Dashboard** con KPIs del mes (balance, ingresos, gastos) y **resumen de todas tus deudas**
  (tarjetas + préstamos, % de uso global, pago mínimo mensual total)
- 💰 **Ingresos** por fuente y cuenta, con quincenas (Q1/Q2) e ingresos fijos recurrentes
- 💸 **Gastos por categoría** con tags, moneda RD$/USD$, y 3 vistas: por mes, por ciclo de corte
  de tarjeta, y gastos fijos con estado pagado/pendiente/vencido
- 💳 **Tarjetas de crédito**: límites y saldos en RD$ y USD$, días de corte y pago, % de pago
  mínimo configurable, barra de uso (con alerta al superar el límite). Los pagos de tarjeta se
  registran como **transferencias** — nunca inflan tus gastos del mes
- 🏦 **Préstamos** con amortización francesa: cuota calculada automáticamente, separación
  interés/capital en cada pago
- 📅 **Presupuesto mensual por categoría** con barras de progreso
- 📡 **Radar financiero**: calendario del mes con todos tus compromisos (gastos fijos, ingresos
  esperados, pagos de tarjetas, cuotas de préstamos) — marca ingresos como recibidos con un clic
- 💱 Tasa USD/RD$ configurable manual o consultando al BCRD
- 🔐 Multiusuario con JWT + bcrypt; los datos de cada usuario están aislados

## Stack

| Componente | Tecnología |
|---|---|
| Backend | Node.js + Express |
| Base de datos | SQLite vía `better-sqlite3` (archivo `financiero.db`, auto-creado) |
| Autenticación | JWT + bcryptjs |
| Frontend | Vanilla HTML/CSS/JS con ES modules (sin build step) |

## Cómo correr

```bash
npm install
cp .env.example .env   # opcional: define JWT_SECRET y PORT
node server.js
# Abre http://localhost:3000
```

Usuarios por defecto:

| Usuario | Contraseña | Rol |
|---|---|---|
| `Admin` | `Admin` | admin |
| `demo` | `1234` | user |

## Estructura

```
server.js          API Express (puerto 3000)
db/                Esquema SQLite, conexión y seeds
lib/               Dominio: fechas RD, amortización, ciclos de corte, tasa BCRD
routes/            Endpoints REST (/api/...)
public/            Frontend SPA (index.html + css/ + js/)
financiero.db      Datos (gitignored — se crea al iniciar)
```

## Comandos útiles

```bash
# Ver usuarios en la DB
node -e "const db=require('better-sqlite3')('financiero.db'); console.table(db.prepare('SELECT id,username,role FROM users').all())"

# Recrear DB limpia
rm -f financiero.db* && node server.js

# Probar el login
curl -s localhost:3000/api/auth/login -X POST -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin"}'
```

## Principios de datos

- Toda transacción lleva `fechaSort` (`yyyy-mm-dd`) — el filtrado por mes/quincena/ciclo depende de él
- Los **pagos de tarjeta son transferencias**, no egresos: nunca suman al total de gastos
- Las quincenas son independientes: Q1 = días 1–15, Q2 = días 16–fin de mes
- Formato RD: `RD$1,200` sin decimales; fechas `DD/MM` en pantalla
