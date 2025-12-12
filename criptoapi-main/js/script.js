// js/script.js
// Implementa: total exchanges, avg price, moneda más cara, top10 monedas, top10 exchanges,
// imprimir en tablas, buscador. Usa métodos funcionales (map/filter/reduce/sort/slice).

// Endpoints
const API_TICKERS = "https://api.coinlore.net/api/tickers/?start=0&limit=100";
const API_EXCHANGES = "https://api.coinlore.net/api/exchanges/?start=0&limit=100";
const API_GLOBAL = "https://api.coinlore.net/api/global/";

// DOM
const el = id => document.getElementById(id);
const totalExchEl = el("totalExchanges");
const avgPriceEl = el("avgPrice");
const mostExpEl = el("mostExpensive");
const lastUpdatedCoins = el("lastUpdatedCoins");
const lastUpdatedExchanges = el("lastUpdatedExchanges");
const btnReload = el("btnReload");
const searchInput = el("searchInput");
const coinsTableBody = el("coinsTable").querySelector("tbody");
const exchangesTableBody = el("exchangesTable").querySelector("tbody");
const chartCoinCanvas = el("chartCoin");
const chartExchangesCanvas = el("chartExchanges");

let coinsAll = [];      // datos completos de monedas
let exchangesAll = [];  // datos completos de exchanges
let chartCoins = null;
let chartExchs = null;

// Formatting helper
const fmtUSD = v => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
};

// timestamp helper
const nowStr = () => new Date().toLocaleString();

// Show/Hide spinner (we used none in DOM but kept hooks for expansion)
const show = el => el && el.classList && el.classList.remove("d-none");
const hide = el => el && el.classList && el.classList.add("d-none");

// Fetch helper
async function fetchJson(url){
  const res = await axios.get(url);
  return res.data;
}

// Carga datos principales
async function loadAllData(){
  try {
    btnReload.disabled = true;
    btnReload.textContent = "Cargando...";

    // peticiones en paralelo
    const [tickersResp, exchResp, globalResp] = await Promise.allSettled([
      fetchJson(API_TICKERS),
      fetchJson(API_EXCHANGES),
      fetchJson(API_GLOBAL)
    ]);

    // TICKERS
    if (tickersResp.status === "fulfilled" && tickersResp.value && tickersResp.value.data) {
      const raw = tickersResp.value.data;
      // limpiar y normalizar usando map
      coinsAll = raw.map(c => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        price_usd: parseFloat(c.price_usd),
        market_cap_usd: parseFloat(c.market_cap_usd || 0),
        percent_change_24h: parseFloat(c.percent_change_24h || 0)
      }));
    } else {
      coinsAll = [];
      console.error("Error cargando tickers:", tickersResp.reason || tickersResp);
    }

    // EXCHANGES
    if (exchResp.status === "fulfilled" && Array.isArray(exchResp.value)) {
      // CoinLore returns array for /exchanges
      exchangesAll = exchResp.value.map(e => ({
        name: e.name || e.exchange || "N/D",
        volume_usd: parseFloat(e.volume_usd || e.volume || 0),
        markets: parseInt(e.markets || e.markets_count || 0)
      }));
    } else {
      // si no devuelve array, fallback a vacío
      exchangesAll = [];
      console.warn("Exchanges no disponibles o formato distinto:", exchResp.reason || exchResp);
    }

    // GLOBAL (puede dar active_markets)
    let totalExchangesFromGlobal = null;
    if (globalResp.status === "fulfilled" && globalResp.value) {
      // CoinLore: globalResp may be object or array; try find active_markets
      const g = Array.isArray(globalResp.value) ? globalResp.value[0] : globalResp.value;
      totalExchangesFromGlobal = g && g.active_markets ? parseInt(g.active_markets) : null;
    }

    // ====== CÁLCULOS REQUERIDOS (USANDO PROGRAMACIÓN FUNCIONAL) ======

    // 1) Total casas de cambio -> preferimos length de exchangesAll, sino active_markets
    const totalExchanges = (Array.isArray(exchangesAll) && exchangesAll.length > 0)
      ? exchangesAll.length
      : (totalExchangesFromGlobal ?? "N/D");
    totalExchEl.textContent = totalExchanges;

    // 2) Precio medio de cambio: promedio de price_usd (sanea NaN con filter)
    const precios = coinsAll.map(c => c.price_usd).filter(p => !Number.isNaN(p));
    const sumaPrecios = precios.reduce((acc, p) => acc + p, 0);
    const avgPrice = precios.length ? (sumaPrecios / precios.length) : 0;
    avgPriceEl.textContent = fmtUSD(avgPrice);

    // 3) Moneda más cara (por price_usd) -> reduce para encontrar max
    const monedaMasCara = coinsAll.reduce((best, c) => {
      if (!best) return c;
      return (c.price_usd > best.price_usd) ? c : best;
    }, null);
    mostExpEl.textContent = monedaMasCara ? `${monedaMasCara.name} (${monedaMasCara.symbol}) — ${fmtUSD(monedaMasCara.price_usd)}` : "N/D";

    // 4) Graficar top 10 monedas por market cap (sort + slice)
    const top10Coins = coinsAll
      .filter(c => !Number.isNaN(c.market_cap_usd))
      .sort((a,b) => b.market_cap_usd - a.market_cap_usd)
      .slice(0, 10);
    drawCoinsChart(top10Coins);

    // 5) Graficar top 10 exchanges (por volume_usd)
    const top10Exchanges = exchangesAll
      .filter(e => !Number.isNaN(e.volume_usd))
      .sort((a,b) => b.volume_usd - a.volume_usd)
      .slice(0, 10);
    drawExchangesChart(top10Exchanges);

    // 6) Imprimir en tablas
    renderCoinsTable(coinsAll);
    renderExchangesTable(exchangesAll);

    // actualizar timestamps
    lastUpdatedCoins.textContent = nowStr();
    lastUpdatedExchanges.textContent = nowStr();

  } catch (err) {
    console.error("Error loadAllData:", err);
  } finally {
    btnReload.disabled = false;
    btnReload.textContent = "Recargar datos";
  }
}

// Dibujar gráfico de monedas (Chart.js)
function drawCoinsChart(list) {
  const labels = list.map(c => `${c.symbol}`);
  const data = list.map(c => c.market_cap_usd || 0);

  if (chartCoins) chartCoins.destroy();
  chartCoins = new Chart(chartCoinCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Market Cap (USD)',
        data,
        // no es estrictamente necesario definir colores, pero se usan para legibilidad
        backgroundColor: labels.map((_, i) => `rgba(54,162,235,${0.6 - (i*0.03)})`),
        borderColor: labels.map(_ => 'rgba(54,162,235,1)'),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        y: {
          ticks: {
            callback: v => (Number(v) >= 1 ? fmtUSD(v) : v)
          }
        }
      }
    }
  });
}

// Dibujar gráfico de exchanges
function drawExchangesChart(list) {
  const labels = list.map(e => e.name);
  const data = list.map(e => e.volume_usd || 0);

  if (chartExchs) chartExchs.destroy();
  chartExchs = new Chart(chartExchangesCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Volumen 24h (USD)',
        data,
        backgroundColor: labels.map((_, i) => `rgba(75,192,192,${0.6 - (i*0.03)})`),
        borderColor: labels.map(_ => 'rgba(75,192,192,1)'),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        y: {
          ticks: { callback: v => fmtUSD(v) }
        }
      }
    }
  });
}

// Render tabla de monedas (usa map para construir filas)
function renderCoinsTable(data) {
  if (!Array.isArray(data) || data.length === 0) {
    coinsTableBody.innerHTML = `<tr><td colspan="6">No hay datos de monedas</td></tr>`;
    return;
  }

  // Construir filas
  const rows = data.map((c, idx) => {
    return `<tr>
      <td>${idx+1}</td>
      <td>${c.name}</td>
      <td>${c.symbol}</td>
      <td>${fmtUSD(c.price_usd)}</td>
      <td>${c.market_cap_usd ? Number(c.market_cap_usd).toLocaleString() : '—'}</td>
      <td>${!Number.isNaN(c.percent_change_24h) ? c.percent_change_24h + '%' : '—'}</td>
    </tr>`;
  }).join("");
  coinsTableBody.innerHTML = rows;
}

// Render tabla exchanges
function renderExchangesTable(data) {
  if (!Array.isArray(data) || data.length === 0) {
    exchangesTableBody.innerHTML = `<tr><td colspan="4">No hay datos de exchanges</td></tr>`;
    return;
  }

  const rows = data.map((e, idx) => `<tr>
    <td>${idx+1}</td>
    <td>${e.name}</td>
    <td>${e.volume_usd ? Number(e.volume_usd).toLocaleString() : '—'}</td>
    <td>${e.markets ?? '—'}</td>
  </tr>`).join("");
  exchangesTableBody.innerHTML = rows;
}

// Buscador por tabla (nombre o símbolo) - usa filter
searchInput.addEventListener('input', (ev) => {
  const q = (ev.target.value || '').trim().toLowerCase();
  if (!q) {
    renderCoinsTable(coinsAll);
    return;
  }
  const filtered = coinsAll.filter(c =>
    (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q)
  );
  renderCoinsTable(filtered);
});

// Inicialización
btnReload.addEventListener('click', loadAllData);
document.addEventListener('DOMContentLoaded', loadAllData);
