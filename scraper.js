const puppeteer = require('puppeteer');
const fs = require('fs');

const ARCHIVO_SALIDA = 'resultados.json';

// Convierte un bloque de texto (todo lo que aparece bajo "Tirada del Mediodía"
// o "Tirada de la Noche") en las listas fijo/corridos/parles/candado.
function parseTirada(text) {
  const lineas = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const resultado = { fijo: [], corridos: [], parles: [], candado: [] };
  let actual = null;
  for (const linea of lineas) {
    const mayus = linea.toUpperCase();
    if (mayus === 'FIJO') { actual = 'fijo'; continue; }
    if (mayus === 'CORRIDOS') { actual = 'corridos'; continue; }
    if (mayus === 'PARLES' || mayus === 'PARLÉS') { actual = 'parles'; continue; }
    if (mayus === 'CANDADO') { actual = 'candado'; continue; }
    if (!actual) continue;
    if (linea === '?') continue; // sin datos todavía
    if (/^\d+(-\d+)*$/.test(linea)) resultado[actual].push(linea);
  }
  return resultado;
}

function tieneDatos(tirada) {
  return !!tirada && (tirada.fijo.length > 0 || tirada.corridos.length > 0);
}

// Lee el resultados.json que ya existe en el repo (de la corrida anterior), si hay uno.
function leerResultadosPrevios() {
  try {
    const contenido = fs.readFileSync(ARCHIVO_SALIDA, 'utf8');
    return JSON.parse(contenido);
  } catch (e) {
    return null; // primera vez que corre, o archivo corrupto/inexistente
  }
}

(async () => {
  const previos = leerResultadosPrevios();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let textoCompleto = '';
  try {
    const page = await browser.newPage();
    await page.goto('https://www.labolitacubana.com/', { waitUntil: 'networkidle2', timeout: 60000 });

    // Intenta pulsar el botón "Actualizar" para forzar la carga de datos frescos.
    try {
      const boton = await page.evaluateHandle(() => {
        const el = [...document.querySelectorAll('*')].find(
          (n) => n.children.length === 0 && n.textContent.trim() === 'Actualizar'
        );
        return el || null;
      });
      if (boton && boton.asElement()) {
        await boton.asElement().click();
      }
    } catch (e) {
      console.log('No se pudo pulsar "Actualizar":', e.message);
    }

    // Espera hasta 15s a que desaparezca el placeholder de "sin datos".
    await page
      .waitForFunction(
        () => !document.body.innerText.includes('Información no disponible'),
        { timeout: 15000 }
      )
      .catch(() => console.log('Sigue sin haber datos (probablemente fuera de horario de tirada).'));

    await new Promise((r) => setTimeout(r, 2000));

    textoCompleto = await page.evaluate(() => document.body.innerText);
  } finally {
    await browser.close();
  }

  const idxMedio = textoCompleto.indexOf('Tirada del Mediodía');
  const idxNoche = textoCompleto.indexOf('Tirada de la Noche');
  const idxAdivinanza = textoCompleto.indexOf('ADIVINANZA');

  const bloqueMedio = idxMedio > -1 ? textoCompleto.slice(idxMedio, idxNoche > -1 ? idxNoche : undefined) : '';
  const bloqueNoche = idxNoche > -1 ? textoCompleto.slice(idxNoche, idxAdivinanza > -1 ? idxAdivinanza : undefined) : '';

  const nuevaMediodia = parseTirada(bloqueMedio);
  const nuevaNoche = parseTirada(bloqueNoche);
  const ahora = new Date().toISOString();

  // Si la tirada nueva SÍ trae datos, se guarda con la hora de ahora. Si NO trae datos (todavía
  // no ha salido, o la página falló), se conserva la que ya estaba guardada de antes (la última
  // tirada real que se logró leer), en vez de machacarla con listas vacías. Así el bot siempre
  // tiene algo que mostrar, y puede avisar si es "de hace rato" comparando el campo actualizado.
  const mediodiaFinal = tieneDatos(nuevaMediodia)
    ? { ...nuevaMediodia, actualizado: ahora }
    : previos?.mediodia || { ...nuevaMediodia, actualizado: null };

  const nocheFinal = tieneDatos(nuevaNoche)
    ? { ...nuevaNoche, actualizado: ahora }
    : previos?.noche || { ...nuevaNoche, actualizado: null };

  const datos = {
    ultimaEjecucion: ahora, // cuándo corrió el scraper por última vez (haya encontrado datos o no)
    mediodia: mediodiaFinal,
    noche: nocheFinal,
  };

  fs.writeFileSync(ARCHIVO_SALIDA, JSON.stringify(datos, null, 2));
  console.log(JSON.stringify(datos, null, 2));
})();
