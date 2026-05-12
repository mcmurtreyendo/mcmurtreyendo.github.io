// assets/js/pricing-calculator.js
(function () {
  // ---- external data holders ----
  let FEES_JSON = null;            // { currency, cash:{...}, insurers:{...} }
  let COVERAGE_DEFAULTS = null;    // { insurerKey: { endo, diag, cbct } }

  // GentleWave fee for RETX only — never covered by insurance
  const GENTLEWAVE_RETX_PATIENT_FEE = 150;

  async function loadPricing() {
    if (FEES_JSON && COVERAGE_DEFAULTS) return;
    const [fees, cov] = await Promise.all([
      fetch('/assets/data/fees.json', { cache: 'no-cache' }).then(r => r.json()),
      fetch('/assets/data/coverage-defaults.json', { cache: 'no-cache' }).then(r => r.json())
    ]);
    FEES_JSON = fees;
    COVERAGE_DEFAULTS = cov;
  }

  // --- helpers (unchanged) ---
  function $(sel, root) { return (root || document).querySelector(sel); }
  function root() { return document.getElementById('insurance-calculator'); }
  function fmt(n) { return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
  function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }
  function readPct(el) {
    var raw = parseFloat(el.value);
    if (isNaN(raw)) return NaN;
    var val = raw > 1 ? raw / 100 : raw;
    return clamp(val, 0, 1);
  }
  function getInsurer(r) { var c = $('input[name="insurer"]:checked', r); return c ? String(c.value).toLowerCase() : ''; }
  function getProcedure(r) { var c = $('input[name="procedure"]:checked', r); return c ? String(c.value) : ''; }

  // Map ADA tooth numbers (1–32) into categories
  function mapToothCategory(num) {
    var n = parseInt(num, 10);
    if (isNaN(n) || n < 1 || n > 32) return 'anterior';
    if ((n >= 6 && n <= 11) || (n >= 22 && n <= 27)) return 'anterior';
    if ((n >= 4 && n <= 5) || (n >= 12 && n <= 13) || (n >= 20 && n <= 21) || (n >= 28 && n <= 29)) return 'bicuspid';
    return 'molar';
  }

  // Resolve a fee given table + procedure + tooth category
  function feeFor(table, proc, toothCat) {
    if (!table) return null;
    var v = table[proc];
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'object') {
      if (v[toothCat] != null) return v[toothCat];
      return (v.anterior ?? v.bicuspid ?? v.molar ?? null);
    }
    return null;
  }

  function prefillCoverage(r) {
    var d = COVERAGE_DEFAULTS ? COVERAGE_DEFAULTS[getInsurer(r)] : null;
    var endo = $('#endoCov', r), diag = $('#diagCov', r);
    if (!d || !endo || !diag) return;
    if (!endo.value) endo.value = (d.endo * 100).toFixed(0);
    if (!diag.value) diag.value = (d.diag * 100).toFixed(0);
  }

  function reveal(out) {
    if (!out) return;
    out.hidden = false;
    out.removeAttribute('hidden');
    out.style.display = 'block';
  }

  function estimateLineItem(fee, covPct, maxRemain, dedRemain, deductibleApplies) {
    var applied = 0;
    if (deductibleApplies && covPct > 0) {
      applied = Math.min(Math.max(0, dedRemain), fee);
    }
    var eligible = Math.max(0, fee - applied);
    var insBeforeMax = eligible * covPct;
    var insPays = Math.min(insBeforeMax, Math.max(0, maxRemain));
    var patient = Math.max(0, fee - insPays);
    var maxLeft = Math.max(0, maxRemain - insPays);
    var dedLeft = Math.max(0, dedRemain - applied);
    return { patient: patient, insurance: insPays, appliedDeductible: applied, maxLeft: maxLeft, dedLeft: dedLeft };
  }

  async function calculate(r) {
    // ensure data is ready
    if (!FEES_JSON || !COVERAGE_DEFAULTS) { await loadPricing(); }

    var endo = $('#endoCov', r), diag = $('#diagCov', r), max = $('#maxRemain', r), ded = $('#deductRemain', r);
    var box = $('#calc2-result', r),
        p = $('#calc2-patient', r), fee = $('#calc2-fee', r),
        dd = $('#calc2-deduct', r), cov = $('#calc2-cov', r), ins = $('#calc2-ins', r), left = $('#calc2-maxleft', r);

    var outCbct = $('#calc2-cbct', r),
        outEval = $('#calc2-evalcopay', r),
        outTotalTreat = $('#calc2-total-treatment', r),
        outTotalAll = $('#calc2-total-all', r);

    if (!endo || !diag || !max || !ded || !box) return;

    var insr = getInsurer(r), proc = getProcedure(r);
    if (!insr || !proc) return;

    var toothInput = $('#toothNum', r);
    var toothCat = mapToothCategory(toothInput ? toothInput.value : null);

    if (insr !== 'noins') {
      var need = [endo, diag, max, ded];
      for (var i = 0; i < need.length; i++) { if (!need[i].reportValidity()) return; }
    } else {
      if (!endo.value) endo.value = '0';
      if (!diag.value) diag.value = '0';
      if (!max.value) max.value = '0';
      if (!ded.value) ded.value = '0';
    }

    var fees = (insr === 'noins') ? FEES_JSON.cash : (FEES_JSON.insurers[insr] || {});
    var base = feeFor(fees, proc, toothCat);
    if (base == null) base = feeFor(FEES_JSON.cash, proc, toothCat);
    var cbctFee = feeFor(fees, 'cbct', toothCat); if (cbctFee == null) cbctFee = feeFor(FEES_JSON.cash, 'cbct', toothCat);
    var evalFee = feeFor(fees, 'evaluation', toothCat); if (evalFee == null) evalFee = feeFor(FEES_JSON.cash, 'evaluation', toothCat);

    var endoPct = (insr === 'noins') ? 0 : readPct(endo);
    var diagPct = (insr === 'noins') ? 0 : readPct(diag);
    if (isNaN(endoPct) || isNaN(diagPct)) { alert('Enter valid coverage percentages.'); return; }
    var cbctPct = (insr === 'noins') ? 0 : (COVERAGE_DEFAULTS[insr] ? COVERAGE_DEFAULTS[insr].cbct : 0.0);

    var maxStart = (insr === 'noins') ? 0 : Math.max(0, parseFloat(max.value || '0'));
    var dedStart = (insr === 'noins') ? 0 : Math.max(0, parseFloat(ded.value || '0'));

    if (proc === 'evaluation') {
      var evalRes = estimateLineItem(evalFee, diagPct, maxStart, dedStart, false);
      var cbctRes = estimateLineItem(cbctFee, cbctPct, evalRes.maxLeft, evalRes.dedLeft, false);

      var treatTotalRow = outTotalTreat ? outTotalTreat.parentElement : null;
      var allTotalRow = outTotalAll ? outTotalAll.parentElement : null;

      if (fee) fee.textContent = fmt(evalFee);
      if (dd) dd.textContent = fmt(0);
      if (cov) cov.textContent = (diagPct * 100).toFixed(0) + '%';
      if (ins) ins.textContent = fmt(evalRes.insurance + cbctRes.insurance);
      if (left) left.textContent = fmt(cbctRes.maxLeft);
      if (p) p.textContent = fmt(evalRes.patient + cbctRes.patient);

      if (outCbct) outCbct.textContent = fmt(cbctRes.patient);
      if (outEval) outEval.textContent = fmt(evalRes.patient);
      if (outTotalTreat) outTotalTreat.textContent = fmt(0);
      if (outTotalAll) outTotalAll.textContent = fmt(evalRes.patient + cbctRes.patient);

      if (treatTotalRow) treatTotalRow.style.display = 'none';
      if (allTotalRow) {
        var n = allTotalRow.firstChild;
        if (n && n.nodeType === 3) { n.nodeValue = 'Evaluation total (incl. CBCT): '; }
      }

      reveal(box);
      return;
    }

    // Treatment visit (Treatment + CBCT + Evaluation)
    var maxRemain = maxStart, dedRemain = dedStart;

    var procRes = estimateLineItem(base, endoPct, maxRemain, dedRemain, true);
    maxRemain = procRes.maxLeft; dedRemain = procRes.dedLeft;

    var cbctRes2 = estimateLineItem(cbctFee, cbctPct, maxRemain, dedRemain, false);
    maxRemain = cbctRes2.maxLeft;

    var evalRes2 = estimateLineItem(evalFee, diagPct, maxStart, dedStart, false);

    // --- GentleWave add-on for RETX ONLY (patient-only, no coverage) ---
    // We add this AFTER all coverage math so it never affects insurance/limits.
    var retxAddOn = (proc === 'retx') ? GENTLEWAVE_RETX_PATIENT_FEE : 0;

    var treatmentPatient = procRes.patient + cbctRes2.patient + retxAddOn; // add-on belongs with treatment portion
    var treatmentPlusEval = treatmentPatient + evalRes2.patient;

    // Display (keep fee/deduct/coverage/ins/max-left based on covered items only)
    if (fee) fee.textContent = fmt(base);
    if (dd) dd.textContent = fmt(procRes.appliedDeductible);
    if (cov) cov.textContent = (endoPct * 100).toFixed(0) + '%';
    if (ins) ins.textContent = fmt(procRes.insurance);
    if (left) left.textContent = fmt(maxRemain);
    if (outCbct) outCbct.textContent = fmt(cbctRes2.patient);
    if (outEval) outEval.textContent = fmt(evalRes2.patient);

    if (p) p.textContent = fmt(treatmentPatient);

    var treatTotalRow = outTotalTreat ? outTotalTreat.parentElement : null;
    var allTotalRow = outTotalAll ? outTotalAll.parentElement : null;

    if (treatTotalRow) treatTotalRow.style.display = '';
    // For transparency, include the add-on in the “procedure only” line too.
    if (outTotalTreat) outTotalTreat.textContent = fmt(procRes.patient + retxAddOn);
    if (treatTotalRow && treatTotalRow.firstChild && treatTotalRow.firstChild.nodeType === 3) {
      treatTotalRow.firstChild.nodeValue = 'Procedure only (no CBCT/Eval): ';
    }

    if (outTotalAll) outTotalAll.textContent = fmt(treatmentPlusEval);
    if (allTotalRow && allTotalRow.firstChild && allTotalRow.firstChild.nodeType === 3) {
      allTotalRow.firstChild.nodeValue = 'Total for today’s visit: ';
    }

    reveal(box);
  }

  function resetCalc(r) {
    var endo = $('#endoCov', r), diag = $('#diagCov', r), max = $('#maxRemain', r), ded = $('#deductRemain', r), box = $('#calc2-result', r);
    if (endo) endo.value = ''; if (diag) diag.value = ''; if (max) max.value = ''; if (ded) ded.value = '';
    if (box) { box.hidden = true; box.style.display = 'none'; }
  }

  document.addEventListener('click', async function (e) {
    var t = e.target;
    if (!t) return;

    if (t.id === 'calc2-btn') {
      e.preventDefault();
      await loadPricing();
      calculate(root());
    }
    else if (t.id === 'calc2-reset') {
      e.preventDefault();
      resetCalc(root());
    }
    else if (t.id === 'calc2-print') {
      e.preventDefault();
      window.print();
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || t.name !== 'insurer') return;
    var r = root(); if (!r) return;
    var val = String(t.value).toLowerCase();

    var endo = $('#endoCov', r), diag = $('#diagCov', r), max = $('#maxRemain', r), ded = $('#deductRemain', r);
    if (!endo || !diag || !max || !ded) return;

    if (val === 'noins') {
      endo.value = '0'; diag.value = '0'; max.value = '0'; ded.value = '0';
    } else {
      if (!endo.value) endo.value = '';
      if (!diag.value) diag.value = '';
      prefillCoverage(r);
    }
  });

  // Prefill once the page & pricing load
  if (document.readyState !== 'loading') {
    (async () => { await loadPricing(); var r0 = root(); if (r0) prefillCoverage(r0); })();
  } else {
    document.addEventListener('DOMContentLoaded', async function () {
      await loadPricing();
      var r0 = root(); if (r0) prefillCoverage(r0);
    }, { once: true });
  }
})();
