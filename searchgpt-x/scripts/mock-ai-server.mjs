// A tiny OpenAI-compatible server for end-to-end tests without a real API key.
import http from 'node:http';

// Builds a one-page PDF containing `text` (Helvetica), with a correct xref table.
export function minimalPdf(text) {
  const esc = text.replace(/[()\\]/g, (c) => '\\' + c);
  const stream = `BT /F1 18 Tf 72 720 Td (${esc}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function startMockAI(port = 8787) {
  const calls = [];
  const base = `http://127.0.0.1:${port}`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, base);
    // Mock Brave Search API + deterministic pages to read.
    if (req.method === 'GET' && u.pathname === '/res/v1/web/search') {
      const q = u.searchParams.get('q');
      const results = Array.from({ length: 6 }, (_, i) => ({
        title: `Mock result ${i + 1} for ${q}`,
        url: `${base}/page/${i + 1}?q=${encodeURIComponent(q)}`,
        description: `Snippet ${i + 1} about ${q}.`,
        profile: { name: `Mock Site ${i + 1}` }
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ web: { results } }));
    }
    if (req.method === 'GET' && u.pathname === '/res/v1/images/search') {
      const svg = (c) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="${100 + c * 10}"><rect width="100%" height="100%" fill="hsl(${c * 40},80%,60%)"/></svg>`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ results: Array.from({ length: 8 }, (_, i) => ({ title: `Image ${i}`, url: `${base}/page/${i}`, thumbnail: { src: svg(i) }, source: 'mock.example' })) }));
    }
    if (req.method === 'GET' && u.pathname === '/doc.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end(minimalPdf('Quarterly photosynthesis report: chlorophyll absorbs light.'));
    }
    if (req.method === 'GET' && u.pathname.startsWith('/page/')) {
      const n = u.pathname.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><title>Mock page ${n}</title></head><body><nav>menu</nav><article><h1>Mock page ${n}</h1>${'<p>This is a long paragraph of mock article text used to test readable extraction in SearchGPT X. It mentions fact number ' + n + '.</p>'.repeat(8)}</article></body></html>`);
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      calls.push(json);
      const system = json.messages?.[0]?.content ?? '';
      const nSources = (system.match(/^\[\d+\] /gm) || []).length;
      if (!json.stream) {
        const content = system.includes('follow-up') ? '["What else should I know?","How does it compare?","Where can I learn more?"]' : '["mock query one","mock query two"]';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const hasPage = system.includes('The user is looking at this');
      const text = nSources
        ? `**Mock answer.** I read ${nSources} sources. The first source says something [1], and others agree [2][3].\n\n| Point | Source |\n|---|---|\n| A | [1] |\n\n- bullet one\n- bullet two`
        : hasPage
          ? `## Summary\nThis page was summarized by the mock model. Page title seen: ${(system.match(/Title: (.*)/) || [])[1]}`
          : 'Hello from the mock assistant. Here is some `code`.';
      const parts = text.match(/.{1,12}/gs);
      let i = 0;
      const iv = setInterval(() => {
        if (i < parts.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
        } else {
          res.write('data: [DONE]\n\n');
          res.end();
          clearInterval(iv);
        }
      }, 15);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, calls })));
}
