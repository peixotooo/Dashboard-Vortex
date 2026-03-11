const fs = require('fs');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

// Load env vars
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Supabase URL or Key not found in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CSV_FILE_PATH = '/Users/guilhermepeixoto/Downloads/export_All-CRM-Vendas-modified--_2026-03-10_23-43-33.csv';
const BATCH_SIZE = 1000;

async function processData() {
  const records = [];
  let batchData = [];
  let rowCount = 0;
  let insertedCount = 0;
  let skipHeaders = true;

  console.log(`Starting to read CSV from ${CSV_FILE_PATH}`);

  const parser = fs
    .createReadStream(CSV_FILE_PATH)
    .pipe(parse({
      delimiter: ',',
      columns: true, // Use first row as headers
      trim: true,
      skip_empty_lines: true
    }));

  for await (const row of parser) {
    rowCount++;
    
    // Parse Valor (e.g. "80,65" -> 80.65)
    let valor = 0;
    if (row.Valor) {
        valor = parseFloat(row.Valor.replace('.', '').replace(',', '.'));
    }

    const record = {
      cliente: row.Cliente,
      compras_anteriores: row['Compras anteriores a esta'] ? parseInt(row['Compras anteriores a esta'], 10) : 0,
      cupom: row.cupom,
      data_compra: row.Data,
      email: row['E-mail'],
      numero_pedido: row['Número do Pedido'],
      ordem_compra: row['Ordem de Compra'],
      telefone: row.telefone,
      valor: isNaN(valor) ? 0 : valor,
      creation_date: row['Creation Date'],
      modified_date: row['Modified Date'],
      slug: row.Slug,
      creator: row.Creator,
      bubble_unique_id: row['unique id']
    };

    batchData.push(record);

    if (batchData.length >= BATCH_SIZE) {
      await insertBatch(batchData, rowCount);
      insertedCount += batchData.length;
      batchData = []; // Reset batch
    }
  }

  // Insert any remaining records
  if (batchData.length > 0) {
    await insertBatch(batchData, rowCount);
    insertedCount += batchData.length;
  }

  console.log(`✅ Finished processing. Uploaded ${insertedCount} rows of ${rowCount} total rows.`);
}

async function insertBatch(batch, currentRowCount) {
    console.log(`Uploading batch... (up to row ${currentRowCount})`);
    
    const { data, error } = await supabase
        .from('crm_vendas')
        .insert(batch);
        
    if (error) {
        console.error("Error inserting batch:", error);
    }
}

processData().catch(err => {
  console.error("Error processing CSV:", err);
});
