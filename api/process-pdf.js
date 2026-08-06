// api/process-pdf.js — Importe un PDF depuis Google Drive, l'upload sur Cloudinary,
// renvoie l'URL du PDF et l'URL de l'image de la première page (couverture).
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { verifyAdmin, bearer } = require('./_lib/fb');

function extractDriveId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
  const { idToken, driveUrl, folder } = body;

  try { await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const fileId = extractDriveId(driveUrl);
  if (!fileId) return res.status(400).json({ error: 'Lien Google Drive invalide' });

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 Mo — suffisant pour un document Almaqtab, évite l'épuisement mémoire de la fonction serverless

  try {
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: MAX_PDF_BYTES,
      maxBodyLength: MAX_PDF_BYTES
    });
    const pdfBuffer = Buffer.from(response.data);

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dqixuyqqh';
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiKey || !apiSecret) return res.status(500).json({ error: 'Cloudinary non configuré' });

    const timestamp = Math.floor(Date.now() / 1000);
    const uploadFolder = String(folder || 'almaqtab_pdfs').replace(/[^a-zA-Z0-9_\/-]/g, '_').slice(0, 100);
    const toSign = `folder=${uploadFolder}&timestamp=${timestamp}`;
    const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

    const formData = new FormData();
    formData.append('file', pdfBuffer, { filename: 'document.pdf' });
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', uploadFolder);
    formData.append('resource_type', 'raw');

    const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, formData, {
      headers: formData.getHeaders()
    });
    const pdfData = cloudRes.data;
    const pdfUrl = pdfData.secure_url;
    const publicId = pdfData.public_id;

    const coverUrl = `https://res.cloudinary.com/${cloudName}/image/upload/pages:1/${publicId}`;

    res.json({ pdfUrl, coverUrl, publicId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors du traitement du PDF : ' + error.message });
  }
};
