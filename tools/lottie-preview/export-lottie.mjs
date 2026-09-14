import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url),saved=new URL('saved/approved/',base);
await mkdir(saved,{recursive:true});
const svg=await readFile(new URL('play-pause-loader.svg',base),'utf8');
const motion=JSON.parse(svg.match(/<metadata[^>]*>(.*?)<\/metadata>/s)[1]);
function convert(svg, motion, name = 'Narra · Play Loader Pause · Approved') {
const duration=Number(svg.match(/dur="([\d.]+)s"/)[1]),fps=60;
const animations=[...svg.matchAll(/<animate[^>]*keyTimes="([^"]+)"\s+values="([^"]+)"/gs)];
assert.equal(animations.length,2);
function shape(d){
 const n=d.match(/-?\d+(?:\.\d+)?/g).map(Number);assert.equal(n.length,50);
 const v=[n.slice(0,2)],incoming=Array(8),outgoing=[];
 for(let i=0;i<8;i++){
  const k=2+i*6,next=(i+1)%8,end=n.slice(k+4,k+6);
  outgoing[i]=n.slice(k,k+2).map((x,j)=>x-v[i][j]);
  incoming[next]=n.slice(k+2,k+4).map((x,j)=>x-end[j]);
  if(next!==0)v.push(end);
 }
 return {i:incoming,o:outgoing,v,c:true};
}
const transform={o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[0,0,0]},a:{a:0,k:[0,0,0]},s:{a:0,k:[100,100,100]}};
const layers=animations.map((match,index)=>{
 const times=match[1].split(';').map(Number),shapes=match[2].split(';').map(shape);assert.equal(times.length,shapes.length);
 const keys=times.map((t,i)=>({t:t*duration*fps,s:[shapes[i]],...(i<times.length-1?{e:[shapes[i+1]],o:{x:0,y:0},i:{x:1,y:1}}:{})}));
 for(let i=1;i<keys.length;i++)assert.ok(keys[i].t>=keys[i-1].t);
 return {ddd:0,ind:index+1,ty:4,nm:`Contour ${index+1}`,sr:1,ks:transform,ao:0,ip:0,op:duration*fps,st:0,bm:0,shapes:[{ty:'sh',nm:'Morph path',ks:{a:1,k:keys}},{ty:'fl',nm:'White',c:{a:0,k:[1,1,1,1]},o:{a:0,k:100},r:1,bm:0}]};
});
const data={v:'5.12.2',fr:fps,ip:0,op:duration*fps,w:320,h:320,nm:name,ddd:0,assets:[],layers,markers:Object.entries(motion.clips).map(([cm,[start,end]])=>({cm,tm:start*fps,dr:(end-start)*fps})),narraMotion:{...motion,exitRepeatTurns:0.5}};
return data;
}
const data=convert(svg,motion);
await writeFile(new URL('play-loader-pause.json',saved),JSON.stringify(data));
await copyFile(new URL('play-pause-loader.svg',base),new URL('play-loader-pause.svg',saved));
await writeFile(new URL('motion.json',saved),JSON.stringify(data.narraMotion,null,2));
await writeFile(new URL('README.md',saved),`# Approved animation\n\nSVG and Lottie snapshots of the approved prototype. 320×320, two filled contours, eight Bézier anchors each. No opacity crossfade.\n\nPlay/pause and loader entry: 300 ms. Loader turn: 400 ms. Loader exit: 350 ms, spring frequency 17 rad/s, damping 0.465. Shape finishes before the first upright crossing.\n\nLottie markers identify forward, reverse, enter, settle, spin, exit and cancel. Coordinates and easing are baked into shape keyframes. Frame rate: 60; fractional keyframe times preserve timings.\n\nFor interactive playback use motion.json: loop spin while loading; when ready, exit at the next visually equivalent top/bottom alignment (phase .25 or .75). Use the exit marker for pause and cancel for play. The raw full timeline is a demonstration, not an audio-state controller.\n\nThe original app Lottie was not replaced.\n`);
console.log(`Saved SVG and Lottie (${Math.round(JSON.stringify(data).length/1024)} KiB), ${data.layers.length} paths, ${data.layers[0].shapes[0].ks.k.length} temporal samples per path.`);

const pairSvg=await readFile(new URL('play-pause.svg',base),'utf8');
const pair=convert(pairSvg,{clips:{forward:[0,0.3],reverse:[0.7,1]}},'Narra · Play Pause · Matching style');
await writeFile(new URL('play-pause.json',saved),JSON.stringify(pair));
await writeFile(new URL('play-pause.svg',saved),pairSvg);
console.log('Saved matching play-pause SVG and Lottie.');
