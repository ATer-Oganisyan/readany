(async () => {
 const modules=Array.from(__r.getModules());
 const find=(name)=>{const entry=modules.find(([,m])=>m.verboseName===name);if(!entry)throw Error('Module missing: '+name);return __r(entry[0]);};
 const gateway=find('src/lib/ai/narra-gateway-fetch.ts');
 const expoFetch=find('../../node_modules/expo/fetch.js').fetch;
 const fs=find('../../node_modules/expo-file-system/src/legacy/index.ts');
 const tts=find('src/stores/tts-store.ts').useTTSStore;
 const trackEntry=modules.find(([,m])=>/react-native-track-player\/(?:lib\/)?src\/index\./.test(m.verboseName));
 if(!trackEntry)throw Error('TrackPlayer module missing');
 const trackModule=__r(trackEntry[0]);const tp=trackModule.default??trackModule;
 const initialQueue=await tp.getQueue();
 if(tts.getState().playState!=='stopped'||initialQueue.length)throw Error('Playback occupied: not changing user session');
 const Player=find('src/lib/platform/track-player-edge-player.ts').TrackPlayerEdgeTTSPlayer;
 const player=new Player(); const states=[];const chunks=[];let ended=0;let routed=0;
 player.onStateChange=state=>states.push(state);player.onChunkChange=(index,total)=>chunks.push({index,total});player.onEnd=()=>ended++;
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const result={startedAt:new Date().toISOString(),fixture:'one-second silent PCM WAV, no paid synthesis',trackModule:trackEntry[1].verboseName};
 let uris=[];
 gateway.setNarraGatewayFetch((url,init)=>{
   if(String(url).endsWith('/v2/speech/synthesize')&&String(init?.body).includes('NARRA_TTS_LOCAL_FIXTURE')){
     routed++;return expoFetch('http://127.0.0.1:8697/speech',{method:'POST',headers:{'content-type':'application/json'},body:init.body,signal:init.signal});
   }
   return expoFetch(url,init);
 });
 try {
   await player.speak(['NARRA_TTS_LOCAL_FIXTURE one.','NARRA_TTS_LOCAL_FIXTURE two.','NARRA_TTS_LOCAL_FIXTURE three.'],{...tts.getState().config,engine:'edge',rate:1.1});
   for(let i=0;i<40;i++){await pause(100);if((await tp.getQueue()).length===3)break;}
   const queue=await tp.getQueue();uris=queue.map(t=>t.url);
   result.files=await Promise.all(uris.map(async uri=>{const info=await fs.getInfoAsync(uri);return {name:uri.split('/').pop(),exists:info.exists,bytes:info.size};}));
   result.trackRate=await tp.getRate();
   result.during=await tp.getPlaybackState();
   result.progress=await tp.getProgress();
   await pause(3600);
   result.states=states.slice();result.chunks=chunks;result.ended=ended;result.requests=routed;
 } finally {
   player.stop();gateway.setNarraGatewayFetch(expoFetch);await pause(300);
   result.filesAfterStop=await Promise.all(uris.map(async uri=>(await fs.getInfoAsync(uri)).exists));
   result.queueAfterStop=(await tp.getQueue()).length;
   result.fetchRestored=true;
 }
 if(result.files.length!==3||result.files.some(f=>!f.exists||f.bytes!==96044)||result.trackRate!==1||result.ended!==1||result.filesAfterStop.some(Boolean)||result.queueAfterStop!==0)throw Error(JSON.stringify(result));
 return result;
})()
