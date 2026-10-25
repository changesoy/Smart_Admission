const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** POST-form Overpass 查询，返回 JSON；失败自动换端点 */
export async function overpass(query, { tries = 2 } = {}) {
  let lastErr;
  for (let round = 0; round < tries; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "SmartAdmissionDataBot/1.0",
          },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
          lastErr = new Error(`${url} ${res.status}`);
          continue;
        }
        const text = await res.text();
        if (!text.trim().startsWith("{")) {
          lastErr = new Error(`${url} 非 JSON: ${text.slice(0, 80)}`);
          continue;
        }
        return { url, json: JSON.parse(text) };
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 2000 * (round + 1)));
  }
  throw lastErr;
}
