import type { VercelRequest, VercelResponse } from "@vercel/node";

type Esp32ScanResponse = {
  success?: boolean;
  fingerprint_id?: number | string;
  error?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use GET."
    });
  }

  // Set this in .env.local for LOCAL testing only:
  // ESP32_IP=http://192.168.1.50
  const esp32Ip = process.env.ESP32_IP || "http://192.168.1.50";

  // Important: Vercel cannot reach local/private IPs like 192.168.x.x
  // This route is only useful when running locally on the same network as the ESP32.
  if (
    process.env.VERCEL === "1" &&
    /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(esp32Ip)
  ) {
    return res.status(400).json({
      success: false,
      error:
        "This API route is pointing to a private/local ESP32 IP. Deployed Vercel functions cannot access local network devices. Use ESP32 -> Supabase -> Realtime for production."
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${esp32Ip}/scan`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8"
      }
    });

    const raw = await response.text();
    console.log("RAW ESP32 RESPONSE:", raw);

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: `ESP32 returned HTTP ${response.status}`,
        raw
      });
    }

    let data: Esp32ScanResponse;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        success: false,
        error: "ESP32 returned invalid JSON",
        raw
      });
    }

    if (data.success && data.fingerprint_id !== undefined && data.fingerprint_id !== null) {
      return res.status(200).json({
        success: true,
        fingerprintId: Number(data.fingerprint_id)
      });
    }

    return res.status(200).json({
      success: false,
      error: data.error || "No fingerprint detected"
    });
  } catch (error: any) {
    const isAbort = error?.name === "AbortError";

    return res.status(isAbort ? 504 : 500).json({
      success: false,
      error: isAbort ? "ESP32 request timed out" : "ESP32 not connected"
    });
  } finally {
    clearTimeout(timeout);
  }
}