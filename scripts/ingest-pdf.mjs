import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

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
      const paragraphBreak = cleaned.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + CHUNK_SIZE * 0.5) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = cleaned.lastIndexOf(". ", end);
        if (sentenceBreak > start + CHUNK_SIZE * 0.5) {
          end = sentenceBreak + 1;
        }
      }
    } else {
      end = cleaned.length;
    }

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

async function generateEmbeddings(texts, task = "retrieval.passage") {
  const response = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      input: texts,
      task,
      dimensions: 1024,
      normalized: true,
      embedding_type: "float",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jina API error: ${err}`);
  }

  const json = await response.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/ingest-pdf.mjs <path-to-txt-or-pdf>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  console.log(`Reading: ${resolvedPath}`);

  // Read as text file
  const text = fs.readFileSync(resolvedPath, "utf-8");
  console.log(`Read ${text.length} characters`);

  const fileName = path.basename(resolvedPath);
  const chunks = chunkText(text, fileName);
  console.log(`Split into ${chunks.length} chunks`);

  // Generate embeddings one by one
  console.log(`Generating embeddings via Jina AI...`);
  const allEmbeddings = [];

  for (let i = 0; i < chunks.length; i++) {
    const embeddings = await generateEmbeddings([chunks[i].content], "retrieval.passage");
    allEmbeddings.push(embeddings[0]);
    console.log(`  Chunk ${i + 1}/${chunks.length} embedded`);
  }

  // Store in Supabase one by one
  console.log(`Storing in Supabase...`);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  for (let i = 0; i < chunks.length; i++) {
    const { error } = await supabase.from("documents").insert({
      content: chunks[i].content,
      metadata: chunks[i].metadata,
      embedding: allEmbeddings[i],
    });

    if (error) {
      console.error(`Insert error for chunk ${i}:`, error.message);
      process.exit(1);
    }
    console.log(`  Stored chunk ${i + 1}/${chunks.length}`);
  }

  console.log(`Successfully ingested ${chunks.length} chunks into Supabase`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
