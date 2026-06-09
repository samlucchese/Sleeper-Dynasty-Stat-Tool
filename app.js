const LEAGUE_ID = '1326629536078528512';
const API = 'https://api.sleeper.app/v1';
const $ = (id) => document.getElementById(id);
let state = { seasons: [], managers: [], trades: [], selectedSeason: 'all', query: '' };

const fmt = (n, d=0) => Number.isFinite(n) ? n.toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:d}) : '0';
const pct = (n) => Number.isFinite(n) ? `${(n*100).toFixed(1)}%` : '0.0%';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function get(path){ const r = await fetch(`${API}${path}`); if(!r.ok) throw new Error(`${r.status} ${path}`); return r.json(); }
function avatarUrl(id){ return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : ''; }
function managerName(user){ return user?.metadata?.team_name || user?.display_name || user?.username || `User ${user?.user_id || ''}`; }

async function loadLeagueChain(startId){
  const chain = []; let id = startId; const seen = new Set();
  while(id && !seen.has(id)){
    seen.add(id);
    const league = await get(`/league/${id}`);
    chain.push(league);
    id = league.previous_league_id;
    await sleep(80);
  }
  return chain.sort((a,b)=>Number(a.season)-Number(b.season));
}

async function loadSeason(league){
  const [users, rosters, winners, losers, tradedPicks, drafts] = await Promise.all([
    get(`/league/${league.league_id}/users`), get(`/league/${league.league_id}/rosters`),
    get(`/league/${league.league_id}/winners_bracket`).catch(()=>[]), get(`/league/${league.league_id}/losers_bracket`).catch(()=>[]),
    get(`/league/${league.league_id}/traded_picks`).catch(()=>[]), get(`/league/${league.league_id}/drafts`).catch(()=>[])
  ]);
  const userMap = Object.fromEntries(users.map(u=>[u.user_id,u]));
  const rosterMap = Object.fromEntries(rosters.map(r=>[r.roster_id,r]));
  const weeks = [];
  const txs = [];
  const maxWeeks = Number(league.settings?.playoff_week_start || 15) - 1 || 14;
  for(let wk=1; wk<=18; wk++){
    const [matchups, transactions] = await Promise.all([
      get(`/league/${league.league_id}/matchups/${wk}`).catch(()=>[]),
      get(`/league/${league.league_id}/transactions/${wk}`).catch(()=>[])
    ]);
    if(matchups?.length) weeks.push({ week:wk, matchups });
    if(transactions?.length) txs.push(...transactions.map(t=>({...t, week:wk})));
    if(wk > maxWeeks + 4 && !matchups?.length) break;
    await sleep(80);
  }
  const trades = txs.filter(t=>t.type === 'trade' && (t.status === 'complete' || t.status === 'processed'));
  return { league, users, rosters, userMap, rosterMap, weeks, trades, tradedPicks, drafts, winners, losers };
}

function ensureManager(map, ownerId, user){
  if(!ownerId) return null;
  if(!map[ownerId]) map[ownerId] = {
    user_id: ownerId, name: managerName(user), avatar: user?.avatar, seasons: {}, totals: {
      wins:0, losses:0, ties:0, pf:0, pa:0, games:0, allWins:0, allLosses:0, expectedWins:0,
      highWeeks:0, lowWeeks:0, titles:0, runnerUps:0, playoffApps:0, trades:0, assetsFor:0, assetsAgainst:0
    }
  };
  return map[ownerId];
}
function seasonBucket(manager, season){
  if(!manager.seasons[season]) manager.seasons[season] = { season, wins:0, losses:0, ties:0, pf:0, pa:0, games:0, allWins:0, allLosses:0, expectedWins:0, highWeeks:0, lowWeeks:0, trades:0, finish:null };
  return manager.seasons[season];
}
function addGame(m, s, points, oppPoints, result){
  [m.totals, s].forEach(x=>{ x.pf+=points; x.pa+=oppPoints; x.games++; if(result==='W')x.wins++; else if(result==='L')x.losses++; else x.ties++; });
}
function parseAssets(t, rosterId, rosterMap){
  const adds = [], drops = [];
  for(const [pid, rid] of Object.entries(t.adds || {})) if(String(rid)===String(rosterId)) adds.push(pid);
  for(const [pid, rid] of Object.entries(t.drops || {})) if(String(rid)===String(rosterId)) drops.push(pid);
  const pickAdds = (t.draft_picks || []).filter(p=>String(p.owner_id)===String(rosterId) || String(p.new_owner_id)===String(rosterId));
  return { adds, drops, pickAdds };
}
function assetCount(a){ return a.adds.length + a.drops.length + a.pickAdds.length; }

function buildAnalytics(seasons){
  const managers = {};
  const allTrades = [];
  seasons.forEach(seasonData=>{
    const { league, users, rosters, userMap, rosterMap, weeks, trades, winners } = seasonData;
    rosters.forEach(r=>ensureManager(managers, r.owner_id, userMap[r.owner_id]));
    weeks.forEach(({week, matchups})=>{
      const byMatchup = {};
      matchups.forEach(m=>{ if(m.matchup_id) (byMatchup[m.matchup_id] ||= []).push(m); });
      const scores = matchups.map(m=>Number(m.points || 0));
      const high = Math.max(...scores), low = Math.min(...scores);
      matchups.forEach(m=>{
        const roster = rosterMap[m.roster_id]; const mgr = ensureManager(managers, roster?.owner_id, userMap[roster?.owner_id]); if(!mgr) return;
        const sb = seasonBucket(mgr, league.season); const pts = Number(m.points || 0);
        const allWins = scores.filter(x=>pts>x).length, allTies = scores.filter(x=>pts===x).length - 1;
        const allLosses = scores.length - 1 - allWins - allTies;
        [mgr.totals, sb].forEach(x=>{ x.allWins+=allWins; x.allLosses+=allLosses; x.expectedWins += allWins / Math.max(1, scores.length-1); });
        if(pts===high){ mgr.totals.highWeeks++; sb.highWeeks++; }
        if(pts===low){ mgr.totals.lowWeeks++; sb.lowWeeks++; }
      });
      Object.values(byMatchup).forEach(pair=>{
        if(pair.length !== 2) return;
        const [a,b]=pair; const ra=rosterMap[a.roster_id], rb=rosterMap[b.roster_id];
        const ma=ensureManager(managers, ra?.owner_id, userMap[ra?.owner_id]); const mb=ensureManager(managers, rb?.owner_id, userMap[rb?.owner_id]);
        if(!ma||!mb) return;
        const sa=seasonBucket(ma, league.season), sb=seasonBucket(mb, league.season);
        const ap=Number(a.points||0), bp=Number(b.points||0);
        addGame(ma, sa, ap, bp, ap>bp?'W':ap<bp?'L':'T'); addGame(mb, sb, bp, ap, bp>ap?'W':bp<ap?'L':'T');
      });
    });
    const championship = winners?.find(g=>g.p===1) || winners?.[winners.length-1];
    if(championship){
      const champ = rosterMap[championship.w], runner = rosterMap[championship.l];
      const cm = ensureManager(managers, champ?.owner_id, userMap[champ?.owner_id]); const rm = ensureManager(managers, runner?.owner_id, userMap[runner?.owner_id]);
      if(cm){ cm.totals.titles++; seasonBucket(cm, league.season).finish = 1; }
      if(rm){ rm.totals.runnerUps++; seasonBucket(rm, league.season).finish = 2; }
    }
    trades.forEach(t=>{
      const rosterIds = [...new Set([...(Object.values(t.adds||{})), ...(Object.values(t.drops||{})), ...((t.roster_ids)||[])])];
      const people = rosterIds.map(rid=>rosterMap[rid]?.owner_id).filter(Boolean);
      people.forEach(uid=>{ const m=ensureManager(managers, uid, userMap[uid]); const s=seasonBucket(m, league.season); m.totals.trades++; s.trades++; });
      const sides = rosterIds.map(rid=>({rid, owner: rosterMap[rid]?.owner_id, name: managerName(userMap[rosterMap[rid]?.owner_id]), assets: parseAssets(t,rid,rosterMap)})).filter(x=>x.owner);
      sides.forEach(side=>{ const m=managers[side.owner]; if(m){ m.totals.assetsFor += side.assets.adds.length + side.assets.pickAdds.length; m.totals.assetsAgainst += side.assets.drops.length; }});
      allTrades.push({ season: league.season, week:t.week, id:t.transaction_id, status:t.status, created:t.created, sides });
    });
  });
  return { managers:Object.values(managers), trades:allTrades.sort((a,b)=>(b.created||0)-(a.created||0)) };
}

function filteredManagers(){
  const q = state.query.toLowerCase();
  return state.managers.filter(m=>m.name.toLowerCase().includes(q)).sort((a,b)=>b.totals.wins-a.totals.wins || b.totals.pf-a.totals.pf);
}
function visibleStats(m){
  if(state.selectedSeason==='all') return m.totals;
  return m.seasons[state.selectedSeason] || {wins:0,losses:0,ties:0,pf:0,pa:0,games:0,expectedWins:0,highWeeks:0,lowWeeks:0,trades:0};
}
function luck(s){ return (s.wins || 0) - (s.expectedWins || 0); }
function winPct(s){ return s.games ? (s.wins + s.ties*.5)/s.games : 0; }

function render(){
  $('controls').classList.remove('hidden'); $('managerPanel').classList.remove('hidden'); $('seasonPanel').classList.remove('hidden'); $('tradePanel').classList.remove('hidden'); $('awardsPanel').classList.remove('hidden'); $('comparePanel').classList.remove('hidden');
  const seasons = state.seasons.map(s=>s.league.season);
  $('leagueTitle').textContent = state.seasons.at(-1)?.league?.name || 'Sleeper League Hub';
  $('leagueSubtitle').textContent = `${seasons[0]}–${seasons.at(-1)} • ${state.managers.length} managers • ${state.trades.length} trades found`;
  $('status').classList.add('hidden');
  renderControls(seasons); renderHero(); renderManagers(); renderSeasons(); renderTrades(); renderAwards(); renderCompare();
}
function renderControls(seasons){
  const currentSeasonVal = $('seasonSelect').value || state.selectedSeason;
  $('seasonSelect').innerHTML = `<option value="all">All seasons</option>` + seasons.map(s=>`<option value="${s}">${s}</option>`).join(''); $('seasonSelect').value = currentSeasonVal;
  const opts = state.managers.sort((a,b)=>a.name.localeCompare(b.name)).map(m=>`<option value="${m.user_id}">${m.name}</option>`).join('');
  if(!$('compareA').innerHTML){ $('compareA').innerHTML = opts; $('compareB').innerHTML = opts; $('compareB').selectedIndex = Math.min(1, state.managers.length-1); }
}
function renderHero(){
  const managers = state.managers, seasons = state.seasons.length;
  const games = managers.reduce((a,m)=>a+m.totals.games,0)/2, pf = managers.reduce((a,m)=>a+m.totals.pf,0);
  const top = [...managers].sort((a,b)=>b.totals.titles-a.totals.titles || b.totals.wins-a.totals.wins)[0];
  $('heroStats').innerHTML = [
    ['Seasons', seasons], ['Matchups', fmt(games)], ['Total points', fmt(pf,1)], ['Top résumé', top ? `${top.name} (${top.totals.titles} 🏆)` : '—']
  ].map(([l,n])=>`<div class="stat-card"><div class="num">${n}</div><div class="label">${l}</div></div>`).join('');
}
function renderManagers(){
  const managers = filteredManagers(); $('managerCount').textContent = `${managers.length} shown`;
  $('managerGrid').innerHTML = managers.map(m=>{ const s=visibleStats(m); const l=luck(s); return `<article class="manager-card">
    <div class="manager-head"><div><h3>${m.name}</h3><p class="muted">${state.selectedSeason==='all'?'Career':state.selectedSeason} profile</p></div>${m.avatar?`<img class="avatar" src="${avatarUrl(m.avatar)}" alt="">`:''}</div>
    <div class="chips"><span class="chip">${m.totals.titles} titles</span><span class="chip">${m.totals.runnerUps} runner-ups</span><span class="chip">${s.trades||0} trades</span></div>
    <div class="mini-grid"><div class="mini"><b>${s.wins}-${s.losses}${s.ties?`-${s.ties}`:''}</b><span>Record</span></div><div class="mini"><b>${pct(winPct(s))}</b><span>Win rate</span></div><div class="mini"><b>${fmt(s.pf,1)}</b><span>Points for</span></div><div class="mini"><b class="${l>=0?'good':'bad'}">${l>=0?'+':''}${fmt(l,2)}</b><span>Luck wins</span></div><div class="mini"><b>${s.highWeeks}</b><span>Weekly highs</span></div><div class="mini"><b>${s.lowWeeks}</b><span>Weekly lows</span></div></div>
  </article>`; }).join('');
}
function renderSeasons(){
  $('seasonGrid').innerHTML = state.seasons.map(sd=>{
    const rows = state.managers.map(m=>({m, s:m.seasons[sd.league.season]})).filter(x=>x.s).sort((a,b)=>b.s.wins-a.s.wins || b.s.pf-a.s.pf).slice(0,12);
    return `<article class="season-card"><h3>${sd.league.season}</h3><table class="table"><thead><tr><th>Mgr</th><th>Rec</th><th>PF</th><th>Luck</th></tr></thead><tbody>${rows.map(({m,s})=>`<tr><td>${m.name}${s.finish===1?' 🏆':s.finish===2?' 🥈':''}</td><td>${s.wins}-${s.losses}</td><td>${fmt(s.pf,1)}</td><td class="${luck(s)>=0?'good':'bad'}">${luck(s)>=0?'+':''}${fmt(luck(s),1)}</td></tr>`).join('')}</tbody></table></article>`;
  }).join('');
}
function renderTrades(){
  const trades = state.trades.filter(t=>state.selectedSeason==='all'||t.season===state.selectedSeason).slice(0,60);
  $('tradeSubtitle').textContent = `${trades.length} recent shown`;
  $('tradeGrid').innerHTML = trades.map(t=>`<article class="trade-card"><div class="trade-title">${t.season} Week ${t.week || '?'} trade</div><p>${new Date(t.created || Date.now()).toLocaleDateString()}</p><div class="assets">${t.sides.map(s=>`<div class="asset-box"><b>${s.name}</b><p>Received: ${[...s.assets.adds, ...s.assets.pickAdds.map(p=>`${p.season} R${p.round} pick`)].join(', ') || '—'}</p><p>Sent: ${s.assets.drops.join(', ') || '—'}</p></div>`).join('')}</div></article>`).join('') || '<p class="muted">No completed trades found for this filter.</p>';
}
function renderAwards(){
  const pool = state.managers.map(m=>({m,s:visibleStats(m)})).filter(x=>x.s.games);
  const awards = [
    ['Dynasty Final Boss', [...state.managers].sort((a,b)=>b.totals.titles-a.totals.titles || b.totals.wins-a.totals.wins)[0], m=>`${m.totals.titles} titles, ${m.totals.wins} wins`],
    ['Luckiest Manager', pool.sort((a,b)=>luck(b.s)-luck(a.s))[0]?.m, m=>`${fmt(luck(visibleStats(m)),2)} wins over expected`],
    ['Snakebitten Manager', pool.sort((a,b)=>luck(a.s)-luck(b.s))[0]?.m, m=>`${fmt(luck(visibleStats(m)),2)} wins vs expected`],
    ['Trade Addict', [...state.managers].sort((a,b)=>b.totals.trades-a.totals.trades)[0], m=>`${m.totals.trades} trade appearances`],
    ['Weekly Nuker', [...state.managers].sort((a,b)=>b.totals.highWeeks-a.totals.highWeeks)[0], m=>`${m.totals.highWeeks} weekly high scores`],
    ['Basement Magnet', [...state.managers].sort((a,b)=>b.totals.lowWeeks-a.totals.lowWeeks)[0], m=>`${m.totals.lowWeeks} weekly low scores`]
  ];
  $('awardsGrid').innerHTML = awards.filter(a=>a[1]).map(([title,m,desc])=>`<article class="award-card"><h3>${title}</h3><p><b>${m.name}</b></p><p class="muted">${desc(m)}</p></article>`).join('');
}
function renderCompare(){
  const a = state.managers.find(m=>m.user_id===$('compareA').value) || state.managers[0]; const b = state.managers.find(m=>m.user_id===$('compareB').value) || state.managers[1]; if(!a||!b) return;
  const metrics = [['Record',m=>`${visibleStats(m).wins}-${visibleStats(m).losses}`],['Win %',m=>pct(winPct(visibleStats(m)))],['Points For',m=>fmt(visibleStats(m).pf,1)],['Luck Wins',m=>`${luck(visibleStats(m))>=0?'+':''}${fmt(luck(visibleStats(m)),2)}`],['Titles',m=>m.totals.titles],['Trades',m=>visibleStats(m).trades||0]];
  $('compareSubtitle').textContent = `${a.name} vs ${b.name}`;
  $('compareGrid').innerHTML = [a,b].map(m=>`<article class="manager-card"><h3>${m.name}</h3><div class="mini-grid">${metrics.map(([label,fn])=>`<div class="mini"><b>${fn(m)}</b><span>${label}</span></div>`).join('')}</div></article>`).join('');
}

async function init(){
  try{
    $('status').textContent = 'Finding current and previous Sleeper seasons…';
    const chain = await loadLeagueChain(LEAGUE_ID);
    $('status').textContent = `Found ${chain.length} season(s). Pulling matchups and transactions…`;
    const seasons = [];
    for(const lg of chain){ $('status').textContent = `Loading ${lg.season} matchups, rosters, transactions, and trades…`; seasons.push(await loadSeason(lg)); }
    const analytics = buildAnalytics(seasons); state.seasons = seasons; state.managers = analytics.managers; state.trades = analytics.trades; render();
  }catch(err){ console.error(err); $('status').innerHTML = `<b>Could not load league data.</b><br>${err.message}<br><br>Check that the league is public and the League ID is correct.`; }
}
$('refreshBtn').addEventListener('click', init);
$('searchInput').addEventListener('input', e=>{ state.query=e.target.value; renderManagers(); });
$('seasonSelect').addEventListener('change', e=>{ state.selectedSeason=e.target.value; renderManagers(); renderTrades(); renderAwards(); renderCompare(); });
$('compareA').addEventListener('change', renderCompare); $('compareB').addEventListener('change', renderCompare);
init();
