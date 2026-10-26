// Counts unique paying wallets on Algorand mainnet: distinct senders of USDC
// transfers into MAINNET_PAY_TO_ADDRESS, read from the public indexer.
//
// Usage: node scripts/unique-payers.mjs [--exclude ADDR,ADDR] [--min-micro N]
import { readFileSync } from 'node:fs';

const INDEXER = process.env.INDEXER_URL ?? 'https://mainnet-idx.algonode.cloud';

function loadEnv() {
  try {
    const out = {};
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env };
const payTo = env.MAINNET_PAY_TO_ADDRESS;
const assetId = env.MAINNET_USDC_ASSET_ID || '31566704';
if (!payTo) throw new Error('MAINNET_PAY_TO_ADDRESS not set');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const exclude = new Set((arg('--exclude') ?? '').split(',').filter(Boolean));
exclude.add(payTo);
const minMicro = BigInt(arg('--min-micro') ?? 0);

const payers = new Map(); // sender -> { count, micro, first, last }
let next = '';
let transfers = 0;

for (;;) {
  const url =
    `${INDEXER}/v2/transactions?address=${payTo}&address-role=receiver` +
    `&tx-type=axfer&asset-id=${assetId}&limit=1000` +
    (next ? `&next=${next}` : '');
  const res = await fetch(url);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  if (!res.ok) throw new Error(`Indexer ${res.status}: ${await res.text()}`);
  const body = await res.json();

  for (const tx of body.transactions ?? []) {
    const t = tx['asset-transfer-transaction'];
    if (!t || t.receiver !== payTo || exclude.has(tx.sender)) continue;
    if (BigInt(t.amount) < minMicro || BigInt(t.amount) === 0n) continue;
    transfers++;
    const when = new Date(tx['round-time'] * 1000).toISOString();
    const p = payers.get(tx.sender) ?? { count: 0, micro: 0n, first: when, last: when };
    p.count++;
    p.micro += BigInt(t.amount);
    if (when < p.first) p.first = when;
    if (when > p.last) p.last = when;
    payers.set(tx.sender, p);
  }

  next = body['next-token'];
  if (!next || !(body.transactions ?? []).length) break;
}

console.log(`Pay-to:           ${payTo}`);
console.log(`USDC transfers:   ${transfers}`);
console.log(`Unique payers:    ${payers.size}`);
for (const [addr, p] of [...payers].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${addr}  x${p.count}  $${(Number(p.micro) / 1e6).toFixed(2)}  ${p.first.slice(0, 10)}..${p.last.slice(0, 10)}`);
}
