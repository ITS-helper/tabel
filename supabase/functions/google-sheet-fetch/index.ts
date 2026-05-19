/**
 * Прокси CSV из Google Таблицы (обход CORS для GitHub Pages).
 * Таблица должна быть доступна по ссылке: «все, у кого есть ссылка» → просмотр.
 */
const SHEET_ID = "1h-GMxdT2z3MC-somIq8sX3iV6KfjaoCffIIfeBQezRk";
const SHEET_GID = "1225208192";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "WorkWatchGoogleSheetFetch/1.0",
      },
    });
    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: "sheet_fetch_failed",
          status: upstream.status,
          hint:
            "Проверьте доступ к таблице (ссылка «все с доступом») и что gid листа верный.",
        }),
        {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }
    const csv = await upstream.text();
    if (!csv.trim() || csv.trimStart().startsWith("<!DOCTYPE")) {
      return new Response(
        JSON.stringify({
          error: "sheet_not_csv",
          hint: "Вместо CSV пришла HTML-страница — таблица не опубликована или нет доступа.",
        }),
        {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }
    return new Response(JSON.stringify({ csv, fetchedAt: new Date().toISOString() }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "sheet_fetch_error", message: String(e) }),
      {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }
});
