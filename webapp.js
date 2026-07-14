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
  var html = buildReferralSlipHTML(d);
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

function boolFrom(value){
  var v = String(value || '').toLowerCase();
  return v === 'true' || v === 'yes' || v === 'on' || v === '1';
}

function normalizeData(p){
  return {
    firstName: p.firstName||'', lastName: p.lastName||'', dob: p.dob||'',
    phone: p.phone||'', email: p.email||'', sex: p.sex||'',
    refDoc: p.refDoc||'', refPractice: p.refPractice||'', refPhone: p.refPhone||'', refEmail: p.refEmail||'', refNotes: p.refNotes||'',
    insCompany: p.insCompany||'', groupNum: p.groupNum||'', memberId: p.memberId||'', planMax: p.planMax||'', maxLeft: p.maxLeft||'', deductible: p.deductible||'', dedLeft: p.dedLeft||'', insPhone: p.insPhone||'', subscriber: p.subscriber||'',
    urgency: p.urgency||'', symptoms: p.symptoms||'', hx: p.hx||'', meds: p.meds||'',
    okXrays: boolFrom(p.okXrays),
    noInsurance: boolFrom(p.noInsurance),
    xrayDeliveryNote: p.xrayDeliveryNote||'',
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
  var parts = String(dobStr).split('-');
  var d = parts.length === 3
    ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    : new Date(dobStr);
  if (isNaN(d)) return esc(dobStr);
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
  '@page{size:Letter;margin:10mm}'+
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
  kv('Sex', esc(d.sex||''))+

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
      kv('Deductible / Left', esc([d.deductible,d.dedLeft].filter(Boolean).join(' / ')))+
      kv('Insurance Phone', esc(d.insPhone||''))+
      kv('Subscriber', esc(d.subscriber||''))
  )+

  '<div class="section">Referral Details</div>'+
  kv('Reason', reasons || '<span class="muted">—</span>')+
  kv('Urgency', esc(d.urgency||''))+
  kv('Chief Complaint', esc(d.symptoms||''))+
  kv('Pertinent History', esc(d.hx||''))+
  kv('Medications / Allergies', esc(d.meds||''))+
  kv('X-ray Delivery Note', esc(d.xrayDeliveryNote||''))+

  '<div class="section">Teeth</div>'+
  '<div class="toothwrap"><div class="row">'+rowTop+'</div><div style="height:6px"></div><div class="row">'+rowBot+'</div></div>'+

'</div></div></body></html>';

  return html;
}

function buildReferralSlipHTML(d){
  var reasons = d.reasons || [];
  var teeth = d.teeth || [];
  var knownReasons = ['Exam & Pulp Test', 'Root Canal Therapy', 'Retreatment', 'Periapical Surgery', 'Bleaching'];

  function selectedReason(label){
    return reasons.indexOf(label) > -1;
  }

  function hasOtherReason(){
    if (!reasons.length) return false;
    return reasons.every(function(reason){ return knownReasons.indexOf(reason) < 0; });
  }

  function toothCell(n){
    var selected = teeth.indexOf(n) > -1;
    return '<div class="tooth-cell'+(selected?' selected':'')+'"><span>'+n+'</span><b>'+(selected?'X':'')+'</b></div>';
  }

  function slipField(label, value){
    return '<div class="slip-field"><span>'+esc(label)+'</span><strong>'+esc(value || '')+'</strong></div>';
  }

  function slipCheck(label, checked){
    return '<span class="slip-check"><span class="check-box">'+(checked ? 'X' : '')+'</span>'+esc(label)+'</span>';
  }

  function textBlock(label, value){
    var text = esc(value || '').replace(/\n/g, '<br>');
    return '<div class="text-block"><div class="block-label">'+esc(label)+'</div><div class="block-lines">'+(text || '&nbsp;')+'</div></div>';
  }

  var rowTop = '';
  var rowBot = '';
  for (var i = 1; i <= 16; i++) rowTop += toothCell(i);
  for (var j = 32; j >= 17; j--) rowBot += toothCell(j);

  var html =
'<!DOCTYPE html><html><head><meta charset="utf-8">'+
'<title></title>'+
'<style>'+
  '@page{size:Letter;margin:8mm}'+
  '*{box-sizing:border-box}'+
  'html,body{margin:0;padding:0;background:#fff;color:#173244;font:10.5px/1.25 Arial,Helvetica,sans-serif}'+
  '.sheet{max-width:760px;margin:0 auto;padding:10px}'+
  '.slip{border:1.5px solid #6fa9bd;padding:12px 14px 10px;background:#fff}'+
  '.top{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:end;border-bottom:2px solid #6fa9bd;padding-bottom:8px}'+
  '.practice{font-size:22px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;color:#0e5670}'+
  '.subtitle{font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-top:2px;color:#426b7d}'+
  '.date-box{min-width:175px}'+
  '.section-title{background:#d9edf5;color:#0e5670;border:1px solid #82b7c9;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:4px 7px;margin:9px 0 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
  '.grid{display:grid;gap:7px}'+
  '.cols-2{grid-template-columns:1fr 1fr}.cols-3{grid-template-columns:1fr 1fr 1fr}.cols-4{grid-template-columns:1fr 1fr 1fr 1fr}'+
  '.slip-field span{display:block;font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#345b70}'+
  '.slip-field strong{display:block;min-height:18px;border-bottom:1px solid #78a7ba;padding:3px 2px 1px;font-size:11px;font-weight:500;color:#173244}'+
  '.check-row{display:flex;flex-wrap:wrap;gap:7px 13px;margin:5px 0 2px}'+
  '.slip-check{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-weight:700}'+
  '.check-box{width:13px;height:13px;border:1.5px solid #4f93aa;display:inline-grid;place-items:center;font-size:10px;line-height:1;font-weight:900;color:#0e5670;background:#fbfdfe}'+
  '.two-panel{display:grid;grid-template-columns:1.05fr .95fr;gap:10px;align-items:start}'+
  '.panel{border:1px solid #83b4c5;background:#f6fbfd;padding:8px;min-height:118px}'+
  '.panel-title{font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;color:#0e5670}'+
  '.teeth{display:grid;gap:5px;margin-top:5px}'+
  '.tooth-row{display:grid;grid-template-columns:repeat(16,1fr);gap:3px}'+
  '.tooth-cell{position:relative;min-height:26px;border:1px solid #78a7ba;text-align:center;font-weight:800;background:#fff;padding:2px 0 0;color:#173244}'+
  '.tooth-cell span{display:block;font-size:9px}.tooth-cell b{display:block;font-size:13px;line-height:12px}'+
  '.tooth-cell.selected{background:#c8eaf3;color:#0e5670;border-color:#1682a1;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
  '.text-block{border:1px solid #83b4c5;margin-top:7px;background:#fff}'+
  '.block-label{font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #83b4c5;padding:4px 6px;background:#eaf6fa;color:#0e5670;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
  '.block-lines{min-height:48px;padding:6px;white-space:normal}'+
  '.footer{display:grid;grid-template-columns:1fr auto;gap:10px;border-top:2px solid #6fa9bd;margin-top:9px;padding-top:7px;font-size:10px;color:#38576a}'+
  '.footer strong{font-size:13px;text-transform:uppercase;color:#0e5670}'+
  '@media print{body{background:#fff;font-size:10.1px;line-height:1.22}.sheet{padding:2mm;max-width:none;height:10.32in;display:flex}.slip{border:1.25px solid #6fa9bd;padding:10px 12px;width:100%;height:100%;display:flex;flex-direction:column}.top{padding-bottom:7px}.practice{font-size:21px}.subtitle{font-size:10.5px}.date-box{min-width:165px}.section-title{break-after:avoid;margin:7px 0 4px;padding:3px 7px}.grid{gap:5.5px}.slip-field span{font-size:8.1px}.slip-field strong{min-height:16px;padding:2px 2px 0;font-size:10.1px}.check-row{gap:6px 11px;margin:4px 0 1px}.check-box{width:12px;height:12px;font-size:9px}.two-panel{gap:8px}.panel{min-height:96px;padding:7px}.panel-title{margin-bottom:5px}.teeth{gap:4px}.tooth-row{gap:2.5px}.tooth-cell{min-height:23px;padding-top:1px}.tooth-cell span{font-size:8.5px}.tooth-cell b{font-size:12px;line-height:10px}.text-block{margin-top:5.5px;display:grid;grid-template-rows:auto 1fr;flex:1 1 0}.block-label{padding:3px 6px}.block-lines{min-height:42px;padding:5px}.footer{margin-top:7px;padding-top:5px;font-size:9px}.footer strong{font-size:12px}.panel,.text-block{break-inside:avoid}}'+
'</style></head><body><div class="sheet"><div class="slip">'+
  '<div class="top"><div><div class="practice">McMurtrey Endodontics</div><div class="subtitle">Patient Referral Slip</div></div><div class="date-box">'+
  slipField('Today\'s Date', new Date().toLocaleDateString())+'</div></div>'+

  '<div class="section-title">Patient Information</div>'+
  '<div class="grid cols-4">'+
    slipField('First Name', d.firstName)+
    slipField('Last Name', d.lastName)+
    slipField('Date of Birth', d.dob ? ageFromDOB(d.dob) : '')+
    slipField('Phone', d.phone)+
  '</div><div class="grid cols-3">'+
    slipField('Email', d.email)+
    slipField('Sex', d.sex)+
    slipField('Antibiotic Premedication Needed?', '')+
  '</div>'+

  '<div class="section-title">Referring Doctor Information</div>'+
  '<div class="grid cols-4">'+
    slipField('Referred By', d.refDoc)+
    slipField('Practice', d.refPractice)+
    slipField('Telephone', d.refPhone)+
    slipField('Email Address', d.refEmail)+
  '</div>'+

  '<div class="section-title">Please Verify Teeth For Evaluation / Treatment</div>'+
  '<div class="teeth"><div class="tooth-row">'+rowTop+'</div><div class="tooth-row">'+rowBot+'</div></div>'+

  '<div class="two-panel">'+
    '<div class="panel"><div class="panel-title">Requested Procedure</div><div class="check-row">'+
      slipCheck('Exam & Pulp Test', selectedReason('Exam & Pulp Test'))+
      slipCheck('Root Canal Therapy', selectedReason('Root Canal Therapy'))+
      slipCheck('Retreatment', selectedReason('Retreatment'))+
      slipCheck('Periapical Surgery', selectedReason('Periapical Surgery'))+
      slipCheck('Bleaching', selectedReason('Bleaching'))+
      slipCheck('Other', hasOtherReason())+
    '</div>'+slipField('Urgency', d.urgency)+'</div>'+
    '<div class="panel"><div class="panel-title">Radiographs / Clinical Photos</div><div class="check-row">'+
      slipCheck('Will be sent separately', d.okXrays)+
      slipCheck('No X-rays available', false)+
    '</div>'+slipField('Delivery Note', d.xrayDeliveryNote)+'</div>'+
  '</div>'+

  '<div class="section-title">Clinical Information</div>'+
  textBlock('Chief Complaint / Symptoms', d.symptoms)+
  textBlock('Pertinent Dental History', d.hx)+
  textBlock('Medications / Allergies', d.meds)+
  textBlock('Referring Doctor Notes / Comments', d.refNotes)+

  '<div class="section-title">Insurance</div>'+
  '<div class="check-row">'+slipCheck('No insurance / self-pay', d.noInsurance)+'</div>'+
  '<div class="grid cols-4">'+
    slipField('Company', d.insCompany)+
    slipField('Group #', d.groupNum)+
    slipField('Member ID', d.memberId)+
    slipField('Subscriber', d.subscriber)+
  '</div><div class="grid cols-3">'+
    slipField('Plan Max / Left', [d.planMax,d.maxLeft].filter(Boolean).join(' / '))+
    slipField('Deductible / Left', [d.deductible,d.dedLeft].filter(Boolean).join(' / '))+
    slipField('Insurance Phone', d.insPhone)+
  '</div>'+

  '<div class="footer"><div><strong>McMurtrey Endodontics</strong><br>Endodontic diagnosis and treatment referrals</div><div>p: 303.422.6464<br>office@mcmurtreyendo.com</div></div>'+
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
  add('Name',(d.firstName||'')+' '+(d.lastName||'')); add('DOB', d.dob ? d.dob+(age?' ('+age+')':'') : ''); add('Phone', d.phone); add('Email', d.email); add('Sex', d.sex); L.push('');
  L.push('Referring Provider'); L.push('-------------------');
  add('Doctor', d.refDoc); add('Practice', d.refPractice); add('Office Phone', d.refPhone); add('Office Email', d.refEmail); add('Notes', d.refNotes); L.push('');
  L.push('Insurance'); L.push('---------');
  L.push('No insurance: '+(d.noInsurance?'Yes':'No'));
  if (!d.noInsurance){
    add('Company', d.insCompany); add('Group #', d.groupNum); add('Member ID', d.memberId);
    add('Plan max / left', [d.planMax,d.maxLeft].filter(String).join(' / '));
    add('Deductible / left', [d.deductible,d.dedLeft].filter(String).join(' / '));
    add('Insurance phone', d.insPhone); add('Subscriber', d.subscriber);
  }
  L.push(''); L.push('Referral'); L.push('--------');
  add('Reason', (d.reasons||[]).join(', ')); add('Urgency', d.urgency); add('Chief complaint', d.symptoms); add('History', d.hx); add('Medications / allergies', d.meds); add('Teeth', (d.teeth||[]).join(', '));
  add('Radiographs', d.okXrays ? 'Will be sent separately' : '—');
  add('X-ray delivery note', d.xrayDeliveryNote);
  return L.join('\r\n');
}
