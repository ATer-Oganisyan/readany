(async()=>{
 const modules=Array.from(__r.getModules());
 const find=name=>{const row=modules.find(([,m])=>m.verboseName===name);if(!row)throw Error('Module missing: '+name);return __r(row[0]);};
 const config=find('src/lib/ai/narra-gateway-fetch.ts').getNarraGatewayConfig();
 if(config.baseUrl!=='https://api-test.narra.disrupt.builders'||config.authMode!=='installation')throw Error('Unexpected Gateway configuration; no requests made');
 const api=find('src/lib/narra/backend-catalog-api.ts');
 const result={startedAt:new Date().toISOString(),baseUrl:config.baseUrl,authMode:config.authMode,readOnly:true,pages:[]};
 const common=await api.fetchBackendCatalogPage(undefined,2);
 result.pages.push({scope:'all',count:common.items.length,languages:common.items.map(b=>b.language),hasNext:!!common.nextCursor});
 for(const language of ['ru','en']){
   const first=await api.fetchBackendLanguageCatalogPage(language,undefined,2);
   if(first.items.length!==2||first.items.some(b=>b.language!==language)||!first.nextCursor)throw Error('Invalid first language page');
   const second=await api.fetchBackendLanguageCatalogPage(language,first.nextCursor,2);
   const ids=new Set([...first.items,...second.items].map(b=>b.bookEditionId));
   if(second.items.some(b=>b.language!==language)||ids.size!==first.items.length+second.items.length||second.items.length>2||first.nextCursor===second.nextCursor)throw Error('Invalid language pagination');
   result.pages.push({scope:language,contractValidated:true,paginationDistinct:ids.size===first.items.length+second.items.length,pageCounts:[first.items.length,second.items.length],languages:[...first.items,...second.items].map(b=>b.language),distinctEditions:ids.size,opaqueCursorPassedUnchanged:true});
 }
 const english=await api.fetchBackendLanguageCatalogPage('en',undefined,100);
 result.englishVerification={limit:100,count:english.items.length,hasNext:!!english.nextCursor,allEnglish:english.items.every(b=>b.language==='en')};
 result.completedAt=new Date().toISOString();
 return result;
})()
