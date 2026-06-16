// Supabase Edge Function: extract-entregas-imagen
//
// Extrae la matriz Zona×Módulo de gastos del "Informe Diario de Jefes de Zona 2026"
// (formato físico de la SRL Unidad Conchos) usando Claude vision.
//
// Gemela de extract-aforo-imagen pero para la cuadrícula de gastos por módulo.
// La llave de Anthropic vive aquí (servidor), nunca en el cliente.
//
// Deploy:  supabase functions deploy extract-entregas-imagen
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Request body:  { image_base64: string, media_type: string }
// Response:      { data: EntregaInformeExtraido } | { error: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-opus-4-8";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// JSON Schema de salida — la foto puede traer UNO o DOS informes (días) apilados;
// se devuelve un array `informes`. El cliente espera EntregaInformeExtraido[]
// (ver EntregaImageCapture.tsx).
const INFORME_SCHEMA = {
  type: "object",
  properties: {
    fecha: {
      type: "string",
      description: "Fecha del encabezado en formato YYYY-MM-DD (ej. del texto 'Lunes 15 de Junio' → 2026-06-15). Si no se distingue, omitir.",
    },
    hora: {
      type: "string",
      description: "Hora del reporte en HH:MM (típicamente '12:00'). Omitir si no aparece.",
    },
    suma_total_m3s: {
      type: "number",
      description: "El valor de 'Suma Total' del bloque de gastos de ESTE informe, en m³/s. Sirve de verificación.",
    },
    celdas: {
      type: "array",
      description:
        "Una entrada por cada celda NO vacía de la matriz Zona×Módulo del bloque GASTOS / CANAL PRINCIPAL CONCHOS de ESTE informe. NO incluir celdas vacías ni los guiones '— —'.",
      items: {
        type: "object",
        properties: {
          modulo_label: {
            type: "string",
            description:
              "Etiqueta exacta de la columna del módulo: 'Mod.1', 'Mod.2', 'Mod.3', 'Mod.4', 'Mód.5' o 'Mod.12'.",
          },
          zona_numero: {
            type: "integer",
            description: "Número de la fila de Zona donde está la celda: 1, 2, 3 o 4.",
          },
          gasto_m3s: {
            type: "number",
            description:
              "Gasto principal de la celda en m³/s — el número grande/inferior (ej. 1.750, 2.880, 1.400). Ignora la anotación pequeña superior (sangrías/parciales).",
          },
          nota: {
            type: "string",
            description:
              "Anotación pequeña encima del gasto si existe (ej. '0.060', '0.150 0.060', '0.950'). Omitir si no hay.",
          },
        },
        required: ["modulo_label", "zona_numero", "gasto_m3s"],
      },
    },
  },
  required: ["celdas"],
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    informes: {
      type: "array",
      description:
        "Un elemento por cada informe presente en la imagen. Si la foto muestra DOS días apilados (dos bloques 'GASTOS / CANAL PRINCIPAL CONCHOS' con fechas distintas), devuelve DOS informes en orden de aparición (arriba primero). Si solo hay uno, devuelve un único elemento.",
      items: INFORME_SCHEMA,
    },
  },
  required: ["informes"],
};

const SYSTEM_PROMPT = `Eres un asistente que transcribe el "Informe Diario de Jefes de Zona 2026" de la SRL Unidad Conchos (Delicias).

El formato físico tiene en la parte superior un bloque titulado "GASTOS / CANAL PRINCIPAL CONCHOS": una matriz manuscrita donde las FILAS son ZONA 1, ZONA 2, ZONA 3, ZONA 4 y las COLUMNAS son Mod.1, Mod.2, Mod.3, Mod.4, Mód.5 y Mod.12. En cada celda donde se cruzan una zona y un módulo hay un gasto escrito a mano en m³/s (ej. 2.000, 1.840, 0.120, 2.880, 1.400).

REGLAS DE LECTURA:
- Los gastos están en m³/s con 3 decimales (ej. 1.750, 0.120, 2.880). El punto es separador decimal.
- Muchas celdas tienen DOS números: uno pequeño arriba (sangría/parcial, ej. "0.060", "0.150 0.060", "0.950") y el gasto principal abajo, más grande. El gasto que importa es el GRANDE de abajo → ponlo en gasto_m3s. El pequeño de arriba va en "nota" (texto tal cual).
- NO inventes celdas. Si una celda está vacía o tiene "— —" / "---" (sin lectura), NO la incluyas en el array.
- La fila ZONA forma una escalera diagonal: cada módulo aparece en la fila de la zona que sirve. Respeta exactamente en qué fila de zona está escrito cada número.
- Lee también "Suma Total" (el total del bloque de gastos, en m³/s).
- La fecha viene del encabezado manuscrito "Fecha: ..." — conviértela a YYYY-MM-DD asumiendo año 2026.

UNO O DOS INFORMES EN LA MISMA FOTO:
- Una foto puede contener UN solo informe, o DOS días apilados verticalmente (cada uno con su propio encabezado "Fecha: ...", su propia matriz GASTOS / CANAL PRINCIPAL CONCHOS y su propia "Suma Total").
- Devuelve un elemento en "informes" POR CADA informe presente, en orden de aparición (el de arriba primero).
- Si solo hay un informe, "informes" tiene un único elemento.
- NO mezcles celdas de un día con otro: cada informe lleva únicamente las celdas de su propia matriz.
- Distingue los informes por su encabezado de fecha; dos fechas distintas = dos informes.

Devuelve SOLO los datos estructurados según el esquema.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "ANTHROPIC_API_KEY no configurada en el servidor" }, 500);
    }

    const { image_base64, media_type } = await req.json();
    if (!image_base64) {
      return json({ error: "Falta image_base64 en el cuerpo de la petición" }, 400);
    }

    // Intenta con el modelo principal; si la cuenta no lo tiene habilitado
    // (400/404), reintenta con un modelo de respaldo.
    const modelos = [MODEL, "claude-sonnet-4-6"];
    let lastErr = "";
    for (const modelo of modelos) {
      // tool_use forzado: el JSON estructurado llega en tool_use.input.
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: [
            {
              name: "registrar_informes",
              description:
                "Registra los informes de gastos extraídos de la imagen del Informe Diario de Jefes de Zona.",
              input_schema: OUTPUT_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: "registrar_informes" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: media_type || "image/jpeg",
                    data: image_base64,
                  },
                },
                {
                  type: "text",
                  text: "Transcribe la(s) cuadrícula(s) de GASTOS de esta imagen llamando a registrar_informes.",
                },
              ],
            },
          ],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`Anthropic ${modelo} error:`, resp.status, errText);
        try { lastErr = JSON.parse(errText)?.error?.message || errText; } catch { lastErr = errText; }
        lastErr = `Anthropic ${resp.status} (${modelo}): ${lastErr}`;
        // 400/404 suele ser modelo/parámetro no válido → probar el siguiente modelo.
        if (resp.status === 400 || resp.status === 404) continue;
        return json({ error: lastErr }, 502);
      }

      const result = await resp.json();
      if (result.stop_reason === "refusal") {
        return json({ error: "El modelo no pudo procesar la imagen (refusal)" }, 422);
      }

      const toolBlock = (result.content ?? []).find(
        (b: { type: string }) => b.type === "tool_use",
      );
      if (!toolBlock?.input) {
        console.error("Sin tool_use en respuesta:", JSON.stringify(result).slice(0, 500));
        return json({ error: "El modelo no devolvió la cuadrícula estructurada" }, 502);
      }

      return json({ data: toolBlock.input });
    }

    return json({ error: lastErr || "Ningún modelo disponible" }, 502);
  } catch (err) {
    console.error("extract-entregas-imagen error:", err);
    return json({ error: (err as Error).message || "Error interno" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
