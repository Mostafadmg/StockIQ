/** Exact NHS GTIN-to-AMPP lookup. No learned barcode mappings or network calls. */
import localGtinCatalogue from '../data/dmd-gtin.json' with {type:'json'};
import {getLocalDmdPack} from './dmd-local.mjs';
import {normalizeGtin} from '../src/barcode.js';
const decodedGtinShards=new Map();
async function gtinShard(prefix){
 if(decodedGtinShards.has(prefix)){const rows=decodedGtinShards.get(prefix);decodedGtinShards.delete(prefix);decodedGtinShards.set(prefix,rows);return rows;}
 const encoded=localGtinCatalogue.shards[prefix];if(!encoded)return {};
 const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 const rows=JSON.parse(text);decodedGtinShards.set(prefix,rows);while(decodedGtinShards.size>4)decodedGtinShards.delete(decodedGtinShards.keys().next().value);return rows;
}
export function gtinCatalogueStatus(){return {source:localGtinCatalogue.source,releaseDate:localGtinCatalogue.releaseDate,gtinReleaseDate:localGtinCatalogue.gtinReleaseDate,counts:localGtinCatalogue.counts,loaded:true};}
export async function lookupDmdGtin(raw,env={}){
 const gtin=normalizeGtin(raw),record=(await gtinShard(gtin.slice(0,localGtinCatalogue.prefixLength)))[gtin];
 const historical=Boolean(record?.[0]),associations=(record?.[1]||[]).map(([amppId,startDate,endDate])=>({amppId,startDate,endDate,historical}));
 const matches=[];
 for(const association of associations){const pack=await getLocalDmdPack(association.amppId,'AMPP',env);matches.push(pack);}
 const warnings=historical?['This GTIN association has ended in dm+d. It identifies an older pack still present in the active medicine catalogue; verify the pack name and strength before ordering.']:[];
 return {gtin,matches,associations,historical,warnings,ambiguous:matches.length>1,source:localGtinCatalogue.source,releaseDate:localGtinCatalogue.releaseDate,gtinReleaseDate:localGtinCatalogue.gtinReleaseDate,matchPolicy:'Exact GTIN match; current associations first, historical associations only when no current association exists.'};
}
