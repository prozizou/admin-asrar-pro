// api/cloudinary-sign.js — Signe un upload Cloudinary (admins seulement).
// Le secret Cloudinary reste côté serveur ; le client reçoit juste une signature
// à usage unique et envoie le fichier directement à Cloudinary.
// Env requis : CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME.
const crypto = require("crypto");
const { verifyAdmin } = require("./_lib/fb");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();

  try { await verifyAdmin(body.idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "dqixuyqqh";
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret)
    return res.status(500).json({ error: "Cloudinary non configuré (CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET manquants sur Vercel)." });

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = String(body.folder || "asrar_admin").replace(/[^a-zA-Z0-9_\/-]/g, "_").slice(0, 100);

  // Signature Cloudinary : sha1( "folder=..&timestamp=.." + api_secret )
  const toSign = "folder=" + folder + "&timestamp=" + timestamp;
  const signature = crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");

  res.json({ cloudName, apiKey, timestamp, folder, signature });
};
