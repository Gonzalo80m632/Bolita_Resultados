const puppeteer = require('puppeteer');
const fs = require('fs');

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
    if (linea === '?') continue;
    if (/^\d+(-\d+)*$/.test(linea)) resultado[actual].push(linea);
  }
  return resultado;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.goto('https://www.labolitacubana.com/', { waitUntil: 'networkidle2', timeout: 60000 });

    try {
      const botones = await page.$x("//*[contains(text(), 'Actualizar')]");
      if (botones.length > 0) {
        await botones[0].click();
      }
    } catch (e) {
      console.log('No se pudo pulsar "Actualizar":', e.message);
    }

    await page
      .waitForFunction(
        () => !document.body.innerText.includes('Información no disponible'),
        { timeout: 15000 }
      )
      .catch(() => console.log('Sigue sin haber datos (probablemente fuera de horario de tirada).'));

    await new Promise((r) => setTimeout(r, 2000));

    const textoCompleto = await page.evaluate(() => document.body.innerText);

    const idxMedio = textoCompleto.indexOf('Tirada del Mediodía');
    const idxNoche = textoCompleto.indexOf('Tirada de la Noche');
    const idxAdivinanza = textoCompleto.indexOf('ADIVINANZA');

    const bloqueMedio = idxMedio > -1 ? textoCompleto.slice(idxMedio, idxNoche > -1 ? idxNoche : undefined) : '';
    const bloqueNoche = idxNoche > -1 ? textoCompleto.slice(idxNoche, idxAdivinanza > -1 ? idxAdivinanza : undefined) : '';

    const datos = {
      actualizado: new Date().toISOString(),
      mediodia: parseTirada(bloqueMedio),
      noche: parseTirada(bloqueNoche),
    };

    fs.writeFileSync('resultados.json', JSON.stringify(datos, null, 2));
    console.log(JSON.stringify(datos, null, 2));
  } finally {
    await browser.close();
  }
})();
