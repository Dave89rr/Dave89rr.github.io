// The Line: route map, stop codes, and the phone strip
(() => {
  document.getElementById('yr').textContent = new Date().getFullYear();
  const STOPS = [
    {id:'start',code:'',name:'Start',x:80,y:30,line:'gold'},
    {id:'i1',code:'I1',name:'River Nest',x:80,y:95,line:'gold'},
    {id:'i2',code:'I2',name:'GamersAtlas',x:80,y:160,line:'gold'},
    {id:'i3',code:'I3',name:'Combat Tracker',x:80,y:225,line:'gold'},
    {id:'a1',code:'A1',name:'Ops toolkit',x:120,y:335,line:'blue'},
    {id:'a2',code:'A2',name:'iRepairIT',x:120,y:390,line:'blue'},
    {id:'e1',code:'E1',name:'GGCMaps',x:160,y:470,line:'green'},
    {id:'e2',code:'E2',name:'Stakr',x:160,y:520,line:'green'},
    {id:'e3',code:'E3',name:'Machenist',x:160,y:570,line:'green'},
    {id:'e4',code:'E4',name:'RarePnT',x:160,y:620,line:'green'},
    {id:'c1',code:'C1',name:'Experience',x:200,y:700,line:'red'},
    {id:'c2',code:'C2',name:'About',x:200,y:755,line:'red'},
    {id:'c3',code:'C3',name:'Contact',x:200,y:810,line:'red'},
  ];
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.getElementById('stops');
  const nodes = {};
  for (const s of STOPS) {
    const grp = document.createElementNS(NS,'g'); grp.setAttribute('class','stop');
    const a = document.createElementNS(NS,'a'); a.setAttribute('href','#'+s.id);
    a.setAttribute('aria-label', (s.code ? s.code+' ' : '') + s.name);
    const c = document.createElementNS(NS,'circle'); c.setAttribute('cx',s.x); c.setAttribute('cy',s.y); c.setAttribute('r',9);
    const t = document.createElementNS(NS,'text'); t.setAttribute('x',s.x+30); t.setAttribute('y',s.y+8);
    if (s.code) { const k = document.createElementNS(NS,'tspan'); k.setAttribute('class','code'); k.setAttribute('fill',`var(--${s.line}-t)`); k.textContent = s.code+'  '; t.append(k); }
    t.append(s.name);
    const hit = document.createElementNS(NS,'rect'); hit.setAttribute('x',s.x-20); hit.setAttribute('y',s.y-22); hit.setAttribute('width',300); hit.setAttribute('height',44); hit.setAttribute('fill','transparent');
    a.append(hit,c,t); grp.append(a); g.append(grp); nodes[s.id]=grp;
  }
  const train = document.getElementById('train');
  const core = train.querySelector('.core');
  const strip = {code:document.getElementById('s-code'),name:document.getElementById('s-name'),el:document.querySelector('.strip')};
  const bulletClass = {gold:'b-i',blue:'b-a',green:'b-e',red:'b-c'};
  // the track's corners, matching the line paths in the SVG, so the train rides the bends
  const TRACK = [[80,30],[80,255],[120,295],[120,390],[160,430],[160,620],[200,660],[200,810]];
  const LEN = [0];
  for (let i=1;i<TRACK.length;i++) LEN.push(LEN[i-1] + Math.hypot(TRACK[i][0]-TRACK[i-1][0], TRACK[i][1]-TRACK[i-1][1]));
  // distance along the track to a point on it
  function along(x,y){
    let best = 0, bestGap = Infinity;
    for (let i=1;i<TRACK.length;i++){
      const [ax,ay]=TRACK[i-1], [bx,by]=TRACK[i], len=LEN[i]-LEN[i-1];
      const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/(len*len)));
      const gap = Math.hypot(ax+t*(bx-ax)-x, ay+t*(by-ay)-y);
      if (gap < bestGap){ bestGap = gap; best = LEN[i-1]+t*len; }
    }
    return best;
  }
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let ride = null, at = null;
  function moveTrain(x,y){
    const to = `translate(${x}px,${y}px)`;
    if (!at || still.matches){ if (ride) ride.cancel(); train.style.transform = to; at = [x,y]; return; }
    // start from wherever the train is now, even mid-ride
    const m = new DOMMatrixReadOnly(getComputedStyle(train).transform);
    if (ride) ride.cancel();
    const d0 = along(m.e,m.f), d1 = along(x,y);
    const pts = [[m.e,m.f,d0]];
    const corners = TRACK.map((p,i)=>[p[0],p[1],LEN[i]]).filter(p => (p[2]-d0)*(p[2]-d1) < 0);
    if (d1 < d0) corners.reverse();
    pts.push(...corners, [x,y,d1]);
    const span = Math.abs(d1-d0) || 1;
    train.style.transform = to; at = [x,y];
    ride = train.animate(pts.map(p => ({transform:`translate(${p[0]}px,${p[1]}px)`, offset:Math.abs(p[2]-d0)/span})),
      {duration:700, easing:'cubic-bezier(.77,0,.175,1)'});
  }

  let current = null;
  function arrive(id){
    const s = STOPS.find(x=>x.id===id); if(!s || s.id===current) return;
    if (current) nodes[current].classList.remove('on');
    nodes[id].classList.add('on'); current = id;
    moveTrain(s.x, s.y);
    core.style.fill = `var(--${s.line})`;
    document.querySelectorAll('.sheet .row').forEach(r=>r.classList.toggle('on', r.id===id));
    const show = s.id==='start' ? STOPS[1] : s;
    strip.code.textContent = show.code; strip.code.className = 'bullet '+bulletClass[show.line];
    strip.name.textContent = show.name; strip.el.style.setProperty('--strip-line',`var(--${show.line})`);
  }
  arrive('start');

  // which stop is at the platform: the one crossing the upper third of the viewport
  const targets = [...document.querySelectorAll('[data-stop]')].filter(el => !(el.id==='earlier'));
  const io = new IntersectionObserver(es => {
    if (held) return;
    for (const e of es) if (e.isIntersecting) arrive(e.target.dataset.stop);
  }, {rootMargin:'-30% 0px -65% 0px'});
  targets.forEach(t=>io.observe(t));

  // a jump names its stop, so the band mustn't overrule it: the earlier-builds rows are
  // short enough that the next row, not the chosen one, crosses the band once you land
  let held = false, release;
  const letGo = ms => { clearTimeout(release); release = setTimeout(() => { held = false; }, ms); };
  addEventListener('scroll', () => { if (held) letGo(150); }, {passive:true});
  function jump(id){ arrive(id); held = true; letGo(400); }
  g.addEventListener('click', ev => { const a = ev.target.closest('a'); if (a) jump(a.getAttribute('href').slice(1)); });
  const fromHash = STOPS.find(x=>'#'+x.id===location.hash);
  if (fromHash) jump(fromHash.id);

  // entrances: once per station, parts staggered by --i
  const io2 = new IntersectionObserver((es,o) => { for (const e of es) if (e.isIntersecting){ e.target.classList.add('in'); o.unobserve(e.target);} }, {rootMargin:'0px 0px -12% 0px'});
  document.querySelectorAll('.station,.hero').forEach(s=>io2.observe(s));

  // the direct address: key a stop code, like keying a teletext page
  const form = document.getElementById('key'), inp = document.getElementById('key-in'), msg = document.getElementById('key-msg');
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const code = inp.value.trim().toUpperCase();
    const s = STOPS.find(x=>x.code===code);
    if (!s) { msg.className='key-msg err'; msg.textContent = code ? `No stop ${code}. Try I1–I3, A1–A2, E1–E4, C1–C3.` : 'Type a stop code, like I2.'; return; }
    msg.className='key-msg'; msg.textContent = `Now arriving: ${s.name}`;
    jump(s.id);
    document.getElementById(s.id).scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    history.replaceState(null,'','#'+s.id); inp.value='';
  });
  document.getElementById('s-next').addEventListener('click', () => {
    const i = STOPS.findIndex(x=>x.id===current); const n = STOPS[Math.min(i+1, STOPS.length-1)];
    jump(n.id);
    document.getElementById(n.id).scrollIntoView({behavior:'smooth'});
  });
})();
