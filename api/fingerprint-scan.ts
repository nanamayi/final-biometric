import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  try {

    // CHANGE THIS TO YOUR ESP32 IP ADDRESS
    const ESP32_IP = "http://192.168.1.50";

    const response = await fetch(`${ESP32_IP}/scan`);
    const data = await response.json();

    if (data.success) {
      return res.status(200).json({
        success: true,
        fingerprintId: data.fingerprint_id
      });
    }

    return res.status(200).json({
      success: false,
      error: "No fingerprint detected"
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "ESP32 not connected"
    });

  }

}