// Usage: node scripts/ingest-one.cjs <path-to-txt> [source-prefix]
const fs = require("fs");
const path = require("path");

const envText = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const env = {};
for (const l of envText.split("\n")) {
  const [k, ...v] = l.split("=");
  if (k && v.length) env[k.trim()] = v.join("=").trim();
}

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 400;

function chunkText(text, source) {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= CHUNK_SIZE) {
    return [{ content: cleaned, metadata: { source, chunkIndex: 0, totalChunks: 1 } }];
  }
  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = start + CHUNK_SIZE;
    if (end < cleaned.length) {
      const pb = cleaned.lastIndexOf("\n\n", end);
      if (pb > start + CHUNK_SIZE * 0.5) end = pb;
      else {
        const sb = cleaned.lastIndexOf(". ", end);
        if (sb > start + CHUNK_SIZE * 0.5) end = sb + 1;
      }
    } else end = cleaned.length;
    chunks.push(cleaned.slice(start, end).trim());
    const newStart = end - CHUNK_OVERLAP;
    start = newStart <= start ? end : newStart;
  }
  if (chunks.length > 1 && chunks[chunks.length - 1].length < CHUNK_OVERLAP) {
    chunks[chunks.length - 2] += " " + chunks.pop();
  }
  return chunks.map((content, i) => ({
    content,
    metadata: { source, chunkIndex: i, totalChunks: chunks.length },
  }));
}

async function embed(text) {
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.JINA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      input: [text],
      task: "retrieval.passage",
      dimensions: 1024,
      normalized: true,
      embedding_type: "float",
    }),
  });
  if (!res.ok) throw new Error(`Jina error: ${await res.text()}`);
  const json = await res.json();
  return json.data[0].embedding;
}

async function insertRow(content, metadata, embedding) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/documents`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ content, metadata, embedding }),
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/ingest-one.cjs <file.txt>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved, ".txt");
  const source = `project:${baseName}`;

  const text = fs.readFileSync(resolved, "utf-8");
  console.log(`${baseName}: ${text.length} chars`);

  const chunks = chunkText(text, source);
  console.log(`  ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    const emb = await embed(chunks[i].content);
    await insertRow(chunks[i].content, chunks[i].metadata, emb);
    console.log(`  ${i + 1}/${chunks.length} done`);
  }

  console.log(`  OK!`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
