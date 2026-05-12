/** ========= Web App Handlers ========= **/

function doGet(e){
  try {
    // GET relay support: ?payload=<base64-JSON>
    if (e && e.parameter && e.parameter.payload) {
      var json = Utilities.newBlob(Utilities.base64Decode(e.parameter.payload)).getDataAsString('utf-8');
      var p = JSON.parse(json);
      var d = normalizeData(p);
      return processReferral(d); // send email + PDF
    }
    return ContentService.createTextOutput('OK'); // simple ping
  } catch (err){
    Logger.log('ERR doGet: ' + err);
    return ContentService.createTextOutput('ERR ' + err);
  }
}

function doPost(e){
  try {
    // Prefer e.parameter (urlencoded / form POST)
    var p = (e && e.parameter) ? e.parameter : {};

    // If empty, parse the raw body for urlencoded or JSON
    if (!p || !Object.keys(p).length) {
      var raw  = e && e.postData ? (e.postData.contents || '') : '';
      var type = e && e.postData ? (e.postData.type     || '') : '';
      if (raw) {
        if (type.indexOf('application/x-www-form-urlencoded') > -1 || type.indexOf('text/plain') > -1) {
          p = parseQS(raw);
        } else if (type.indexOf('application/json') > -1) {
          p = JSON.parse(raw);
        }
      }
    }

    var d = normalizeData(p);
    return processReferral(d); // send email + PDF
  } catch (err){
    Logger.log('ERR doPost: ' + err);
    return ContentService.createTextOutput(JSON.stringify({ ok:false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** ========= Core flow ========= **/

function processReferral(d){
  var html = buildPrintableHTML(d);
  var pdf = HtmlService.createHtmlOutput(html)
            .getBlob()
            .setName('Referral-' + (d.lastName || 'Patient') + '.pdf')
            .getAs('application/pdf');
  var plain = buildPlainText(d);
  var subject = ('Referral - ' + (d.lastName || 'Patient') + ', ' + (d.firstName || '')).trim();

  // Send to your inbox; edit as needed
  GmailApp.sendEmail('office@mcmurtreyendo.com', subject, plain, {
    htmlBody: html,
    attachments: [pdf]
  });

  return ContentService.createTextOutput(JSON.stringify({ ok:true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ========= Normalization & Parsing ========= **/

function normalizeData(p){
  return {
    firstName: p.firstName||'', lastName: p.lastName||'', dob: p.dob||'',
    phone: p.phone||'', email: p.email||'',
    refDoc: p.refDoc||'', refPractice: p.refPractice||'', refPhone: p.refPhone||'', refEmail: p.refEmail||'', refNotes: p.refNotes||'',
    insCompany: p.insCompany||'', groupNum: p.groupNum||'', memberId: p.memberId||'', planMax: p.planMax||'', maxLeft: p.maxLeft||'', deductible: p.deductible||'', dedLeft: p.dedLeft||'',
    urgency: p.urgency||'', symptoms: p.symptoms||'', hx: p.hx||'', meds: p.meds||'',
    okXrays: String(p.okXrays) === 'true',
    noInsurance: String(p.noInsurance) === 'true',
    reasons: safeJsonArray(p.reasons),
    teeth: safeJsonArray(p.teeth).map(function(n){ n = Number(n); return isNaN(n) ? null : n; }).filter(function(n){ return n !== null; })
  };
}

function parseQS(qs){
  var p = {};
  (qs || '').split('&').forEach(function(pair){
    if (!pair) return;
    var i = pair.indexOf('=');
    var k = decodeURIComponent((i<0?pair:pair.slice(0,i)).replace(/\+/g,' '));
    var v = decodeURIComponent((i<0?'':pair.slice(i+1)).replace(/\+/g,' '));
    p[k] = v;
  });
  return p;
}

function safeJsonArray(s){
  try { return JSON.parse(s || '[]'); } catch(_) { return []; }
}

/** ========= Presentation helpers ========= **/

function esc(s){
  return String(s||'').replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
  });
}

function ageFromDOB(dobStr){
  if (!dobStr) return '';
  var d = new Date(dobStr); if (isNaN(d)) return esc(dobStr);
  var t = new Date(), age = t.getFullYear()-d.getFullYear();
  var m = t.getMonth()-d.getMonth();
  if (m<0 || (m===0 && t.getDate()<d.getDate())) age--;
  return d.toLocaleDateString() + ' (' + age + ' yrs)';
}

function buildPrintableHTML(d){
  var reasons = esc((d.reasons||[]).join(', '));
  var teeth   = d.teeth||[];

  // tooth cell
  function toothCell(n){
    var sel = teeth.indexOf(n) > -1;
    return '<div class="cell'+(sel?' selected':'')+'">'+n+'</div>';
  }
  var rowTop = Array.from({length:16}, (_,i)=> toothCell(i+1)).join('');
  var rowBot = Array.from({length:16}, (_,i)=> toothCell(i+17)).join('');

  // compact key/value row (hides empties to keep 1 page)
  function kv(label, value){
    var v = (value==null) ? '' : String(value);
    if (!v.trim()) return '';                      // skip empty rows
    return '<div class="kv"><div>'+label+'</div><div>'+v+'</div></div>';
  }

  var html =
'<!DOCTYPE html><html><head><meta charset="utf-8">'+
'<title>Referral Summary — '+esc(d.lastName||'Patient')+', '+esc(d.firstName||'')+'</title>'+
'<style>'+
  /* keep to one page */
  '@page{size:Letter;margin:8mm}'+
  'html,body{margin:0;padding:0;background:#fff;color:#111;font:12.5px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}'+
  '.wrap{max-width:720px;margin:0 auto;padding:8mm 0}'+
  '.card{border:1px solid #ddd;border-radius:12px;padding:14px 16px;break-inside:avoid;page-break-inside:avoid}'+
  '.bar{font-size:12px;color:#555;margin-bottom:8px}'+
  '.section{margin:10px 0 6px;font-weight:700}'+
  '.kv{display:grid;grid-template-columns:180px 1fr;gap:8px;padding:6px 0;border-bottom:1px dashed #e4e4e4}'+
  '.kv:last-child{border-bottom:0}'+
  '.muted{color:#888}'+
  /* teeth: more visible */
  '.toothwrap{margin:6px 0 8px;break-inside:avoid;page-break-inside:avoid}'+
  '.row{display:grid;grid-template-columns:repeat(16,1fr);gap:6px}'+
  '.cell{border:1.5px solid #777;border-radius:9px;padding:6px 0;text-align:center;font-weight:700;font-size:13px;color:#222;background:#fff}'+
  '.cell.selected{background:#000;color:#fff; border:2px solid #000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'+
'</style></head><body><div class="wrap"><div class="card">'+

  '<div class="bar"><b>Submitted:</b> '+new Date().toLocaleString()+
  ' — <b>Radiographs:</b> '+(d.okXrays ? 'Will be sent separately' : '—')+'</div>'+

  '<div class="section">Patient</div>'+
  kv('Name', esc((d.firstName||'')+' '+(d.lastName||'')))+
  kv('Date of Birth / Age', esc(ageFromDOB(d.dob)))+
  kv('Phone', esc(d.phone||''))+
  kv('Email', esc(d.email||''))+

  '<div class="section">Referring Provider</div>'+
  kv('Doctor', esc(d.refDoc||''))+
  kv('Practice', esc(d.refPractice||''))+
  kv('Office Phone', esc(d.refPhone||''))+
  kv('Office Email', esc(d.refEmail||''))+
  kv('Notes', esc(d.refNotes||''))+

  '<div class="section">Insurance</div>'+
  (d.noInsurance
    ? kv('Insurance', 'Self-pay')
    : kv('Insurance Company', esc(d.insCompany||''))+
      kv('Member ID', esc(d.memberId||''))+
      kv('Group #', esc(d.groupNum||''))+
      kv('Plan Max / Left', esc([d.planMax,d.maxLeft].filter(Boolean).join(' / ')))+
      kv('Deductible / Left', esc([d.deductible,d.dedLeft].filter(Boolean).join(' / ')))
  )+

  '<div class="section">Referral Details</div>'+
  kv('Reason', reasons || '<span class="muted">—</span>')+
  kv('Urgency', esc(d.urgency||''))+
  kv('Chief Complaint', esc(d.symptoms||''))+
  kv('Pertinent History', esc(d.hx||''))+
  kv('Medications / Allergies', esc(d.meds||''))+

  '<div class="section">Teeth</div>'+
  '<div class="toothwrap"><div class="row">'+rowTop+'</div><div style="height:6px"></div><div class="row">'+rowBot+'</div></div>'+

'</div></div></body></html>';

  return html;
}

function buildPlainText(d){
  var L = [];
  function add(label, val){ if (val && String(val).trim()) L.push(label+': '+String(val).trim()); }
  var age = d.dob ? (ageFromDOB(d.dob).match(/\((.*?)\)/)||[])[1] : '';
  L.push('Referral Submission');
  L.push('Submitted: '+new Date().toLocaleString()); L.push('');
  L.push('Patient'); L.push('--------');
  add('Name',(d.firstName||'')+' '+(d.lastName||'')); add('DOB', d.dob ? d.dob+(age?' ('+age+')':'') : ''); add('Phone', d.phone); add('Email', d.email); L.push('');
  L.push('Referring Provider'); L.push('-------------------');
  add('Doctor', d.refDoc); add('Practice', d.refPractice); add('Office Phone', d.refPhone); add('Office Email', d.refEmail); add('Notes', d.refNotes); L.push('');
  L.push('Insurance'); L.push('---------');
  L.push('No insurance: '+(d.noInsurance?'Yes':'No'));
  if (!d.noInsurance){
    add('Company', d.insCompany); add('Group #', d.groupNum); add('Member ID', d.memberId);
    add('Plan max / left', [d.planMax,d.maxLeft].filter(String).join(' / '));
    add('Deductible / left', [d.deductible,d.dedLeft].filter(String).join(' / '));
  }
  L.push(''); L.push('Referral'); L.push('--------');
  add('Reason', (d.reasons||[]).join(', ')); add('Urgency', d.urgency); add('Chief complaint', d.symptoms); add('History', d.hx); add('Medications / allergies', d.meds); add('Teeth', (d.teeth||[]).join(', '));
  add('Radiographs', d.okXrays ? 'Will be sent separately' : '—');
  return L.join('\r\n');
}
