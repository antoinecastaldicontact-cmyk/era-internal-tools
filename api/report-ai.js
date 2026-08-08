// /api/report-ai — proxy pour la génération d'emails de reporting (API Anthropic).
// L'appel direct api.anthropic.com depuis le navigateur ne fonctionne que dans les
// artifacts claude.ai — sur Vercel il faut une clé API côté serveur.
// Env var requise : ANTHROPIC_API_KEY (console.anthropic.com). Optionnelle si la
// fonctionnalité "Report" n'est pas utilisée.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const { ANTHROPIC_API_KEY } = process.env;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'missing_env',
      message: 'ANTHROPIC_API_KEY manquante sur Vercel — la génération de report est désactivée.',
    });
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 12000) {
    return res.status(400).json({ error: 'bad_request', message: 'Prompt invalide.' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message || 'Anthropic API error');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'ai_error', message: e.message });
  }
}
