/**
 * MCP Apps UI layer.
 *
 * Each of the four tools is paired with a `ui://` HTML resource (per the MCP
 * Apps extension, SEP-1865). An MCP-Apps-capable host fetches the resource,
 * renders it in a sandboxed iframe, and pushes the tool result to it via a
 * `ui/notifications/tool-result` postMessage. Hosts without UI support simply
 * show the tool's text content, so nothing breaks.
 *
 * The same HTML is reused two ways:
 *  - as a registered resource (a shell that waits for the tool-result message)
 *  - inline in the tool result with the data pre-baked (broad mcp-ui support)
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type View = "fees" | "blocks" | "mempool" | "block-detail";

/** MCP Apps HTML profile. */
export const UI_MIME_TYPE = "text/html;profile=mcp-app";

export const UI_RESOURCES: Record<View, { uri: string; name: string; description: string }> = {
  fees: {
    uri: "ui://bitcoin-mempool/fees",
    name: "Fee estimates",
    description: "Recommended Bitcoin fee rates (sat/vB).",
  },
  blocks: {
    uri: "ui://bitcoin-mempool/blocks",
    name: "Latest blocks",
    description: "Most recently mined Bitcoin blocks.",
  },
  mempool: {
    uri: "ui://bitcoin-mempool/mempool",
    name: "Mempool status",
    description: "Current Bitcoin mempool congestion.",
  },
  "block-detail": {
    uri: "ui://bitcoin-mempool/block-detail",
    name: "Block detail",
    description: "Metadata for a single Bitcoin block.",
  },
};

/** Renderer that runs inside the iframe. Pure string — no build step. */
const RENDERER_JS = String.raw`
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;'})[c];});}
function num(n){return Number(n).toLocaleString();}
function ts(t){try{return new Date(t*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';}catch(e){return String(t);}}
function card(label,val,sub){return '<div class="card"><div class="lbl">'+esc(label)+'</div><div class="val">'+esc(val)+'</div>'+(sub?'<div class="sub">'+esc(sub)+'</div>':'')+'</div>';}
function render(view,d){
  var root=document.getElementById('root');if(!root)return;
  if(!d){root.innerHTML='<p class="muted">Waiting for data…</p>';return;}
  var h='';
  if(view==='fees'){
    h='<div class="grid">'+card('Fastest',d.fastestFee+' sat/vB','~10 min')+card('Half hour',d.halfHourFee+' sat/vB','~30 min')+card('Hour',d.hourFee+' sat/vB','~60 min')+card('Economy',d.economyFee+' sat/vB','low priority')+card('Minimum',d.minimumFee+' sat/vB','relay floor')+'</div>';
  }else if(view==='blocks'){
    var bs=d.blocks||[];
    h='<table><thead><tr><th>Height</th><th>Miner</th><th>Tx</th><th>Hash</th><th>Time</th></tr></thead><tbody>'+bs.map(function(b){return '<tr><td>'+num(b.height)+'</td><td>'+esc(b.miner||'—')+'</td><td>'+num(b.txCount)+'</td><td class="mono">'+esc((b.hash||'').slice(0,12))+'…</td><td>'+ts(b.timestamp)+'</td></tr>';}).join('')+'</tbody></table>';
  }else if(view==='mempool'){
    h='<div class="grid">'+card('Pending tx',num(d.txCount),'')+card('Size',num(d.vsize)+' vB','pending vbytes')+card('Total fees',num(d.totalFee)+' sat','')+card('Projected blocks',num((d.projectedBlocks||[]).length),'')+'</div>';
    var pb=d.projectedBlocks||[];
    if(pb.length){h+='<table><thead><tr><th>Block</th><th>Tx</th><th>Median fee</th><th>Fee range</th></tr></thead><tbody>'+pb.map(function(b,i){var fr=b.feeRange||[];return '<tr><td>#'+(i+1)+'</td><td>'+num(b.nTx)+'</td><td>'+b.medianFee+' sat/vB</td><td>'+(fr.length?fr[0]+'–'+fr[fr.length-1]:'—')+'</td></tr>';}).join('')+'</tbody></table>';}
  }else if(view==='block-detail'){
    var rows=[['Height',num(d.height)],['Hash',d.hash],['Miner',d.miner||'—'],['Time',ts(d.timestamp)],['Tx count',num(d.txCount)],['Size',num(d.size)+' B'],['Weight',num(d.weight)+' WU'],['Difficulty',d.difficulty],['Merkle root',d.merkleRoot],['Prev block',d.previousBlockHash||'—']];
    h='<table class="kv"><tbody>'+rows.map(function(r){return '<tr><th>'+esc(r[0])+'</th><td class="mono">'+esc(r[1])+'</td></tr>';}).join('')+'</tbody></table>';
  }
  root.innerHTML=h;
}
window.addEventListener('message',function(ev){var m=(ev&&ev.data)||{};if(m.method==='ui/notifications/tool-result'&&m.params){render(VIEW,m.params.structuredContent||null);}});
try{parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{capabilities:{}}}, '*');}catch(e){}
render(VIEW,DATA);
`;

const STYLE = String.raw`
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:16px;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;background:#fff}
h1{font-size:15px;margin:0 0 12px;color:#f7931a;display:flex;align-items:center;gap:8px}
.muted{color:#888}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.card{border:1px solid #eee;border-radius:10px;padding:12px;background:#fafafa}
.card .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#888}
.card .val{font-size:18px;font-weight:600;margin-top:2px}
.card .sub{font-size:11px;color:#aaa;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #eee}
th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#888;font-weight:600}
table.kv th{width:120px;color:#888;text-transform:none;font-size:13px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
@media (prefers-color-scheme:dark){body{color:#e6e6e6;background:#15161a}.card{background:#1d1f25;border-color:#2a2d36}th,td{border-color:#2a2d36}}
`;

const TITLES: Record<View, string> = {
  fees: "₿ Recommended fees",
  blocks: "₿ Latest blocks",
  mempool: "₿ Mempool status",
  "block-detail": "₿ Block detail",
};

/**
 * Builds a full HTML document for a view. When `data` is provided it is baked
 * in for immediate render; when null the page waits for a tool-result message.
 */
export function buildHtml(view: View, data: unknown): string {
  // Guard against the data string accidentally closing the script tag.
  const json = JSON.stringify(data ?? null).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLES[view]}</title><style>${STYLE}</style></head>
<body><h1>${TITLES[view]}</h1><div id="root"></div>
<script>var VIEW=${JSON.stringify(view)};var DATA=${json};${RENDERER_JS}</script>
</body></html>`;
}

/** The shell HTML registered as a `ui://` resource (no baked data). */
export function shellHtml(view: View): string {
  return buildHtml(view, null);
}

/** An inline embedded UI resource for a tool result, with data pre-baked. */
export function uiResourceContent(view: View, data: unknown): CallToolResult["content"][number] {
  return {
    type: "resource",
    resource: {
      uri: UI_RESOURCES[view].uri,
      mimeType: "text/html",
      text: buildHtml(view, data),
    },
  };
}
