import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { chunkText } from "../src/lib/chunker";
import { generateEmbeddings } from "../src/lib/embeddings";

// Load env
import "dotenv/config";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/ingest-pdf.ts <path-to-pdf>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(pdfPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`Reading PDF: ${resolvedPath}`);

  const pdf = (await import("pdf-parse")).default;
  const buffer = fs.readFileSync(resolvedPath);
  const data = await pdf(buffer);

  console.log(`Extracted ${data.numpages} pages, ${data.text.length} characters`);

  // Chunk the text
  const fileName = path.basename(resolvedPath);
  const chunks = chunkText(data.text, fileName);
  console.log(`Split into ${chunks.length} chunks`);

  // Generate embeddings in batches of 10
  console.log(`Generating embeddings via Jina AI...`);
  const BATCH_SIZE = 10;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await generateEmbeddings(
      batch.map((c) => c.content),
      "retrieval.passage"
    );
    allEmbeddings.push(...embeddings);
    console.log(
      `  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} done`
    );
  }

  // Store in Supabase
  console.log(`Storing in Supabase...`);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const rows = chunks.map((chunk, i) => ({
    content: chunk.content,
    metadata: chunk.metadata,
    embedding: allEmbeddings[i],
  }));

  const { error } = await supabase.from("documents").insert(rows);

  if (error) {
    console.error("Supabase insert error:", error.message);
    process.exit(1);
  }

  console.log(`Successfully ingested ${chunks.length} chunks into Supabase`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
