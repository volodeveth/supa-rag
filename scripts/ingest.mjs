import fs from "fs";

// Read env manually
const envText = fs.readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envText.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) env[key.trim()] = rest.join("=").trim();
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const JINA_KEY = env.JINA_API_KEY;

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
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (chunks.length > 1 && start <= end - CHUNK_SIZE) start = end;
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
      Authorization: `Bearer ${JINA_KEY}`,
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ content, metadata, embedding }),
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
}

const text = fs.readFileSync(process.argv[2] || "scripts/cv-text.txt", "utf-8");
console.log(`Read ${text.length} chars`);

const chunks = chunkText(text, "cv.pdf");
console.log(`${chunks.length} chunks`);

for (let i = 0; i < chunks.length; i++) {
  console.log(`Embedding chunk ${i + 1}/${chunks.length}...`);
  const emb = await embed(chunks[i].content);
  console.log(`Storing chunk ${i + 1}...`);
  await insertRow(chunks[i].content, chunks[i].metadata, emb);
  console.log(`  Done ${i + 1}/${chunks.length}`);
}

console.log("All done!");
