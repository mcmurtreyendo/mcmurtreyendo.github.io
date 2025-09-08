/* ======== FRONT-END ONLY — DO NOT PUT APPS SCRIPT CODE HERE ======== */

/* ---- config ---- */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyEjJvFoBgHz8LMUt7dBauwHgIOByKnRR3N4ExpCXn3dk9zpkuQUogzC3f6Z7oAUtaxWQ/exec';

/* ---- utilities ---- */
const $  = (s, sc = document) => sc.querySelector(s);
const $$ = (s, sc = document) => Array.from(sc.querySelectorAll(s));

const stepCount = 5;
let step = 1;
let sending = false;

const form = $('#refForm');
const prevBtn = $('#prevBtn'), nextBtn = $('#nextBtn'), submitBtn = $('#submitBtn');
const reviewPane = $('#reviewPane'), toast = $('#toast');

const esc = (str) => String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v) => v && String(v).trim() ? esc(v) : '<span class="hint">—</span>';
const ageFromDOB = (dobStr) => {
  if (!dobStr) return '';
  const d = new Date(dobStr);
  if (isNaN(d)) return esc(dobStr);
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
  return `${d.toLocaleDateString()}  (${age} yrs)`;
};

function toastMsg(msg){
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> toast.style.display='none', 2200);
}

/* ---- stepper + validation ---- */
function setStep(n){
  step = Math.max(1, Math.min(stepCount, n));
  $$('fieldset', form).forEach(fs => fs.classList.toggle('active', Number(fs.dataset.step) === step));
  $$('.step', $('#stepper')).forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.toggle('active', s === step);
    el.classList.toggle('done', s < step);
  });
  prevBtn.disabled = step === 1;
  nextBtn.style.display = step < stepCount ? 'inline-block' : 'none';
  submitBtn.style.display = step === stepCount ? 'inline-block' : 'none';
  if (step === 5) buildReview();
}

function validateStep(s){
  const fs = $$('fieldset', form).find(f => Number(f.dataset.step) === s);
  if (!fs) return true;
  $$('input,select,textarea', fs).forEach(el => { el.style.borderColor=''; el.classList.remove('invalid'); });
  let ok = true, missing = [];
  if (s === 1){
    ['firstName','lastName','dob','phone','refDoc'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.disabled) return;
      if (!(el.value||'').trim()){
        ok = false; el.classList.add('invalid'); el.style.borderColor='var(--danger)';
        const lab = fs.querySelector(`label[for="${id}"]`); if (lab) missing.push(lab.textContent.replace('*','').trim());
      }
    });
  } else {
    $$('input,select,textarea', fs).forEach(i => { if (!i.disabled && !i.checkValidity()) ok = false; });
  }
  if (!ok){
    const err = document.getElementById('err'+s);
    if (err){
      err.textContent = missing.length ? `Please complete: ${missing.join(', ')}.` : 'Please complete required fields before continuing.';
      err.style.display = 'block'; setTimeout(()=> err.style.display='none', 3000);
    }
  }
  return ok;
}

prevBtn.addEventListener('click', () => setStep(step - 1));
nextBtn.addEventListener('click', () => {
  try { if (!validateStep(step)) return; setStep(step + 1); }
  catch (err) { console.error(err); toastMsg('Unexpected error — advancing to next step.'); setStep(step + 1); }
});
$$('.step', $('#stepper')).forEach(el => el.addEventListener('click', () => {
  const to = Number(el.dataset.step); if (to < step || validateStep(step)) setStep(to);
}));

/* ---- insurance toggle ---- */
const insWrap = $('#insWrap');
function toggleInsurance(){
  const off = $('#noIns').checked;
  $$('input,select,textarea', insWrap).forEach(el => { el.disabled = off; el.closest('.input').style.opacity = off ? 0.5 : 1; });
}
$('#noIns').addEventListener('change', toggleInsurance); toggleInsurance();

/* ---- reason chips ---- */
$$('#reasonChips .chip').forEach(ch => ch.addEventListener('click', () => ch.classList.toggle('active')));

/* ---- tooth selector ---- */
const gridTopEl = $('#toothGridTop');
const gridBottomEl = $('#toothGridBottom');
const selectedTeeth = new Set();
const toothBtnMap = new Map();
let lastPicked = null;

function setToothState(n,on){
  if (on) selectedTeeth.add(n); else selectedTeeth.delete(n);
  const btn = toothBtnMap.get(n);
  if (btn){ btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', on ? 'true':'false'); }
}
function toothTile(n){
  const div = document.createElement('div'); div.className='tooth';
  const num = document.createElement('div'); num.className='n'; num.textContent=String(n);
  const btn = document.createElement('button'); btn.type='button'; btn.className='pick';
  btn.setAttribute('aria-label', `Select tooth ${n}`); btn.setAttribute('aria-pressed','false');
  btn.addEventListener('click', (e)=>{
    if (e.shiftKey && lastPicked !== null){
      const a = Math.min(lastPicked,n), b = Math.max(lastPicked,n);
      for (let i=a;i<=b;i++) setToothState(i,true);
    } else {
      setToothState(n, !selectedTeeth.has(n));
    }
    lastPicked = n;
  });
  div.appendChild(num); div.appendChild(btn); toothBtnMap.set(n, btn); return div;
}
function buildTeeth(){ for (let n=1;n<=16;n++) gridTopEl.appendChild(toothTile(n)); for (let n=17;n<=32;n++) gridBottomEl.appendChild(toothTile(n)); }
buildTeeth();
$('#clearTeeth').addEventListener('click', ()=>{
  selectedTeeth.clear(); $$('.pick.active').forEach(b=>b.classList.remove('active')); $$('.pick').forEach(b=>b.setAttribute('aria-pressed','false'));
});

/* ---- review pane ---- */
const kv = (label, value) => `<div class="kv"><div class="hint">${label}</div><div>${value || '<span class="hint">—</span>'}</div></div>`;
function buildReview(){
  const d = snapshot();
  reviewPane.innerHTML = `
    <h4>Patient</h4>
    ${kv('Name', fmt(`${d.firstName || ''} ${d.lastName || ''}`))}
    ${kv('DOB', ageFromDOB(d.dob))}
    ${kv('Phone', fmt(d.phone))}
    ${kv('Email', fmt(d.email))}
    <h4>Referring Provider</h4>
    ${kv('Doctor', fmt(d.refDoc))}
    ${kv('Practice', fmt(d.refPractice))}
    ${kv('Office phone', fmt(d.refPhone))}
    ${kv('Office email', fmt(d.refEmail))}
    ${kv('Notes', fmt(d.refNotes))}
    <h4>Insurance</h4>
    ${kv('No insurance', d.noInsurance ? 'Yes' : 'No')}
    ${d.noInsurance ? '' : `
      ${kv('Company', fmt(d.insCompany))}
      ${kv('Group #', fmt(d.groupNum))}
      ${kv('Member ID', fmt(d.memberId))}
      ${kv('Plan max / left', fmt([d.planMax, d.maxLeft].filter(Boolean).join(' / ')))}
      ${kv('Deductible / left', fmt([d.deductible, d.dedLeft].filter(Boolean).join(' / ')))}
    `}
    <h4>Referral</h4>
    ${kv('Reason', fmt((d.reasons || []).join(', ')))}
    ${kv('Urgency', fmt(d.urgency))}
    ${kv('Chief complaint', fmt(d.symptoms))}
    ${kv('History', fmt(d.hx))}
    ${kv('Medications / allergies', fmt(d.meds))}
    ${kv('Teeth', fmt((d.teeth || []).join(', ')))}
  `;
}

/* ---- snapshot ---- */
function snapshot(){
  const fd = new FormData(form); const d = {};
  for (const [k,v] of fd.entries()){ d[k] = v; } // no file inputs
  d.reasons = $$('#reasonChips .chip.active').map(c => c.dataset.val);
  d.teeth = Array.from(selectedTeeth).sort((a,b)=>a-b);
  d.noInsurance = $('#noIns').checked;
  d.okXrays = $('#okXrays').checked;
  return d;
}

/* ---- send to GAS (multi-fallback) ---- */
function encodePayload(obj){
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

// Hidden form post (bypasses some CORS; may still be blocked by form-action CSP)
function postViaHiddenForm(obj){
  return new Promise(resolve => {
    const iframe = document.createElement('iframe');
    iframe.name = 'gas_iframe';
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const f = document.createElement('form');
    f.action = GAS_URL;
    f.method = 'POST';
    f.target = 'gas_iframe';

    Object.entries(obj).forEach(([k,v])=>{
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = v;
      f.appendChild(input);
    });

    document.body.appendChild(f);
    f.submit();
    setTimeout(()=>{ try{ f.remove(); iframe.remove(); }catch(_){} resolve(true); }, 1500);
  });
}

async function sendToGAS(d){
  const obj = {
    firstName: d.firstName || '', lastName: d.lastName || '', dob: d.dob || '',
    phone: d.phone || '', email: d.email || '',
    refDoc: d.refDoc || '', refPractice: d.refPractice || '', refPhone: d.refPhone || '', refEmail: d.refEmail || '', refNotes: d.refNotes || '',
    insCompany: d.insCompany || '', groupNum: d.groupNum || '', memberId: d.memberId || '',
    planMax: d.planMax || '', maxLeft: d.maxLeft || '', deductible: d.deductible || '', dedLeft: d.dedLeft || '',
    urgency: d.urgency || '', symptoms: d.symptoms || '', hx: d.hx || '', meds: d.meds || '',
    okXrays: d.okXrays ? 'true' : 'false', noInsurance: d.noInsurance ? 'true' : 'false',
    reasons: JSON.stringify(d.reasons || []),
    teeth: JSON.stringify(d.teeth || [])
  };

  // Try 1: fetch urlencoded (simple request)
  try {
    const body = new URLSearchParams(obj);
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      mode: 'no-cors'
    });
    return true;
  } catch(_){}

  // Try 2: sendBeacon (often allowed by CSP)
  try {
    const body = new URLSearchParams(obj).toString();
    const ok = navigator.sendBeacon(GAS_URL, new Blob([body], {type:'text/plain;charset=UTF-8'}));
    if (ok) return true;
  } catch(_){}

  // Try 3: hidden form POST
  try {
    const ok = await postViaHiddenForm(obj);
    if (ok) return true;
  } catch(_){}

  // Try 4: GET relay via new tab (last resort)
  try {
    const q = new URLSearchParams({ payload: encodePayload(obj), ts: Date.now().toString() });
    window.open(`${GAS_URL}?${q.toString()}`, '_blank', 'noopener,noreferrer');
    return true;
  } catch(_){}

  return false;
}

/* ---- submit ---- */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (sending) return;
  if (!validateStep(5)) return;

  const d = snapshot();
  buildReview();

  sending = true;
  submitBtn.disabled = true; nextBtn.disabled = true; prevBtn.disabled = true;
  toastMsg('Sending…');

  const ok = await sendToGAS(d);

  submitBtn.disabled = false; nextBtn.disabled = false; prevBtn.disabled = false;
  sending = false;

  toastMsg(ok ? 'Referral emailed with PDF ✅' : 'Send failed. Check connection and try again.');
});

/* ---- init ---- */
document.getElementById('yr').textContent = new Date().getFullYear();
setStep(1);
window.addEventListener('error', (e)=>{ try{ toastMsg('JS error: ' + e.message); } catch(_){} });
