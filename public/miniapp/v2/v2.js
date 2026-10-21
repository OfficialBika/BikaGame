(()=>{'use strict';
const root=document.getElementById('bikaV2App');
if(!root||root.dataset.initialized==='1')return;
root.dataset.initialized='1';
const $=(s,ctx=root)=>ctx.querySelector(s),$$=(s,ctx=root)=>Array.from(ctx.querySelectorAll(s));
const screens=$$('.screen'),names={rocket:'Rocket Crash',slot:'Premium Slot',blackjack:'Blackjack',shan:'Shan Koe Mee',mines:'Mines',wheel:'Lucky Wheel',plinko:'Plinko'};
let current='home',filter='all',toastTimer=0,raf=0,roundTimer=0,roundStarted=0,soundOn=false,asset='gifts',activeGame='rocket',reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const toast=message=>{const node=$('#v2Toast');node.textContent=message;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,2600)};
function showScreen(name){const known=['home','games','activity','wallet','profile','game'];current=known.includes(name)?name:'home';screens.forEach(screen=>{const active=screen.dataset.screen===current;screen.hidden=!active;screen.classList.toggle('is-active',active)});$$('[data-nav]').forEach(button=>{const active=button.dataset.nav===current;button.classList.toggle('is-current',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});if(current==='game')$$('[data-nav]').forEach(button=>button.classList.remove('is-current'));const heading=$('#mainContent');if(heading)heading.focus({preventScroll:true});window.scrollTo({top:0,behavior:reduced?'auto':'smooth'});stopAnimation();if(current==='game')startAnimation();if(current!=='game')closeBetSheet(false);}
function showGame(key){
 if(!names[key]){toast('That game is not in this preview.');return}
 activeGame=key;
 const isRocket=key==='rocket',isWheel=key==='wheel';
 $('#gameTitle').textContent=names[key];
 $('#gameModeLabel').textContent=isWheel?'PRIZE WHEEL · DEMO':'DEMO ROUND';
 const arena=$('#gameArena');
 arena.dataset.mode=isWheel?'wheel':'rocket';
 ['.arena-planet','.arena-flight-path','.arena-rocket','.arena-spark-trail','.arena-multiplier','.arena-state','.arena-flares'].forEach(sel=>{const node=$(sel,arena);if(node)node.hidden=isWheel});
 let wheel=$('#wheelGraphic');
 if(isWheel&&!wheel){
   wheel=document.createElement('div');wheel.id='wheelGraphic';wheel.className='wheel-graphic';
   wheel.setAttribute('role','img');wheel.setAttribute('aria-label','Illustrative prize wheel with sample multipliers');
   wheel.innerHTML='<div class="wheel-pointer"></div><div class="wheel-rim"><div class="wheel-face"><span>2×</span><span>5×</span><span>1.5×</span><span>10×</span><span>3×</span><span>JACKPOT</span><span>1.2×</span><span>8×</span></div></div><div class="wheel-hub">B</div>';
   arena.appendChild(wheel);
 }
 if(wheel){wheel.hidden=!isWheel;wheel.classList.remove('is-spinning');}
 $('#demoRoundStatus').textContent=isWheel?'PRIZE WHEEL':'NEXT ROUND IN';
 $('#roundCountdown').textContent=isWheel?'READY':'3.2s';
 $('#openBetSheet').querySelector('span:first-child').textContent=isWheel?'Spin preview':'Place bet';
 $('.multiplier-history').setAttribute('aria-label',isWheel?'Sample wheel outcomes':'Sample recent round multipliers');
 const hist=$$('.history-tag');
 hist.forEach((button,i)=>{button.textContent=(isWheel?['GIFT','2×','5×','10×','1.5×','BONUS'][i]:['1.73x','3.22x','1.30x','12.3x','16.0x','8.34x'][i]);button.classList.toggle('history-gold',isWheel&&[1,3,5].includes(i));});
 $('#livePlayersHeading').innerHTML=isWheel?'Recent outcomes <span>8</span>':'Players <span id="livePlayersCount">24</span>';
 $('#livePlayerList').hidden=isWheel;$('.players-table-head').hidden=isWheel;
 $('.sample-data-note').textContent=isWheel?'Wheel segments and outcomes are sample visuals only; no reward is claimable.':'Sample players and payouts are illustrative only. No real wagers are submitted.';
 $('.players-title-row .eyebrow').textContent=isWheel?'WHEEL ARENA':'LIVE ARENA';
 $('.live-badge').innerHTML='<i></i> '+(isWheel?'SAMPLE RESULTS':'LIVE DEMO');
 $('.game-disclaimer').innerHTML='<span>ⓘ</span> '+(isWheel?'WHEEL PREVIEW':'GAME PREVIEW')+' · NOT CONNECTED TO LIVE WAGERS OR PAYOUTS';
 showScreen('game');
 if(isWheel){$('#demoRoundStatus').textContent='PRIZE WHEEL';$('#roundCountdown').textContent='READY';}
}
function openBetSheet(){if(activeGame!=='rocket'&&activeGame!=='wheel'){toast('Only Rocket and Wheel have visual previews at this stage.');return}$('#betSheet').hidden=false;$('#betSheetBackdrop').hidden=false;document.body.classList.add('bet-sheet-open');$('#closeBetSheet').focus();}
function closeBetSheet(restoreFocus=true){const sheet=$('#betSheet'),backdrop=$('#betSheetBackdrop');if(!sheet||sheet.hidden)return;sheet.hidden=true;backdrop.hidden=true;document.body.classList.remove('bet-sheet-open');if(restoreFocus)$('#openBetSheet')?.focus();}
function stopAnimation(){if(raf){cancelAnimationFrame(raf);raf=0}if(roundTimer){clearTimeout(roundTimer);roundTimer=0}}
function startAnimation(){if(reduced||raf||document.hidden||current!=='game'||activeGame!=='rocket')return;roundStarted=performance.now();roundTimer=setTimeout(()=>{if(current==='game'&&activeGame==='rocket'){$('#demoRoundStatus').textContent='ROUND ENDED';$('#roundCountdown').textContent='PREVIEW';}},15000);raf=requestAnimationFrame(tick)}
function tick(now){if(!root.isConnected||document.hidden||current!=='game'||activeGame!=='rocket'){raf=0;return}const seconds=(now-roundStarted)/1000;const multiplier=1+seconds*seconds*.018;$('#demoMultiplier').innerHTML=multiplier.toFixed(2)+'<span>x</span>';const countdown=Math.max(0,3.2-(seconds%7));$('#roundCountdown').textContent=countdown.toFixed(1)+'s';raf=requestAnimationFrame(tick)}
function applySearch(){const query=($('#gameSearch')?.value||'').trim().toLowerCase();let shown=0;$$('#allGames .game-card').forEach(card=>{const match=card.textContent.toLowerCase().includes(query)&&(filter==='all'||card.dataset.category===filter);card.hidden=!match;if(match)shown++});$('#gameEmpty').hidden=shown!==0}
root.addEventListener('click',event=>{const nav=event.target.closest('[data-nav]');if(nav){showScreen(nav.dataset.nav);return}const game=event.target.closest('[data-game]');if(game){showGame(game.dataset.game);return}const amount=event.target.closest('[data-demo-bet]');if(amount){const value=Number(amount.dataset.demoBet);$('#demoBetAmount').value=String(value);$$('[data-demo-bet]').forEach(button=>button.classList.toggle('is-selected',button===amount));$('#demoBetHint').textContent='Sample amount: '+value.toLocaleString('en-US');return}const activity=event.target.closest('[data-activity]');if(activity){$$('[data-activity]').forEach(button=>button.classList.toggle('is-selected',button===activity));$('#activityEmptyTitle').textContent=activity.dataset.activity==='games'?'Game history appears here':'Transactions appear here';$('#activityEmptyText').textContent=activity.dataset.activity==='games'?'Connect your Telegram account in the integrated build to load verified game history.':'Verified transaction history will load from the configured history source.';return}const fb=event.target.closest('[data-filter]');if(fb){filter=fb.dataset.filter;$$('[data-filter]').forEach(button=>button.classList.toggle('is-selected',button===fb));applySearch();return}const assetTab=event.target.closest('[data-asset]');if(assetTab){asset=assetTab.dataset.asset;$$('[data-asset]').forEach(button=>button.classList.toggle('is-active',button===assetTab));$('#inputCurrency').textContent=asset==='ton'?'TON':'Gifts';toast('Currency tab is visual only.');return}const history=event.target.closest('.history-tag');if(history){$$('.history-tag').forEach(button=>button.classList.toggle('is-active',button===history));$('#demoMultiplier').innerHTML=history.textContent.replace('x','')+'<span>x</span>';toast('Sample history only.');return}});
$('#gameSearch')?.addEventListener('input',applySearch);
$('#openBetSheet').addEventListener('click',openBetSheet);$('#closeBetSheet').addEventListener('click',()=>closeBetSheet());$('#betSheetBackdrop').addEventListener('click',()=>closeBetSheet());$('#gameQuickAdd').addEventListener('click',()=>toast('Demo balance control only.'));$('#gameSettingsButton').addEventListener('click',()=>toast('Game settings are not connected in preview.'));
$('#soundToggle').addEventListener('click',()=>{soundOn=!soundOn;$('#soundToggle').setAttribute('aria-pressed',String(soundOn));$('#soundToggle').textContent=soundOn?'♫':'♩';toast('Sound preview is not connected.');});
$('#maxDemoBet').addEventListener('click',()=>{const input=$('#demoBetAmount');input.value=input.max;$('#demoBetHint').textContent='Sample amount: '+Number(input.value).toLocaleString('en-US')});
$('#demoBetAmount').addEventListener('input',()=>{$$('[data-demo-bet]').forEach(button=>button.classList.toggle('is-selected',Number(button.dataset.demoBet)===Number($('#demoBetAmount').value)));$('#demoBetHint').textContent='Sample amount: '+(Number.isFinite(Number($('#demoBetAmount').value))?Number($('#demoBetAmount').value).toLocaleString('en-US'):'—');$('#demoFeedback').textContent='Sample amount changed. No live action is connected.'});
$('#demoBetButton').addEventListener('click',()=>{const input=$('#demoBetAmount'),amount=Number(input.value);if(!Number.isSafeInteger(amount)||amount<Number(input.min)||amount>Number(input.max)){ $('#demoFeedback').textContent='Enter a whole-number demo amount between 1 and 1,000,000,000.';input.focus();return}const auto=$('#autoCashoutToggle').checked,autoValue=Number($('#autoCashoutValue').value);if(auto&&(!Number.isFinite(autoValue)||autoValue<1.01||autoValue>10000)){$('#demoFeedback').textContent='Enter an auto cash-out sample multiplier from 1.01 to 10000.';$('#autoCashoutValue').focus();return}if(activeGame==='wheel'){const wheel=$('#wheelGraphic');if(wheel){wheel.classList.remove('is-spinning');void wheel.offsetWidth;wheel.classList.add('is-spinning');setTimeout(()=>wheel.classList.remove('is-spinning'),3500)}$('#demoFeedback').textContent='Wheel preview: '+amount.toLocaleString('en-US')+' '+asset+'. No reward claimed and no balance changed.';toast('Wheel visual spin only — no reward claimed.');return}$('#demoFeedback').textContent='Preview only: '+amount.toLocaleString('en-US')+' '+asset+'. No live bet or balance change was sent.';toast('Demo only — no real bet was placed.');closeBetSheet(false)});
$('#profileShortcut').addEventListener('click',()=>showScreen('profile'));
const tg=window.Telegram?.WebApp;if(tg){try{tg.ready();tg.expand();const user=tg.initDataUnsafe?.user;if(user){const label=[user.first_name,user.last_name].filter(Boolean).join(' ').trim()||'Telegram player';$('#profileName').textContent=label;$('#profileStatus').textContent='Telegram WebApp detected · account API not connected';$('#profileAvatar').textContent=(user.first_name||'B').slice(0,1).toUpperCase();$('#profileShortcut').textContent=(user.first_name||'B').slice(0,1).toUpperCase()}$('#connectionState span').textContent='Telegram detected'}catch(error){console.warn('[BIKA v2 preview] Telegram SDK init skipped',error)}}else $('#connectionState span').textContent='Browser preview';
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAnimation();else if(current==='game')startAnimation()});window.addEventListener('pagehide',()=>{stopAnimation();clearTimeout(toastTimer)},{once:true});
})();
