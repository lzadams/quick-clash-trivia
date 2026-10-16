import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { QUESTIONS } from './questions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export function buildServer({ questionMs = 15000, revealMs = 3500, intermissionMs = 3500, rounds = 3, questionsPerRound = 5 } = {}) {
 const app = express(); const httpServer = createServer(app);
 const io = new Server(httpServer, {cors:{origin:false}});
 const rooms = new Map();
 app.use(express.static(join(__dirname,'public')));
 app.get('/health', (_req,res)=>res.json({ok:true}));
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 const code=()=>Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');
 const cleanName=(value)=>String(value??'').trim().slice(0,20).replace(/[<>]/g,'') || 'Player';
 const publicPlayers=r=>[...r.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,connected:p.connected,answered:p.answered}));
 const state=r=>({code:r.code,phase:r.phase,hostId:r.hostId,players:publicPlayers(r),questionIndex:r.questionIndex,round:r.round,totalQuestions:rounds*questionsPerRound,rounds,questionsPerRound,question:r.phase==='question'?{q:r.current.q,a:r.current.a}:null,deadline:r.deadline,results:r.results??null});
 const publish=r=>io.to(r.code).emit('state',state(r));
 const clear=r=>{if(r.timer) clearTimeout(r.timer);r.timer=null};
 const schedule=(r,cb,ms)=>{clear(r);r.timer=setTimeout(()=>{if(rooms.get(r.code)===r)cb()},ms);r.timer.unref?.()};
 const shuffledQuestions=()=>{const q=[...QUESTIONS];for(let i=q.length-1;i>0;i--){let j=randomInt(i+1);[q[i],q[j]]=[q[j],q[i]]}return q};
 function startQuestion(r){
  if(r.questionIndex >= rounds*questionsPerRound){r.phase='finished';r.results=null;r.deadline=null;publish(r);return}
  r.phase='question';r.current=r.deck[r.questionIndex];r.answers.clear();r.results=null;
  for(const p of r.players.values())p.answered=false;
  r.round=Math.floor(r.questionIndex/questionsPerRound)+1;r.deadline=Date.now()+questionMs;
  publish(r);schedule(r,()=>reveal(r),questionMs);
 }
 function reveal(r){
  if(r.phase!=='question')return;
  r.phase='reveal';r.deadline=Date.now()+revealMs;
  r.results={correct:r.current.correct,awards:[...r.answers.entries()].map(([id,a])=>({id,points:a.points}))};
  publish(r);schedule(r,()=>{r.questionIndex++;if(r.questionIndex%questionsPerRound===0&&r.questionIndex<rounds*questionsPerRound){r.phase='intermission';r.deadline=Date.now()+intermissionMs;r.results=null;publish(r);schedule(r,()=>startQuestion(r),intermissionMs)}else startQuestion(r)},revealMs);
 }
 function findRoom(socket){const code=socket.data.code;return code?rooms.get(code):null}
 const ackError=(ack,message)=>{if(typeof ack==='function')ack({ok:false,error:message})};
 io.on('connection',socket=>{
  socket.on('create',({name}={},ack)=>{
   if(socket.data.code)return ackError(ack,'You are already in a room');
   let c;do{c=code()}while(rooms.has(c));
   const id=randomUUID();const r={code:c,hostId:id,players:new Map(),phase:'lobby',questionIndex:0,round:1,current:null,answers:new Map(),deadline:null,results:null,timer:null,deck:[]};
   r.players.set(id,{id,name:cleanName(name),score:0,connected:true,answered:false,socketId:socket.id});rooms.set(c,r);
   socket.data={code:c,playerId:id};socket.join(c);ack?.({ok:true,code:c,id});publish(r);
  });
  socket.on('join',({name,code:c}={},ack)=>{
   if(socket.data.code)return ackError(ack,'You are already in a room');
   const r=rooms.get(String(c??'').trim().toUpperCase());
   if(!r)return ackError(ack,'Room not found. Check the six-character code.');
   if(r.phase!=='lobby')return ackError(ack,'This game has already started.');
   if(r.players.size>=8)return ackError(ack,'Room is full (maximum eight players).');
   const id=randomUUID();r.players.set(id,{id,name:cleanName(name),score:0,connected:true,answered:false,socketId:socket.id});
   socket.data={code:r.code,playerId:id};socket.join(r.code);ack?.({ok:true,code:r.code,id});publish(r);
  });
  socket.on('start',(_arg,ack)=>{
   const r=findRoom(socket);if(!r)return ackError(ack,'Join a room first.');
   if(socket.data.playerId!==r.hostId)return ackError(ack,'Only the host can start.');
   if(r.phase!=='lobby')return ackError(ack,'Game already started.');
   if(r.players.size<2)return ackError(ack,'At least two players must join.');
   r.deck=shuffledQuestions().slice(0,rounds*questionsPerRound);r.questionIndex=0;
   for(const p of r.players.values())p.score=0;
   ack?.({ok:true});startQuestion(r);
  });
  socket.on('answer',({choice}={},ack)=>{
   const r=findRoom(socket);if(!r||r.phase!=='question')return ackError(ack,'No active question.');
   const p=r.players.get(socket.data.playerId);
   if(!p||!p.connected)return ackError(ack,'Player not found.');
   if(r.answers.has(p.id))return ackError(ack,'You already answered.');
   if(!Number.isInteger(choice)||choice<0||choice>3)return ackError(ack,'Invalid answer.');
   if(Date.now()>=r.deadline)return ackError(ack,'Time is up.');
   const correct=choice===r.current.correct;
   const points=correct?100+Math.floor(50*Math.max(0,r.deadline-Date.now())/questionMs):0;
   p.score+=points;p.answered=true;r.answers.set(p.id,{choice,points});ack?.({ok:true});publish(r);
   if([...r.players.values()].filter(x=>x.connected).every(x=>x.answered))reveal(r);
  });
  socket.on('playAgain',(_arg,ack)=>{
   const r=findRoom(socket);if(!r)return ackError(ack,'No room');
   if(socket.data.playerId!==r.hostId)return ackError(ack,'Only the host can restart.');
   if(r.phase!=='finished')return ackError(ack,'Game is not finished.');
   r.phase='lobby';r.questionIndex=0;r.round=1;r.results=null;r.deadline=null;r.answers.clear();
   for(const p of r.players.values()){p.answered=false;p.score=0}
   ack?.({ok:true});publish(r);
  });
  socket.on('disconnect',()=>{
   const r=findRoom(socket);if(!r)return;
   const p=r.players.get(socket.data.playerId);if(!p)return;
   if(r.phase==='lobby'||r.phase==='finished'){r.players.delete(p.id);if(r.hostId===p.id)r.hostId=r.players.keys().next().value??null}
   else {p.connected=false;if(r.hostId===p.id)r.hostId=[...r.players.values()].find(x=>x.connected)?.id??null;}
   if(r.players.size===0||![...r.players.values()].some(x=>x.connected)){clear(r);rooms.delete(r.code);return;}
   publish(r);
   if(r.phase==='question'&&[...r.players.values()].filter(x=>x.connected).every(x=>x.answered))reveal(r);
  });
 });
 return {app,httpServer,io,rooms,close:()=>new Promise(resolve=>{for(const r of rooms.values())clear(r);io.close(()=>httpServer.close(()=>resolve()))})};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const {httpServer}=buildServer();const port=Number(process.env.PORT||3000);httpServer.listen(port,'0.0.0.0',()=>console.log(`Quick Clash listening on http://localhost:${port}`));
}
